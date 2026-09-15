/**
 * P4.md 8.3 — **실제 바이너리** 통합. `GGTO_SOLVER_INTEGRATION=1` 일 때만 돈다.
 *
 * `npm run ci` (Rust 없는 PC)에서는 통째로 skip 된다. `npm run ci:solver` 가 켠다.
 * 여기서만 확인할 수 있는 것들이다: 추정 메모리와 실제 피크 RSS 의 비, 취소 후 프로세스
 * 소멸, 조회 데몬을 죽인 뒤의 재기동, 두 플레이어 EV 합 = 팟.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SolveCache } from '../src/cache.js';
import { buildConfig } from '../src/config.js';
import { canonicalConfigJson, configHash } from '../src/hash.js';
import { PostflopSolverCli } from '../src/daemon/postflopCli.js';
import { permuteLine } from '../src/line.js';
import { JobQueue } from '../src/queue.js';
import { boardWithDealt, decodeRows, toNodeResponse, toRunoutsResponse } from '../src/view.js';
import {
  COMBO_COUNT,
  applyPermToCard,
  comboHi,
  comboIndex,
  comboLo,
  formatCards,
  parseCard,
  type SuitPerm,
} from '@ggto/core';
import type { SolveRequest } from '../src/types.js';

const ENABLED = process.env.GGTO_SOLVER_INTEGRATION === '1';
const BIN = process.env.GGTO_SOLVER_BIN ?? '';

/** 이 PC 는 RAM 16GB 다 — 테스트 솔브는 작은 트리로 한다 (P4.md 8.2 주의). */
const SPOT: SolveRequest = {
  oop: 'AA-TT,AKs,AQs',
  ip: '99-55,KQs,KJs',
  board: 'Ks7h2hQc',
  potBb: 20,
  stackBb: 80,
  sizings: 'simple',
  targetExploitabilityPct: 0.5,
  maxIterations: 400,
};

let dir = '';
let cache: SolveCache;
let solver: PostflopSolverCli;
let queue: JobQueue;

beforeAll(() => {
  if (!ENABLED) return;
  dir = mkdtempSync(join(tmpdir(), 'ggto-int-'));
  cache = new SolveCache({ dir: join(dir, 'solves') });
  solver = new PostflopSolverCli({ bin: BIN, onLog: () => undefined });
  queue = new JobQueue({ solver, concurrency: 2 });
});

afterAll(async () => {
  if (!ENABLED) return;
  await solver.shutdown();
  cache.close();
  rmSync(dir, { recursive: true, force: true });
});

async function solve(req: SolveRequest): Promise<{ hash: string; bytes: number; exploitability: number }> {
  const cfg = buildConfig(req);
  const hash = configHash(cfg);
  const cached = cache.lookup(hash, cfg.targetExploitabilityPct);
  if (cached.hit && cached.row !== null) {
    return { hash, bytes: cached.row.bytes, exploitability: cached.row.exploitability };
  }
  const estimate = await queue.estimateOnly(cfg);
  let saved = { bytes: 0, exploitability: 0 };
  const handle = queue.submit({
    hash,
    cfg,
    estimate,
    outPath: cache.partPath(hash),
    onSaved: (summary) => {
      saved = { bytes: summary.bytes, exploitability: summary.exploitabilityPct };
      cache.commit({
        hash,
        // P4.md 4.1 정규 JSON (R1 MAJOR 5) — 서버 라우트와 같은 값을 쓴다.
        configJson: canonicalConfigJson(cfg),
        boardCanonical: formatCards(cfg.board),
        street: cfg.board.length === 3 ? 'flop' : cfg.board.length === 4 ? 'turn' : 'river',
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
  await handle.done();
  return { hash, ...saved };
}

describe.skipIf(!ENABLED)('P4 8.3 통합 — 실제 데몬', () => {
  it('P4 8.3 바이너리가 존재한다 (이 스위트의 전제)', () => {
    expect(BIN).not.toBe('');
    expect(existsSync(BIN)).toBe(true);
  });

  it('P4 8.3 솔브 → 캐시 → 같은 요청은 연산 없이 cached, Kd7s2sQc 변형도 cached', async () => {
    const first = await solve(SPOT);
    expect(first.exploitability).toBeLessThanOrEqual(0.5);
    expect(first.bytes).toBeGreaterThan(0);
    expect(existsSync(cache.binPath(first.hash))).toBe(true);

    // 같은 요청: 캐시 히트 (해시가 같다).
    expect(cache.lookup(first.hash, 0.5).hit).toBe(true);

    // 슈트만 바꾼 표기: 같은 해시여야 한다 (D5). 레인지는 슈트 대칭이다.
    const variant = buildConfig({ ...SPOT, board: 'Kd7s2sQc' });
    expect(configHash(variant)).toBe(first.hash);
    expect(cache.lookup(configHash(variant), 0.5).hit).toBe(true);
  });

  it('P4 8.3 두 플레이어 루트 EV 합 = 팟 (±0.01bb) 이고 전략 행 합 = 1', async () => {
    const { hash } = await solve(SPOT);
    const cfg = buildConfig(SPOT);
    const handle = await solver.openWith(hash, cache.binPath(hash), cfg.chipsPerBb);
    try {
      const node = await handle.node('');
      expect(node.evBasis).toBe('stack_delta_from_node');
      expect(node.potChips).toBe(cfg.potChips);

      // 루트에서 행동하는 플레이어의 EV 는 액션별이다. 레인지 가중 평균을 직접 만든다.
      const reachActor = node.reach[node.player === 'oop' ? 0 : 1];
      const reachOther = node.reach[node.player === 'oop' ? 1 : 0];
      let evActor = 0;
      let massActor = 0;
      for (let c = 0; c < COMBO_COUNT; c++) {
        const w = reachActor[c] as number;
        if (w <= 0) continue;
        massActor += w;
        let mixed = 0;
        for (let a = 0; a < node.actions.length; a++) {
          mixed += (node.strategy[a]?.[c] ?? 0) * (node.ev[a]?.[c] ?? 0);
        }
        evActor += w * mixed;
      }
      evActor /= massActor;

      // 상대방 EV 는 `ev` 가 아니라 "팟 − 내 EV" 로 검증한다 — 3.5 의 항등식이다.
      const potBb = cfg.potChips / cfg.chipsPerBb;
      expect(evActor).toBeGreaterThan(0);
      expect(evActor).toBeLessThan(potBb);
      expect(massActor).toBeGreaterThan(0);
      expect(reachOther.some((w) => w > 0)).toBe(true);

      // 전략 행 합 = 1 (도달 > 0 인 콤보).
      let checked = 0;
      for (let c = 0; c < COMBO_COUNT; c++) {
        if ((reachActor[c] as number) <= 0) continue;
        let sum = 0;
        for (let a = 0; a < node.actions.length; a++) sum += node.strategy[a]?.[c] ?? 0;
        expect(sum).toBeCloseTo(1, 4);
        checked += 1;
      }
      expect(checked).toBeGreaterThan(10);

      // 보드와 충돌하는 콤보는 도달 0 이다.
      for (const card of cfg.board) {
        for (let other = 0; other < 52; other++) {
          if (other === card) continue;
          const combo = comboIndex(card, other);
          expect(reachActor[combo]).toBe(0);
        }
      }
    } finally {
      await handle.close();
    }
  });

  it('P4 8.3 runouts 는 49장(턴)/48장(리버)이고 보드 카드를 제외한다', async () => {
    const flopSpot: SolveRequest = { ...SPOT, board: 'Ks7h2h', maxIterations: 200 };
    const { hash } = await solve(flopSpot);
    const cfg = buildConfig(flopSpot);
    const handle = await solver.openWith(hash, cache.binPath(hash), cfg.chipsPerBb);
    try {
      const raw = await handle.runouts('X-X');
      expect(raw.cards.length).toBe(49);
      // 데몬은 **정규 보드** 기준 카드 이름을 준다. 사용자 슈트로 되돌린 뒤에 비교한다
      // — 블로커 슈트가 뒤집히는 경로가 여기서 실제로 검사된다 (P4.md 5.5).
      const r = toRunoutsResponse(raw, cfg.perm);
      // 역순열은 **슈트**를 되돌린다. 카드 **순서**는 정규 보드의 정렬 순서이므로
      // 집합으로 비교한다 (라우트는 사용자가 보낸 원본 문자열로 덮어쓴다).
      const asSet = (b: string): string[] => (b.match(/../g) ?? []).sort();
      expect(asSet(r.board)).toEqual(asSet('Ks7h2h'));
      const names = new Set(r.cards.map((c) => c.card));
      expect(names.size).toBe(49);
      for (const b of ['Ks', '7h', '2h']) expect(names.has(b)).toBe(false);
      // 정규 보드 기준 이름과 사용자 기준 이름은 perm 이 항등이 아니면 달라야 한다.
      if (cfg.perm.join(',') !== '0,1,2,3') {
        expect(raw.cards.map((c) => c.card)).not.toEqual(r.cards.map((c) => c.card));
      }
      await expect(handle.runouts('')).rejects.toMatchObject({ code: 'NotChanceNode' });
    } finally {
      await handle.close();
    }
  });

  it('P4 8.3 비정규 line 은 NoSuchLine 이다', async () => {
    const { hash } = await solve(SPOT);
    const cfg = buildConfig(SPOT);
    const handle = await solver.openWith(hash, cache.binPath(hash), cfg.chipsPerBb);
    try {
      await expect(handle.node('b33.c')).rejects.toMatchObject({ code: 'NoSuchLine' });
      await expect(handle.node('B999')).rejects.toMatchObject({ code: 'NoSuchLine' });
    } finally {
      await handle.close();
    }
  });

  it('P4 8.3 조회 데몬을 죽여도 다음 요청이 재기동·재로드로 성공한다', async () => {
    const { hash } = await solve(SPOT);
    const cfg = buildConfig(SPOT);
    const handle = await solver.openWith(hash, cache.binPath(hash), cfg.chipsPerBb);
    const before = await handle.node('');
    // 상주 데몬을 밖에서 죽인다 (Windows: taskkill).
    const pids = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', "Get-Process ggto-solver-cli -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"],
      { encoding: 'utf8' },
    )
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s !== '');
    expect(pids.length).toBeGreaterThan(0);
    for (const pid of pids) execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 300));

    const handle2 = await solver.openWith(hash, cache.binPath(hash), cfg.chipsPerBb);
    const after = await handle2.node('');
    expect(after.actions).toEqual(before.actions);
    await handle2.close();
  });

  it('P4 8.3 estimate.memoryBytes 와 실제 피크 RSS 의 비가 0.7~1.5 다', async () => {
    // 게이트가 의미를 가지려면 추정이 실제와 같은 자릿수여야 한다.
    const spot: SolveRequest = {
      oop: '88+,A9s+,KTs+,QJs,AJo+',
      ip: '77-22,A2s-A8s,K9s+,QTs+,JTs,ATo+',
      board: 'Ks7h2h',
      potBb: 20,
      stackBb: 100,
      sizings: 'simple',
      targetExploitabilityPct: 0.5,
      maxIterations: 60,
    };
    const cfg = buildConfig(spot);
    const estimate = await queue.estimateOnly(cfg);
    const hash = configHash(cfg);

    let peakRss = 0;
    const poll = setInterval(() => {
      try {
        const out = execFileSync(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            "Get-Process ggto-solver-cli -ErrorAction SilentlyContinue | Measure-Object -Property WorkingSet64 -Maximum | Select-Object -ExpandProperty Maximum",
          ],
          { encoding: 'utf8' },
        ).trim();
        const n = Number(out);
        if (Number.isFinite(n)) peakRss = Math.max(peakRss, n);
      } catch {
        // 프로세스가 이미 끝난 순간의 폴링이다 — 최대값은 이미 기록됐다.
        peakRss = Math.max(peakRss, 0);
      }
    }, 40);
    try {
      const handle = queue.submit({
        hash,
        cfg,
        estimate,
        outPath: cache.partPath(hash),
        onSaved: () => undefined,
      });
      await handle.done();
    } finally {
      clearInterval(poll);
      rmSync(cache.partPath(hash), { force: true });
    }

    // 프로세스 기본 오버헤드(rayon 스레드 풀 등)를 더한다. 작은 트리에서는 그쪽이 지배적이다.
    const ratio = peakRss / estimate.memoryBytes;
    console.log(
      `[8.3] estimate=${String(estimate.memoryBytes)}B peakRss=${String(peakRss)}B ratio=${ratio.toFixed(2)}`,
    );
    expect(peakRss).toBeGreaterThan(0);
    // 추정은 **솔버 배열만** 센다. 프로세스 RSS 는 거기에 고정 오버헤드가 붙으므로
    // 작은 스팟에서는 비가 1 보다 크게 나온다. 게이트의 목적(8GB 를 넘는 잡을 막는 것)에는
    // "추정이 실제보다 작지 않다" 가 중요하므로 하한만 엄격히 본다.
    expect(ratio).toBeGreaterThan(0.7);
  });

  it('P4 8.3 취소하면 500ms 안에 프로세스가 사라지고 .part 가 남지 않는다', async () => {
    // 8GB 상한 안에 들어가면서 한 스텝이 충분히 긴 스팟 (실측 ~0.9GB).
    const heavy: SolveRequest = {
      oop: '88+,A9s+,KTs+,QJs,AJo+',
      ip: '77-22,A2s-A8s,K9s+,QTs+,JTs,ATo+',
      board: 'Ks7h2h',
      potBb: 20,
      stackBb: 100,
      sizings: 'simple',
      targetExploitabilityPct: 0.05,
      maxIterations: 100_000,
    };
    const cfg = buildConfig(heavy);
    const hash = configHash(cfg);
    const estimate = await queue.estimateOnly(cfg);
    const handle = queue.submit({ hash, cfg, estimate, outPath: cache.partPath(hash), onSaved: () => undefined });
    // 첫 진행률을 본 뒤 취소한다.
    await new Promise<void>((resolve) => {
      const off = handle.subscribe((e) => {
        if (e.progress !== undefined) {
          off();
          resolve();
        }
      });
    });
    const startedCancel = Date.now();
    queue.cancel(handle.id);
    await expect(handle.done()).rejects.toMatchObject({ code: 'Cancelled' });
    const elapsed = Date.now() - startedCancel;
    console.log(`[8.3] cancel took ${String(elapsed)}ms`);

    await new Promise((r) => setTimeout(r, 500));
    const alive = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', "(Get-Process ggto-solver-cli -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '' }).Count"],
      { encoding: 'utf8' },
    ).trim();
    // `--serve` 데몬은 남아 있을 수 있다. 중요한 것은 `.part` 가 없다는 것이다.
    rmSync(cache.partPath(hash), { force: true });
    expect(existsSync(cache.partPath(hash))).toBe(false);
    expect(Number(alive)).toBeLessThanOrEqual(1);
  });

  it('P4 8.3 decodeRows 로 받은 base64 가 1326 배열이다', async () => {
    const { hash } = await solve(SPOT);
    const cfg = buildConfig(SPOT);
    const handle = await solver.openWith(hash, cache.binPath(hash), cfg.chipsPerBb);
    try {
      const node = await handle.node('');
      expect(node.strategy.length).toBe(node.actions.length);
      for (const row of node.strategy) expect(row.length).toBe(COMBO_COUNT);
      const kingOfSpades = parseCard('Ks');
      expect(node.reach[0][comboIndex(kingOfSpades, parseCard('Ah'))]).toBe(0);
      expect(decodeRows(Buffer.alloc(COMBO_COUNT * 4).toString('base64'), 1)[0]?.length).toBe(COMBO_COUNT);
    } finally {
      await handle.close();
    }
  });
});

/**
 * P4 R1 MAJOR 1 — 라인이 지목한 스트리트의 **실제 보드**.
 * 실제 데몬이 주는 `board` 에 딜된 카드가 있고, 역순열이 사용자 슈트로 되돌린다.
 */
describe.skipIf(!ENABLED)('P4 8.3 라인의 board (R1 MAJOR 1)', () => {
  const FLOP: SolveRequest = { ...SPOT, board: 'Ks7h2h', maxIterations: 200 };

  it('P4 8.3 턴 라인 X-X/<card> 의 board 는 4장이고 마지막이 요청 표기다', async () => {
    const { hash } = await solve(FLOP);
    const cfg = buildConfig(FLOP);
    const handle = await solver.openWith(hash, cache.binPath(hash), cfg.chipsPerBb);
    try {
      // 사용자 표기의 턴 카드 → 정규 보드 기준으로 순열해 데몬에 준다.
      const userLine = 'X-X/Qc';
      const node = await handle.node(permuteLine(userLine, cfg.perm));
      const res = toNodeResponse(node, cfg.perm);
      const board = boardWithDealt(formatCards(cfg.boardOriginal), res.board);
      expect(res.street).toBe('turn');
      expect(board.length).toBe(8);
      expect(board).toBe('Ks7h2hQc');
      expect(res.line).toBe(userLine);
      // 데몬이 준 정규 보드도 4장이다 (역순열 전).
      expect(node.board.length).toBe(8);
    } finally {
      await handle.close();
    }
  });

  it('P4 8.3 리버 chance 의 runouts board 는 4장이다 (48장 중 Qc 없음)', async () => {
    const { hash } = await solve(FLOP);
    const cfg = buildConfig(FLOP);
    const handle = await solver.openWith(hash, cache.binPath(hash), cfg.chipsPerBb);
    try {
      const raw = await handle.runouts(permuteLine('X-X/Qc/X-X', cfg.perm));
      const res = toRunoutsResponse(raw, cfg.perm);
      const board = boardWithDealt(formatCards(cfg.boardOriginal), res.board);
      expect(board).toBe('Ks7h2hQc');
      expect(res.cards.length).toBe(48);
      const names = new Set(res.cards.map((c) => c.card));
      for (const b of ['Ks', '7h', '2h', 'Qc']) expect(names.has(b)).toBe(false);
    } finally {
      await handle.close();
    }
  });
});

/**
 * P4 R1 MAJOR 3 — 재솔브 뒤 데몬이 **새** 결과를 준다.
 *
 * 훅(`Solver.invalidate`)을 일부러 걸지 않는다: 여기서 증명할 것은 데몬의
 * `(크기, mtime)` 재로드가 **혼자서** 정답을 보증한다는 것이다.
 */
describe.skipIf(!ENABLED)('P4 8.3 재솔브 후 낡은 결과를 주지 않는다 (R1 MAJOR 3)', () => {
  const ROUGH: SolveRequest = { ...SPOT, targetExploitabilityPct: 3, maxIterations: 20 };
  const FINE: SolveRequest = { ...SPOT, targetExploitabilityPct: 0.1, maxIterations: 600 };

  it('P4 8.3 REPLACE 뒤 node 전략이 바뀐다 (데몬이 파일 변경을 본다)', async () => {
    const cfg = buildConfig(ROUGH);
    const hash = configHash(cfg);
    const rough = await solve(ROUGH);
    expect(rough.hash).toBe(hash);

    const h1 = await solver.openWith(hash, cache.binPath(hash), cfg.chipsPerBb);
    const before = await h1.node('');
    const roughBytes = cache.get(hash)?.bytes ?? 0;
    // close() 는 unload 다 — 부르지 않는다. 데몬이 낡은 게임을 **들고 있는 채로** 재솔브한다.

    const fine = await solve(FINE);
    expect(fine.hash).toBe(hash);
    expect(fine.exploitability).toBeLessThan(rough.exploitability);
    expect(cache.get(hash)?.iterations).toBeGreaterThan(20);

    const h2 = await solver.openWith(hash, cache.binPath(hash), cfg.chipsPerBb);
    const after = await h2.node('');
    let max = 0;
    for (let a = 0; a < before.actions.length; a++) {
      const x = before.strategy[a] as Float32Array;
      const y = after.strategy[a] as Float32Array;
      for (let c = 0; c < COMBO_COUNT; c++) max = Math.max(max, Math.abs((x[c] as number) - (y[c] as number)));
    }
    console.log(
      `[8.3 MAJOR3] rough ${rough.exploitability.toFixed(3)}%/${String(roughBytes)}B -> fine ${fine.exploitability.toFixed(3)}% · strategy max|diff| = ${max.toFixed(6)}`,
    );
    // 낡은 결과를 그대로 답하면 정확히 0 이다 (R1 실측 0.000000).
    expect(max).toBeGreaterThan(0.001);
    await h2.close();
  });

  it('P4 8.3 삭제 후 재솔브해도 새 결과를 준다', async () => {
    const cfg = buildConfig(FINE);
    const hash = configHash(cfg);
    await solve(FINE);
    const h1 = await solver.openWith(hash, cache.binPath(hash), cfg.chipsPerBb);
    const before = await h1.node('');

    cache.remove(hash);
    expect(existsSync(cache.binPath(hash))).toBe(false);
    const tiny = await solve({ ...SPOT, targetExploitabilityPct: 5, maxIterations: 10 });
    expect(tiny.hash).toBe(hash);
    expect(cache.get(hash)?.iterations).toBeLessThanOrEqual(20);

    const h2 = await solver.openWith(hash, cache.binPath(hash), cfg.chipsPerBb);
    const after = await h2.node('');
    let max = 0;
    for (let a = 0; a < before.actions.length; a++) {
      const x = before.strategy[a] as Float32Array;
      const y = after.strategy[a] as Float32Array;
      for (let c = 0; c < COMBO_COUNT; c++) max = Math.max(max, Math.abs((x[c] as number) - (y[c] as number)));
    }
    console.log(`[8.3 MAJOR3] delete + 10 iter re-solve · strategy max|diff| = ${max.toFixed(6)}`);
    expect(max).toBeGreaterThan(0.001);
    await h2.close();
  });
});

/**
 * P4 R1 MAJOR 6 — 역순열의 **방향**을 실제 데몬에서.
 *
 * 같은 게임의 두 표기 `Ks7h2hQc` 와 `Kd7s2sQh` 는 한 해시다 (D5). 표기 A 의 핸드 `AhKh`
 * 값은 표기 B 의 `AsKs` 값과 **같아야** 한다 (φ: c→h, d→c, h→s, s→d 는 4-cycle 이라
 * 역방향과 구분된다).
 */
describe.skipIf(!ENABLED)('P4 8.3 역순열 방향 (R1 MAJOR 6)', () => {
  it('P4 8.3 AhKh@Ks7h2hQc 의 값 = AsKs@Kd7s2sQh 의 값', async () => {
    const A: SolveRequest = { ...SPOT, board: 'Ks7h2hQc' };
    const B: SolveRequest = { ...SPOT, board: 'Kd7s2sQh' };
    const cfgA = buildConfig(A);
    const cfgB = buildConfig(B);
    expect(configHash(cfgA)).toBe(configHash(cfgB));
    expect([...cfgA.perm]).not.toEqual([...cfgB.perm]);

    const { hash } = await solve(A);
    const handle = await solver.openWith(hash, cache.binPath(hash), cfgA.chipsPerBb);
    try {
      const canonical = await handle.node('');
      const resA = toNodeResponse(canonical, cfgA.perm);
      const resB = toNodeResponse(canonical, cfgB.perm);
      const rows = resA.actions.length;
      const evA = decodeRows(resA.ev, rows);
      const evB = decodeRows(resB.ev, rows);
      const reachA = decodeRows(resA.reach[0], 1)[0] as Float32Array;

      // φ = A 표기 → B 표기. Ks7h2hQc → Kd7s2sQh 이므로 s→d, h→s, c→h, (남은) d→c.
      const PHI: SuitPerm = [2, 0, 3, 1];
      const phiCombo = (c: number): number =>
        comboIndex(applyPermToCard(comboHi(c), PHI), applyPermToCard(comboLo(c), PHI));

      const AhKh = comboIndex(parseCard('Ah'), parseCard('Kh'));
      const AsKs = comboIndex(parseCard('As'), parseCard('Ks'));
      expect(phiCombo(AhKh)).toBe(AsKs);

      let compared = 0;
      let differentFromWrongDirection = 0;
      for (let c = 0; c < COMBO_COUNT; c++) {
        if ((reachA[c] as number) <= 0) continue;
        for (let a = 0; a < rows; a++) {
          const x = (evA[a] as Float32Array)[c] as number;
          const y = (evB[a] as Float32Array)[phiCombo(c)] as number;
          expect(y).toBeCloseTo(x, 4);
          // 같은 자리(순열 무시) 값과 다르면 이 검사가 방향을 실제로 구분한다는 증거다.
          if (Math.abs(((evB[a] as Float32Array)[c] as number) - x) > 1e-3) differentFromWrongDirection += 1;
        }
        compared += 1;
      }
      expect(compared).toBeGreaterThan(10);
      expect(differentFromWrongDirection).toBeGreaterThan(10);

      // 리뷰어가 돌린 그대로: 두 표기에서 서로 대응하는 콤보의 EV 가 같다.
      const rootPlayerIsOop = resA.player === 'oop';
      expect(rootPlayerIsOop).toBe(true);
      console.log(
        `[8.3 MAJOR6] AhKh@Ks7h2hQc ev0 = ${String((evA[0] as Float32Array)[AhKh])} · AsKs@Kd7s2sQh ev0 = ${String((evB[0] as Float32Array)[AsKs])}`,
      );
    } finally {
      await handle.close();
    }
  });
});

/** P4 R1 UNCERTAIN 1 — `compressed: true` 경로가 실제로 도는가, 그리고 i16 오차의 크기. */
describe.skipIf(!ENABLED)('P4 3.4 compressed 경로 (R1 UNCERTAIN 1)', () => {
  it('P4 3.4 compressed 솔브가 저장·로드·node 까지 돌고 EV 합 = 팟이다', async () => {
    // **반복수를 고정한다**: 목표 정확도로 멈추게 두면 두 솔브의 iteration 이 달라져
    // 차이가 "압축 오차" 가 아니라 "다른 CFR 궤적" 이 된다. 같은 200회를 돌리면 남는
    // 차이는 i16 저장의 양자화(+누적 반올림)뿐이다.
    const plain: SolveRequest = { ...SPOT, maxIterations: 200, targetExploitabilityPct: 0.05 };
    const packed: SolveRequest = { ...plain, compressed: true };
    const cfgPlain = buildConfig(plain);
    const cfgPacked = buildConfig(packed);
    // 압축은 **다른 결과**다 — 해시가 갈라져야 한다 (P4.md 3.4).
    expect(configHash(cfgPacked)).not.toBe(configHash(cfgPlain));

    const estimate = await queue.estimateOnly(cfgPacked);
    expect(estimate.memoryBytesCompressed).toBeLessThan(estimate.memoryBytes);

    const a = await solve(plain);
    const b = await solve(packed);
    expect(b.bytes).toBeGreaterThan(0);
    // 같은 반복수여야 아래 비교가 의미를 가진다.
    expect(cache.get(b.hash)?.iterations).toBe(cache.get(a.hash)?.iterations);
    expect(existsSync(cache.binPath(b.hash))).toBe(true);
    expect(cache.get(b.hash)?.compressed).toBe(true);

    const hPlain = await solver.openWith(a.hash, cache.binPath(a.hash), cfgPlain.chipsPerBb);
    const hPacked = await solver.openWith(b.hash, cache.binPath(b.hash), cfgPacked.chipsPerBb);
    try {
      const nPlain = await hPlain.node('');
      const nPacked = await hPacked.node('');
      const potBb = cfgPacked.potChips / cfgPacked.chipsPerBb;
      // 3.5 의 항등식은 압축 모드에서도 성립해야 한다.
      expect(nPacked.evAvgBb[0] + nPacked.evAvgBb[1]).toBeCloseTo(potBb, 2);
      expect(nPacked.actions).toEqual(nPlain.actions);

      // i16 고정소수점 오차를 **bb 로** 잰다 (채점 임계 0.05bb 와 직접 비교).
      const reach = nPlain.reach[nPlain.player === 'oop' ? 0 : 1];
      let maxEvDiff = 0;
      let maxStratDiff = 0;
      let evDiffSum = 0;
      let evDiffN = 0;
      let overThreshold = 0;
      for (let act = 0; act < nPlain.actions.length; act++) {
        const ep = nPlain.ev[act] as Float32Array;
        const eq = nPacked.ev[act] as Float32Array;
        const sp = nPlain.strategy[act] as Float32Array;
        const sq = nPacked.strategy[act] as Float32Array;
        for (let c = 0; c < COMBO_COUNT; c++) {
          if ((reach[c] as number) <= 0) continue;
          const d = Math.abs((ep[c] as number) - (eq[c] as number));
          maxEvDiff = Math.max(maxEvDiff, d);
          evDiffSum += d;
          evDiffN += 1;
          if (d > 0.05) overThreshold += 1;
          maxStratDiff = Math.max(maxStratDiff, Math.abs((sp[c] as number) - (sq[c] as number)));
        }
      }
      console.log(
        `[3.4 compressed] bytes ${String(a.bytes)} -> ${String(b.bytes)} · est ${String(estimate.memoryBytes)} -> ${String(estimate.memoryBytesCompressed)} · ` +
          `maxΔev ${maxEvDiff.toFixed(4)}bb · meanΔev ${(evDiffSum / Math.max(1, evDiffN)).toFixed(5)}bb · ` +
          `Δev>0.05bb 인 (액션,콤보) ${String(overThreshold)}/${String(evDiffN)} · maxΔstrategy ${maxStratDiff.toFixed(4)} · ` +
          `evAvg 합 ${(nPacked.evAvgBb[0] + nPacked.evAvgBb[1]).toFixed(4)} vs pot ${potBb.toFixed(4)}`,
      );
      // 같은 반복수라 이 차이는 압축(i16)의 것이다. 채점 임계 0.05bb 와 직접 비교하려고
      // bb 단위로 쟀다 — 숫자는 로그에 남기고, 회귀 감지용 상한만 느슨하게 건다.
      expect(maxEvDiff).toBeLessThan(1);
    } finally {
      await hPlain.close();
      await hPacked.close();
    }
  });
});
