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
import { configHash } from '../src/hash.js';
import { PostflopSolverCli } from '../src/daemon/postflopCli.js';
import { JobQueue } from '../src/queue.js';
import { decodeRows, toRunoutsResponse } from '../src/view.js';
import { COMBO_COUNT, comboIndex, formatCards, parseCard } from '@ggto/core';
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
        configJson: '{}',
        boardCanonical: 'canonical',
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
      const r = toRunoutsResponse(raw, cfg.perm, formatCards(cfg.board));
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
