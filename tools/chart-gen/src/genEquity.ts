/**
 * `equity169.json` 재생성 CLI (P2.md 7.1, P3.md 10.0). 결과는 레포에 커밋된다.
 *
 * 사용: node tools/chart-gen/dist/genEquity.js [--exact] [--out <file>] [--samples N] [--workers N]
 *
 * 14,196 개의 비대각 쌍(169·168/2)을 계산한다. 대각선은 대칭성으로 정확히 0.5 이므로
 * 계산하지 않는다.
 *   --exact (기본): 슈트 궤도 대표마다 core 의 전수 hand-vs-hand (exactEquity.ts). 근사 없음.
 *   --samples N   : 몬테카를로 폴백. 쌍마다 시드가 쌍 이름에서 결정되므로 샤딩해도
 *                   결과가 프로세스 수와 무관하게 같다.
 * 두 모드 다 샤딩이 결과에 영향을 주지 않는다 (쌍 단위로 독립).
 */

import { equityRangeVsRange, parseRange } from '@ggto/core';
import { CLASS_KEYS } from '@ggto/preflop';
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  EQUITY_FORMAT,
  EQUITY_VERSION,
  SEED_RULE,
  equitySha256,
  pairSeed,
  roundEquity,
  type EquityMode,
  type EquityTable,
} from './equityTable.js';
import { exactClassEquity } from './exactEquity.js';

const N = CLASS_KEYS.length;
const PROGRESS_EVERY = 20;

interface PairResult {
  i: number;
  j: number;
  v: number;
}

/** i<j 인 쌍 전부. 인덱스가 곧 작업 번호다 (샤딩 기준). */
function allPairs(): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) out.push([i, j]);
  return out;
}

function computePairMc(i: number, j: number, samples: number): number {
  const a = CLASS_KEYS[i] as string;
  const b = CLASS_KEYS[j] as string;
  const r = equityRangeVsRange(parseRange(a), parseRange(b), [], {
    mode: 'monte-carlo',
    samples,
    seed: pairSeed(a, b),
  });
  return roundEquity(r.hero);
}

function computePair(i: number, j: number, mode: EquityMode, samples: number): number {
  return mode === 'exact' ? roundEquity(exactClassEquity(i, j)) : computePairMc(i, j, samples);
}

function runShard(shard: number, shards: number, mode: EquityMode, samples: number): void {
  const pairs = allPairs();
  const results: PairResult[] = [];
  for (let k = shard; k < pairs.length; k += shards) {
    const [i, j] = pairs[k] as [number, number];
    results.push({ i, j, v: computePair(i, j, mode, samples) });
    if (results.length % PROGRESS_EVERY === 0) process.send?.({ type: 'progress', done: results.length });
  }
  process.send?.({ type: 'done', results });
}

async function runParent(out: string, mode: EquityMode, samples: number, workers: number): Promise<void> {
  const pairs = allPairs();
  const self = fileURLToPath(import.meta.url);
  const t0 = Date.now();
  let done = 0;

  const shardResults = await Promise.all(
    Array.from({ length: workers }, (_unused, shard) =>
      new Promise<PairResult[]>((resolvePromise, reject) => {
        const args = ['--shard', String(shard), '--shards', String(workers)];
        // --exact 와 --samples 는 배타적이다 (아래 인자 파싱). 자식에게도 하나만 넘긴다.
        if (mode === 'exact') args.push('--exact');
        else args.push('--samples', String(samples));
        const child = fork(self, args);
        child.on('message', (msg: { type: string; done?: number; results?: PairResult[] }) => {
          if (msg.type === 'progress') {
            done += PROGRESS_EVERY;
            const pct = ((done / pairs.length) * 100).toFixed(1);
            const elapsed = (Date.now() - t0) / 1000;
            const eta = done === 0 ? 0 : (elapsed / done) * (pairs.length - done);
            process.stdout.write(
              `\r${String(done)}/${String(pairs.length)} pairs (${pct}%) ${elapsed.toFixed(0)}s elapsed, eta ${eta.toFixed(0)}s   `,
            );
          } else if (msg.type === 'done') resolvePromise(msg.results ?? []);
        });
        child.on('error', reject);
        child.on('exit', (code) => {
          if (code !== 0) reject(new Error(`shard ${String(shard)} exited with code ${String(code)}`));
        });
      }),
    ),
  );
  process.stdout.write('\n');

  const equity: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0.5));
  for (const list of shardResults) {
    for (const { i, j, v } of list) {
      (equity[i] as number[])[j] = v;
      // 두 값의 합은 정확히 1 이어야 한다 (에퀴티의 정의). 6자리 반올림 뒤 빼서 그 성질을 유지한다.
      (equity[j] as number[])[i] = roundEquity(1 - v);
    }
  }

  const table: EquityTable = {
    format: EQUITY_FORMAT,
    version: EQUITY_VERSION,
    meta: {
      samples: mode === 'exact' ? null : samples,
      seedRule: mode === 'exact' ? null : SEED_RULE,
      coreVersion: coreVersion(),
      mode,
      diagonal: 'exact 0.5 by symmetry (not computed)',
      generatedAt: new Date().toISOString(),
      sha256: '',
    },
    classes: [...CLASS_KEYS],
    equity,
  };
  table.meta.sha256 = equitySha256(table);
  writeFileSync(out, `${JSON.stringify(table)}\n`, 'utf8');
  console.log(
    `wrote ${out}  pairs=${String(pairs.length)}  mode=${mode}  samples=${mode === 'exact' ? 'n/a' : String(samples)}  sha256=${table.meta.sha256}`,
  );
  console.log(`elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

/** 표가 어느 core 로 만들어졌는지 남긴다 (평가기/샘플러가 바뀌면 표를 다시 만들어야 한다). */
function coreVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/ 에서 실행되므로 dist → chart-gen → tools → <repo>
  const pkgPath = resolve(here, '../../../packages/core/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
  return `@ggto/core@${pkg.version ?? 'unknown'}`;
}

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    exact: { type: 'boolean' },
    samples: { type: 'string' },
    workers: { type: 'string' },
    shard: { type: 'string' },
    shards: { type: 'string' },
  },
});

const samples = values.samples === undefined ? 200_000 : Number(values.samples);
if (!Number.isInteger(samples) || samples < 1) throw new Error(`--samples must be a positive integer`);
// 기본은 전수다. MC 를 쓰려면 --samples 를 명시해야 한다 (실수로 근사 표를 커밋하지 않도록).
const mode: EquityMode = values.exact === true || values.samples === undefined ? 'exact' : 'monte-carlo';
if (values.exact === true && values.samples !== undefined) {
  throw new Error('--exact and --samples are mutually exclusive');
}

if (values.shard !== undefined && values.shards !== undefined) {
  runShard(Number(values.shard), Number(values.shards), mode, samples);
} else {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = values.out === undefined ? resolve(here, '../data/equity169.json') : resolve(values.out);
  const workers = values.workers === undefined ? Math.max(1, cpus().length) : Number(values.workers);
  await runParent(out, mode, samples, workers);
}
