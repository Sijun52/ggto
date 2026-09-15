/**
 * P4.md 8.1 — `/api/solve*` 라우트. `FakeSolver` 로 돌린다 (Rust 불필요).
 *
 * 상태 코드가 계약이다: 400 은 사용자 입력, 413 은 메모리, 503 은 "이 PC 에 솔버가 없다".
 * 셋을 섞으면 P5 UI 가 무엇을 안내해야 할지 알 수 없다.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FakeSolver,
  JobQueue,
  SolveCache,
  buildConfig,
  configHash,
  type SolveRequest,
} from '@ggto/solver';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const GB = 1024 ** 3;

const BODY: SolveRequest & { confirm?: boolean } = {
  oop: '22+,A2s+',
  ip: 'TT-22,AJs-A2s',
  board: 'Ks7h2h',
  potBb: 20,
  stackBb: 80,
  sizings: 'simple',
};

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
});

function makeApp(opts: { memoryBytes?: number; solveMs?: number } = {}): {
  app: ReturnType<typeof createApp>;
  cache: SolveCache;
  queue: JobQueue;
  solver: FakeSolver;
} {
  const dir = mkdtempSync(join(tmpdir(), 'ggto-solveroute-'));
  const solver = new FakeSolver({
    memoryBytes: opts.memoryBytes ?? 64 * 1024 * 1024,
    solveMs: opts.solveMs ?? 30,
    progressSteps: 3,
  });
  const cache = new SolveCache({ dir: join(dir, 'solves') });
  const queue = new JobQueue({ solver, concurrency: 2, memoryBytes: 8 * GB });
  cleanup.push(() => {
    cache.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { app: createApp({ solve: { solver, queue, cache } }), cache, queue, solver };
}

const post = async (app: ReturnType<typeof createApp>, body: unknown): Promise<Response> =>
  app.request('/api/solve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('P4 7 POST /api/solve', () => {
  it('P4 7 confirm 없으면 estimated 만 주고 큐에 넣지 않는다', async () => {
    const { app, queue, solver } = makeApp();
    const res = await post(app, BODY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobId: null; status: string; estMemoryBytes: number; board: string };
    expect(body.jobId).toBeNull();
    expect(body.status).toBe('estimated');
    expect(body.estMemoryBytes).toBe(64 * 1024 * 1024);
    // 응답의 board 는 **사용자가 보낸 원본 슈트**다 (정규 보드가 아니다).
    expect(body.board).toBe('Ks7h2h');
    expect(queue.activeHashes().size).toBe(0);
    expect(solver.solveCalls).toBe(0);
  });

  it('P4 7 confirm 이면 jobId 를 주고 끝나면 캐시에 남는다', async () => {
    const { app, cache } = makeApp();
    const res = await post(app, { ...BODY, confirm: true });
    const body = (await res.json()) as { jobId: string; hash: string; status: string };
    expect(body.jobId).toMatch(/^job-/);
    expect(body.hash).toBe(configHash(buildConfig(BODY)));

    // 이벤트 스트림이 done 을 줄 때까지 기다린다.
    const events = await app.request(`/api/solve/${body.jobId}/events`);
    expect(events.status).toBe(200);
    const text = await events.text();
    expect(text).toContain('event: done');
    expect(cache.get(body.hash)).not.toBeNull();
  });

  it('P4 7 두 번째 요청은 연산 없이 cached 다', async () => {
    const { app, solver } = makeApp();
    const first = (await (await post(app, { ...BODY, confirm: true })).json()) as { jobId: string };
    await (await app.request(`/api/solve/${first.jobId}/events`)).text();
    expect(solver.solveCalls).toBe(1);

    const second = (await (await post(app, { ...BODY, confirm: true })).json()) as {
      cached: boolean;
      jobId: string | null;
      status: string;
    };
    expect(second.cached).toBe(true);
    expect(second.jobId).toBeNull();
    expect(second.status).toBe('done');
    expect(solver.solveCalls).toBe(1);
  });

  it('P4 7 (D5) 같은 게임의 다른 슈트 표기도 cached 로 히트한다', async () => {
    const { app, solver } = makeApp();
    const first = (await (await post(app, { ...BODY, confirm: true })).json()) as { jobId: string };
    await (await app.request(`/api/solve/${first.jobId}/events`)).text();

    const variant = (await (await post(app, { ...BODY, board: 'Kd7s2s', confirm: true })).json()) as {
      cached: boolean;
      board: string;
    };
    expect(variant.cached).toBe(true);
    expect(variant.board).toBe('Kd7s2s'); // 원본 슈트를 돌려준다
    expect(solver.solveCalls).toBe(1);
  });

  it('P4 7 설정 오류는 400 + SolveConfigError 코드 그대로다', async () => {
    const { app } = makeApp();
    for (const [over, code] of [
      [{ oop: 'T9s+' }, 'RangeSyntax'],
      [{ board: 'KsKs2h' }, 'BoardSyntax'],
      [{ potBb: 0 }, 'OutOfRange'],
    ] as const) {
      const res = await post(app, { ...BODY, ...over });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe(code);
    }
  });

  it('P4 7 메모리 상한을 넘으면 413 TooLarge 다', async () => {
    const { app } = makeApp({ memoryBytes: 9 * GB });
    const res = await post(app, { ...BODY, confirm: true });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('TooLarge');
    expect(body.error.message).toContain('9.00GB');
  });
});

describe('P4 7 SSE', () => {
  it('P4 7 늦게 붙어도 done 을 받는다', async () => {
    const { app, queue } = makeApp({ solveMs: 20 });
    const body = (await (await post(app, { ...BODY, confirm: true })).json()) as { jobId: string };
    // 잡이 끝나고 **나서** 구독한다.
    await new Promise((r) => setTimeout(r, 300));
    expect(queue.get(body.jobId)?.status).toBe('done');
    const text = await (await app.request(`/api/solve/${body.jobId}/events`)).text();
    expect(text).toContain('event: done');
  });

  it('P4 7 없는 jobId 는 404 다', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/solve/job-999/events')).status).toBe(404);
  });
});

describe('P4 7 DELETE /api/solve/:jobId', () => {
  it('P4 7 running 이면 202, 끝났으면 409, 없으면 404 다', async () => {
    const { app } = makeApp({ solveMs: 500 });
    const body = (await (await post(app, { ...BODY, confirm: true })).json()) as { jobId: string };
    await new Promise((r) => setTimeout(r, 60));
    const cancel = await app.request(`/api/solve/${body.jobId}`, { method: 'DELETE' });
    expect(cancel.status).toBe(202);
    expect(await cancel.json()).toEqual({ status: 'cancelling' });

    await new Promise((r) => setTimeout(r, 200));
    expect((await app.request(`/api/solve/${body.jobId}`, { method: 'DELETE' })).status).toBe(409);
    expect((await app.request('/api/solve/job-999', { method: 'DELETE' })).status).toBe(404);
  });
});

describe('P4 7 node / runouts / solves', () => {
  async function solved(): Promise<{ app: ReturnType<typeof createApp>; hash: string; cache: SolveCache }> {
    const { app, cache } = makeApp();
    const body = (await (await post(app, { ...BODY, confirm: true })).json()) as { jobId: string; hash: string };
    await (await app.request(`/api/solve/${body.jobId}/events`)).text();
    return { app, hash: body.hash, cache };
  }

  /** `solved()` 와 같지만 솔버 더블도 돌려준다 (invalidate 호출을 본다) */
  async function solvedWith(): Promise<{
    app: ReturnType<typeof createApp>;
    hash: string;
    cache: SolveCache;
    solver: FakeSolver;
  }> {
    const { app, cache, solver } = makeApp();
    const body = (await (await post(app, { ...BODY, confirm: true })).json()) as { jobId: string; hash: string };
    await (await app.request(`/api/solve/${body.jobId}/events`)).text();
    return { app, hash: body.hash, cache, solver };
  }

  const q = (board = 'Ks7h2h'): string =>
    `board=${board}&oop=${encodeURIComponent(BODY.oop)}&ip=${encodeURIComponent(BODY.ip)}&potBb=20&stackBb=80`;

  /** 응답의 base64 전략을 f32 로 (전략이 바뀌었는지 비교용) */
  const strategyOf = (b64: string): Float32Array => {
    const buf = Buffer.from(b64, 'base64');
    const copy = new Uint8Array(buf.byteLength);
    copy.set(buf);
    return new Float32Array(copy.buffer);
  };

  it('P4 7 node 는 base64 6종 + 169 집계 + evBasis 를 준다', async () => {
    const { app, hash } = await solved();
    const res = await app.request(`/api/solve/${hash}/node?line=&${q()}`);
    expect(res.status).toBe(200);
    const node = (await res.json()) as {
      actions: string[];
      strategy: string;
      aggregate: { strategy: number[][]; reach: number[][] };
      evBasis: string;
      board: string;
    };
    expect(node.evBasis).toBe('stack_delta_from_node');
    expect(node.board).toBe('Ks7h2h');
    expect(node.aggregate.strategy.length).toBe(node.actions.length);
    expect(node.aggregate.strategy[0]?.length).toBe(169);
    expect(node.aggregate.reach.length).toBe(2);
    // base64 f32[actions][1326]
    expect(Buffer.from(node.strategy, 'base64').byteLength).toBe(node.actions.length * 1326 * 4);
  });

  it('P4 7 비정규 line 은 400 NoSuchLine, 없는 해시는 404 NoSolve 다', async () => {
    const { app, hash } = await solved();
    const bad = await app.request(`/api/solve/${hash}/node?line=b33.c&${q()}`);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('NoSuchLine');
    const missing = await app.request(`/api/solve/${'f'.repeat(64)}/node?line=&${q()}`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('NoSolve');
  });

  it('P4 7 턴 라인의 board 에 딜된 카드가 남는다 (R1 MAJOR 1)', async () => {
    const { app, hash } = await solved();
    const res = await app.request(`/api/solve/${hash}/node?line=${encodeURIComponent('X-X/Qc')}&${q()}`);
    expect(res.status).toBe(200);
    const node = (await res.json()) as { street: string; board: string; perm: number[] };
    // 플랍 솔브 + 턴 카드 Qc → street 는 turn 이고 board 는 **4장**이다.
    expect(node.street).toBe('turn');
    expect(node.board).toBe('Ks7h2hQc');
    expect(node.board.length).toBe(8);
    expect(node.perm).toHaveLength(4);
  });

  it('P4 7 슈트만 바꾼 표기로 물으면 딜된 카드도 그 표기로 돌아온다 (R1 MAJOR 1·6)', async () => {
    const { app, hash } = await solved();
    // 레인지가 슈트 대칭이라 Kd7s2s 도 같은 해시다 (D5). 사용자의 슈트로 답해야 한다.
    const res = await app.request(
      `/api/solve/${hash}/node?line=${encodeURIComponent('X-X/Qh')}&${q('Kd7s2s')}`,
    );
    expect(res.status).toBe(200);
    const node = (await res.json()) as { street: string; board: string; line: string };
    expect(node.street).toBe('turn');
    expect(node.board).toBe('Kd7s2sQh');
    expect(node.line).toBe('X-X/Qh');
  });

  it('P4 7 runouts 도 딜된 카드를 포함한 보드를 준다 (R1 MAJOR 1)', async () => {
    const { app, hash } = await solved();
    const res = await app.request(`/api/solve/${hash}/runouts?line=${encodeURIComponent('X-X/Qc/X-X')}&${q()}`);
    expect(res.status).toBe(200);
    const r = (await res.json()) as { board: string; cards: { card: string }[] };
    expect(r.board).toBe('Ks7h2hQc');
    // 리버 chance: 보드 4장을 뺀 48장.
    expect(r.cards.length).toBe(48);
    for (const b of ['Ks', '7h', '2h', 'Qc']) expect(r.cards.some((c) => c.card === b)).toBe(false);
  });

  it('P4 7 쿼리 설정이 이 해시의 것이 아니면 400 HashMismatch 다 (R1 MAJOR 2)', async () => {
    const { app, hash } = await solved();
    // 다른 게임 (보드도 레인지도 다르다). 옛 코드는 그 perm 을 이 게임의 1326 배열에
    // 적용해 `board: Ad5d5c` 로 200 을 줬다.
    const res = await app.request(
      `/api/solve/${hash}/node?line=&board=Ad5d5c&oop=AsKs&ip=QhQd&potBb=20&stackBb=80`,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('HashMismatch');

    // 팟만 달라도 다른 게임이다.
    const potOff = await app.request(
      `/api/solve/${hash}/node?line=&board=Ks7h2h&oop=${encodeURIComponent(BODY.oop)}&ip=${encodeURIComponent(BODY.ip)}&potBb=21&stackBb=80`,
    );
    expect(potOff.status).toBe(400);

    // 사이징 프리셋만 달라도 다른 게임이다.
    const sizingOff = await app.request(`/api/solve/${hash}/node?line=&${q()}&sizings=standard`);
    expect(sizingOff.status).toBe(400);

    // runouts 도 같은 검증을 한다.
    const ro = await app.request(
      `/api/solve/${hash}/runouts?line=X-X&board=Ad5d5c&oop=AsKs&ip=QhQd&potBb=20&stackBb=80`,
    );
    expect(ro.status).toBe(400);
  });

  it('P4 7 쿼리를 아예 주지 않으면 정규 보드 + perm 항등으로 답한다', async () => {
    const { app, hash } = await solved();
    const res = await app.request(`/api/solve/${hash}/node?line=`);
    expect(res.status).toBe(200);
    const node = (await res.json()) as { board: string; perm: number[] };
    expect(node.perm).toEqual([0, 1, 2, 3]);
    // 정규 보드다 (사용자가 보낸 Ks7h2h 와 다를 수 있다).
    const canonical = buildConfig(BODY)
      .board.map((c) => `${'23456789TJQKA'[c >> 2] as string}${'cdhs'[c & 3] as string}`)
      .join('');
    expect(node.board).toBe(canonical);
  });

  it('P4 7 반쪽 설정 쿼리는 400 이다 (조용히 정규 보드로 떨어지지 않는다)', async () => {
    const { app, hash } = await solved();
    const res = await app.request(`/api/solve/${hash}/node?line=&board=Ks7h2h`);
    expect(res.status).toBe(400);
  });

  it('P4 7 재솔브 뒤 node 는 **새** 결과를 준다 (R1 MAJOR 3)', async () => {
    const { app, cache, solver } = makeApp();
    const first = (await (await post(app, { ...BODY, targetExploitabilityPct: 1, confirm: true })).json()) as {
      jobId: string;
      hash: string;
    };
    await (await app.request(`/api/solve/${first.jobId}/events`)).text();
    const before = (await (await app.request(`/api/solve/${first.hash}/node?line=&${q()}`)).json()) as {
      strategy: string;
    };

    // 더 정확한 목표로 다시 요청하면 캐시 미스 → 재솔브 → REPLACE (4.3).
    const second = (await (
      await post(app, { ...BODY, targetExploitabilityPct: 0.1, confirm: true })
    ).json()) as { jobId: string | null; hash: string; cached: boolean };
    expect(second.cached).toBe(false);
    expect(second.hash).toBe(first.hash);
    expect(second.jobId).not.toBeNull();
    await (await app.request(`/api/solve/${second.jobId as string}/events`)).text();
    expect(cache.get(first.hash)?.exploitability).toBe(0.1);

    const after = (await (await app.request(`/api/solve/${first.hash}/node?line=&${q()}`)).json()) as {
      strategy: string;
    };
    const a = strategyOf(before.strategy);
    const b = strategyOf(after.strategy);
    let max = 0;
    for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs((a[i] as number) - (b[i] as number)));
    // 낡은 `.bin` 을 그대로 답하면 diff 가 정확히 0 이다 (R1 실측).
    expect(max).toBeGreaterThan(0);
    // 파일이 바뀌기 직전에 솔버에게 "버려라" 라고 알렸다.
    expect(solver.invalidated).toContain(first.hash);
  });

  it('P4 7 DELETE /api/solves/:hash 도 invalidate 를 부른다 (R1 MAJOR 3)', async () => {
    const { app, hash, solver } = await solvedWith();
    expect((await app.request(`/api/solves/${hash}`, { method: 'DELETE' })).status).toBe(204);
    expect(solver.invalidated).toContain(hash);
  });

  it('P4 4.1 저장된 행의 config_json 이 정규 JSON 이다 (R1 MAJOR 5)', async () => {
    const { hash, cache } = await solved();
    const row = cache.get(hash);
    expect(row).not.toBeNull();
    const parsed = JSON.parse((row as { configJson: string }).configJson) as { oop: string; ip: string; v: number };
    expect(parsed.oop.length).toBe(1326 * 8);
    expect(parsed.ip.length).toBe(1326 * 8);
    expect(parsed.v).toBe(1);
  });

  it('P4 7 GET /api/solves 가 목록과 총량을 준다', async () => {
    const { app, hash } = await solved();
    const res = await app.request('/api/solves');
    const body = (await res.json()) as { solves: { hash: string; potBb: number }[]; totalBytes: number; capBytes: number };
    expect(body.solves.map((s) => s.hash)).toContain(hash);
    expect(body.solves[0]?.potBb).toBe(20);
    expect(body.totalBytes).toBeGreaterThan(0);
    expect(body.capBytes).toBe(20 * GB);
  });

  it('P4 7 DELETE /api/solves/:hash 는 204 후 404 다', async () => {
    const { app, hash } = await solved();
    expect((await app.request(`/api/solves/${hash}`, { method: 'DELETE' })).status).toBe(204);
    expect((await app.request(`/api/solves/${hash}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('P4 7 SolverUnavailable (D24)', () => {
  it('P4 7 솔버가 없으면 /api/solve* 만 503 이고 다른 라우트는 그대로다', async () => {
    const app = createApp({ solve: null });
    for (const path of ['/api/solve', '/api/solves']) {
      const res = await app.request(path, { method: 'POST' });
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('SolverUnavailable');
    }
    expect((await app.request(`/api/solve/${'a'.repeat(64)}/node`)).status).toBe(503);
    // P1/P2/P3 스모크는 그대로 돈다.
    expect((await app.request('/api/health')).status).toBe(200);
    expect((await app.request('/api/charts')).status).toBe(200);
    const parse = await app.request('/api/range/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'AA' }),
    });
    expect(parse.status).toBe(200);
  });
});
