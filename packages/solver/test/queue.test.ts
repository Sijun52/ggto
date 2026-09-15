/**
 * P4.md 8.1 — 잡 큐와 **메모리 게이트** (5.2). `FakeSolver` 로 돌린다 (Rust 불필요).
 *
 * 여기서 확인하는 것은 "동시 2" 가 아니라 **합산 메모리**다. 세마포어만으로는 OOM 을
 * 못 막는다: 4GB 둘과 0.5GB 둘은 같은 "2 잡" 이다.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildConfig } from '../src/config.js';
import { FakeSolver } from '../src/fakeSolver.js';
import { configHash } from '../src/hash.js';
import { JobQueue, type JobEvent } from '../src/queue.js';
import { SolverError, type CanonicalConfig, type SolveRequest } from '../src/types.js';

const GB = 1024 ** 3;

const BASE: SolveRequest = {
  oop: '22+,A2s+',
  ip: 'TT-22,AJs-A2s',
  board: 'Ks7h2h',
  potBb: 20,
  stackBb: 80,
  sizings: 'simple',
};

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ggto-queue-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function cfgFor(board: string): CanonicalConfig {
  return buildConfig({ ...BASE, board });
}

/** 보드마다 다른 해시를 얻기 위한 목록 (전부 유효한 플랍) */
const BOARDS = ['Ks7h2h', 'Ks7h3h', 'Ks7h4h', 'Ks7h5h', 'Ks7h6h'];

function submit(
  q: JobQueue,
  dir: string,
  board: string,
  opts: { estimate?: { memoryBytes: number } } = {},
): { handle: ReturnType<JobQueue['submit']>; events: JobEvent[]; hash: string } {
  const cfg = cfgFor(board);
  const hash = configHash(cfg);
  const events: JobEvent[] = [];
  const memory = opts.estimate?.memoryBytes;
  const handle = q.submit({
    hash,
    cfg,
    outPath: join(dir, `${hash}.bin.part`),
    onSaved: () => undefined,
    ...(memory === undefined
      ? {}
      : {
          estimate: { nodes: 1, memoryBytes: memory, memoryBytesCompressed: memory, estSeconds: 1 },
        }),
  });
  handle.subscribe((e) => events.push(e));
  return { handle, events, hash };
}

describe('P4 5.2 잡 큐 — 동시성', () => {
  it('P4 5.2 동시 2, 세 번째는 queued 로 기다린다', async () => {
    const dir = tmp();
    const solver = new FakeSolver({ solveMs: 120, progressSteps: 2 });
    const q = new JobQueue({ solver, concurrency: 2, memoryBytes: 8 * GB });
    const jobs = BOARDS.slice(0, 3).map((b) => submit(q, dir, b));
    await new Promise((r) => setTimeout(r, 40));
    const statuses = jobs.map((j) => j.handle.status);
    expect(statuses.filter((s) => s === 'queued').length).toBe(1);
    expect(statuses.filter((s) => s === 'running' || s === 'estimating' || s === 'saving').length).toBe(2);
    await Promise.all(jobs.map((j) => j.handle.done()));
    expect(jobs.every((j) => j.handle.status === 'done')).toBe(true);
    expect(solver.solveCalls).toBe(3);
  });

  it('P4 4.3 같은 해시의 두 요청은 한 잡에 합류한다 (jobId 공유)', async () => {
    const dir = tmp();
    const solver = new FakeSolver({ solveMs: 60 });
    const q = new JobQueue({ solver, concurrency: 2 });
    const a = submit(q, dir, 'Ks7h2h');
    const b = submit(q, dir, 'Ks7h2h');
    expect(b.handle.id).toBe(a.handle.id);
    await a.handle.done();
    await b.handle.done();
    expect(solver.solveCalls).toBe(1);
  });
});

describe('P4 5.2 메모리 게이트', () => {
  it('P4 5.2 4GB + 4GB 가 도는 동안 1GB 요청은 대기한다 (동시성이 아니라 메모리가 막는다)', async () => {
    const dir = tmp();
    // 동시성 상한을 3 으로 열어 두면 막는 것은 **메모리뿐**이다.
    const solver = new FakeSolver({ solveMs: 200, progressSteps: 2 });
    const q = new JobQueue({ solver, concurrency: 3, memoryBytes: 8 * GB });
    const big1 = submit(q, dir, BOARDS[0] as string, { estimate: { memoryBytes: 4 * GB } });
    const big2 = submit(q, dir, BOARDS[1] as string, { estimate: { memoryBytes: 4 * GB } });
    const small = submit(q, dir, BOARDS[2] as string, { estimate: { memoryBytes: 1 * GB } });
    await new Promise((r) => setTimeout(r, 60));
    expect(q.runningMemoryBytes()).toBe(8 * GB);
    expect(small.handle.status).toBe('queued');
    await Promise.all([big1.handle.done(), big2.handle.done()]);
    await small.handle.done();
    expect(small.handle.status).toBe('done');
  });

  it('P4 5.2 단일 잡이 상한을 넘으면 즉시 TooLarge 다 (큐에 들어가지 않는다)', () => {
    const dir = tmp();
    const q = new JobQueue({ solver: new FakeSolver(), concurrency: 2, memoryBytes: 8 * GB });
    expect(() => submit(q, dir, BOARDS[0] as string, { estimate: { memoryBytes: 9 * GB } })).toThrow(SolverError);
    try {
      submit(q, dir, BOARDS[1] as string, { estimate: { memoryBytes: 9 * GB } });
    } catch (e) {
      expect((e as SolverError).code).toBe('TooLarge');
      expect((e as SolverError).message).toContain('9.00GB');
    }
    expect(q.activeHashes().size).toBe(0);
  });

  it('P4 5.2 추정을 큐가 직접 할 때도 상한을 넘으면 failed: TooLarge 다', async () => {
    const dir = tmp();
    const solver = new FakeSolver({ memoryBytes: 9 * GB });
    const q = new JobQueue({ solver, concurrency: 2, memoryBytes: 8 * GB });
    const j = submit(q, dir, BOARDS[0] as string);
    await expect(j.handle.done()).rejects.toMatchObject({ code: 'TooLarge' });
    expect(j.handle.status).toBe('failed');
    expect(solver.solveCalls).toBe(0);
  });

  it('P4 5.2 confirm 없는 요청은 큐에 들어가지 않는다 (estimateOnly)', async () => {
    const solver = new FakeSolver({ memoryBytes: 2 * GB });
    const q = new JobQueue({ solver, concurrency: 2 });
    const est = await q.estimateOnly(cfgFor('Ks7h2h'));
    expect(est.memoryBytes).toBe(2 * GB);
    expect(q.activeHashes().size).toBe(0);
    expect(solver.solveCalls).toBe(0);
  });
});

describe('P4 5.2 취소', () => {
  it('P4 5.2 running 에서 취소하면 cancelled 가 되고 done 뒤 취소는 already-done 이다', async () => {
    const dir = tmp();
    const solver = new FakeSolver({ solveMs: 400, progressSteps: 8 });
    const q = new JobQueue({ solver, concurrency: 2 });
    const j = submit(q, dir, 'Ks7h2h');
    await new Promise((r) => setTimeout(r, 80));
    expect(j.handle.status).toBe('running');
    expect(q.cancel(j.handle.id)).toBe('cancelling');
    await expect(j.handle.done()).rejects.toMatchObject({ code: 'Cancelled' });
    expect(j.handle.status).toBe('cancelled');
    expect(q.cancel(j.handle.id)).toBe('already-done');
    expect(q.cancel('job-does-not-exist')).toBe('not-found');

    const k = submit(q, dir, 'Ks7h3h');
    await k.handle.done();
    expect(q.cancel(k.handle.id)).toBe('already-done');
  });

  it('P4 5.2 queued 에서 취소하면 솔버를 부르지 않는다', async () => {
    const dir = tmp();
    const solver = new FakeSolver({ solveMs: 300 });
    const q = new JobQueue({ solver, concurrency: 1 });
    const running = submit(q, dir, BOARDS[0] as string);
    const waiting = submit(q, dir, BOARDS[1] as string);
    await new Promise((r) => setTimeout(r, 30));
    expect(waiting.handle.status).toBe('queued');
    q.cancel(waiting.handle.id);
    await expect(waiting.handle.done()).rejects.toMatchObject({ code: 'Cancelled' });
    await running.handle.done();
    expect(solver.solveCalls).toBe(1);
  });
});

describe('P4 5.2 이벤트', () => {
  it('P4 5.2 상태 전이가 순서대로 이벤트로 나간다', async () => {
    const dir = tmp();
    const solver = new FakeSolver({ solveMs: 60, progressSteps: 3 });
    const q = new JobQueue({ solver, concurrency: 2 });
    const j = submit(q, dir, 'Ks7h2h');
    await j.handle.done();
    const statuses = j.events.map((e) => e.status);
    expect(statuses).toContain('estimating');
    expect(statuses).toContain('running');
    expect(statuses).toContain('saving');
    expect(statuses.at(-1)).toBe('done');
    const progress = j.events.filter((e) => e.progress !== undefined).map((e) => e.progress);
    expect(progress.length).toBe(3);
    // exploitability 는 단조 비증가, pct 는 단조 증가 (P4.md 8.3 과 같은 성질).
    for (let i = 1; i < progress.length; i++) {
      expect((progress[i]?.exploitabilityPct ?? 0) <= (progress[i - 1]?.exploitabilityPct ?? 0)).toBe(true);
      expect((progress[i]?.pct ?? 0) > (progress[i - 1]?.pct ?? 0)).toBe(true);
    }
  });
});
