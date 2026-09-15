/**
 * P4.md 9절 — **데몬 통합 벤치**. `npm run bench:solver` (= `ci:solver` 안).
 *
 * `bench/perf.mjs` 와 프로세스를 나눈 이유는 그 파일 머리말에 있다: 솔버 자식이 전 코어를
 * 쓰므로 한 프로세스에서 재면 순수 TS 케이스의 부하 판정이 망가진다.
 *
 * 여기서는 **예산 집행을 부하에 맡기지 않는다**: 솔브 자체가 머신을 포화시키므로 하네스의
 * 부하 보정이 성립하지 않는다. 대신 지연 수치를 직접 단언한다 (넘으면 무조건 exit 1).
 * `estSeconds` 오차는 게이트가 아니라 **기록**이다 (9절 표).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JobQueue,
  PostflopSolverCli,
  SolveCache,
  buildConfig,
  configHash,
  resolveBin,
} from '../dist/index.js';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const BIN = resolveBin(REPO_ROOT);

if (BIN === null) {
  console.error('solver binary not found — npm run build:solver 를 먼저.');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'ggto-bench-'));
const cache = new SolveCache({ dir: join(dir, 'solves') });
const solver = new PostflopSolverCli({ bin: BIN, onLog: () => undefined });
const queue = new JobQueue({ solver });

const failures = [];
function check(ok, label, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${JSON.stringify(detail)}`);
  if (!ok) failures.push(label);
}

/** 한 스팟을 풀어 캐시에 넣고 (추정, 실측) 을 돌려준다. */
async function solveSpot(spot, street) {
  const cfg = buildConfig(spot);
  const hash = configHash(cfg, solver.id);
  const estimate = await queue.estimateOnly(cfg);
  const started = Date.now();
  const handle = queue.submit({
    hash,
    cfg,
    estimate,
    outPath: cache.partPath(hash),
    onSaved: (summary) => {
      cache.commit({
        hash,
        configJson: '{}',
        boardCanonical: 'canonical',
        street,
        potChips: cfg.potChips,
        stackChips: cfg.stackChips,
        sizings: JSON.stringify(cfg.sizings),
        compressed: cfg.compressed,
        exploitability: summary.exploitabilityPct,
        iterations: summary.iterations,
        bytes: summary.bytes,
        solver: solver.id,
        evBasis: 'stack_delta_from_node',
        elapsedMs: summary.elapsedMs,
      });
    },
  });
  const summary = await handle.done();
  return { cfg, hash, estimate, summary, actualSeconds: (Date.now() - started) / 1000 };
}

const RANGES = {
  oop: '88+,A9s+,KTs+,QJs,AJo+',
  ip: '77-22,A2s-A8s,K9s+,QTs+,JTs,ATo+',
};

const SPOTS = [
  ['flop simple', { ...RANGES, board: 'Ks7h2h', potBb: 20, stackBb: 80, sizings: 'simple', maxIterations: 200 }, 'flop'],
  ['turn standard', { ...RANGES, board: 'Ks7h2hQc', potBb: 20, stackBb: 80, sizings: 'standard', maxIterations: 300 }, 'turn'],
  [
    'river river-heavy',
    { ...RANGES, board: 'Ks7h2hQc3d', potBb: 20, stackBb: 80, sizings: 'river-heavy', maxIterations: 400 },
    'river',
  ],
];

try {
  const solved = [];
  for (const [label, spot, street] of SPOTS) {
    const r = await solveSpot(spot, street);
    solved.push([label, r]);
    const ratio = r.actualSeconds / r.estimate.estSeconds;
    console.log(
      `estSeconds  ${label.padEnd(20)} est=${r.estimate.estSeconds.toFixed(2)}s actual=${r.actualSeconds.toFixed(2)}s ` +
        `ratio=${ratio.toFixed(2)}  (iter ${String(r.summary.iterations)}/${String(r.cfg.maxIterations)}, ` +
        `mem ${(r.estimate.memoryBytes / 1024 ** 2).toFixed(1)}MB, expl ${r.summary.exploitabilityPct.toFixed(3)}%, ` +
        `nodes ${String(r.estimate.nodes)})`,
    );
  }

  // 콜드 스타트: 조회 데몬을 내려 두고 다시 띄운 뒤 load + 첫 node 까지를 잰다.
  await solver.shutdown();
  const turn = (solved.find(([l]) => l.startsWith('turn')) ?? solved[0])[1];
  const coldStart = Date.now();
  const handle = await solver.openWith(turn.hash, cache.binPath(turn.hash), turn.cfg.chipsPerBb);
  await handle.node('');
  const coldMs = Date.now() - coldStart;
  check(coldMs < 3000, 'cold start + load < 3000ms', { coldMs, bytes: turn.summary.bytes });

  const latencies = [];
  for (let i = 0; i < 200; i++) {
    const t = process.hrtime.bigint();
    await handle.node('');
    latencies.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  latencies.sort((a, b) => a - b);
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  check(mean < 20, 'node round trip x200 mean < 20ms', { mean: Number(mean.toFixed(3)) });
  check(p99 < 60, 'node round trip x200 p99 < 60ms', { p99: Number(p99.toFixed(3)) });

  const flop = (solved.find(([l]) => l.startsWith('flop')) ?? solved[0])[1];
  const flopHandle = await solver.openWith(flop.hash, cache.binPath(flop.hash), flop.cfg.chipsPerBb);
  const t0 = Date.now();
  const runouts = await flopHandle.runouts('X-X');
  const runoutMs = Date.now() - t0;
  check(runouts.cards.length === 49, 'runouts returns 49 turn cards', { cards: runouts.cards.length });
  check(runoutMs < 2000, 'runouts (turn, 49 cards) < 2000ms', { runoutMs });
} finally {
  await solver.shutdown();
  cache.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log('');
if (failures.length > 0) {
  console.error(`FAILED ${String(failures.length)}: ${failures.join(' · ')}`);
  process.exit(1);
}
console.log('bench:solver OK');
