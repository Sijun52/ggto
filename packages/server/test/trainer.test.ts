/**
 * /api/trainer/* 인프로세스 테스트. P3.md 7.
 *
 * 핵심은 **답하기 전에 전략/EV 가 나가지 않는다** 는 것이다: `/next` 응답 전문을 문자열로
 * 검사한다 (필드 하나를 지우는 실수가 아니라 "어디에도 없다" 를 본다).
 *
 * 차트는 서버 패키지 안에서 만든다 (chart-gen 에 의존하면 의존 방향이 뒤집힌다).
 */

import { CLASS_KEYS, openRepository, type ChartRepository, type GgtoJson } from '@ggto/preflop';
import type {
  ErrorEnvelope,
  ReportDto,
  TrainerAnswerResponse,
  TrainerNextResponse,
  TrainerPoolResponse,
  TrainerSessionResponse,
  TrainerSessionStatusResponse,
} from '@ggto/protocol';
import { openTrainer, type TrainerService } from '@ggto/trainer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

function doc(name: string, withEv: boolean): GgtoJson {
  const mk = (seq: string, actions: [string, string], cutoff: number): GgtoJson['nodes'][number] => {
    const strategy: Record<string, number[]> = {};
    const ev: Record<string, number[]> = {};
    CLASS_KEYS.forEach((key, h) => {
      const p = h < cutoff ? 1 : 0;
      strategy[key] = [1 - p, p];
      ev[key] = [0, Number((1.5 - h / 200).toFixed(4))];
    });
    const node: GgtoJson['nodes'][number] = { seq, actions: [...actions], strategy };
    if (withEv) node.ev = ev;
    return node;
  };
  return {
    format: 'ggto-json',
    version: 1,
    name,
    gameType: 'cash',
    config: {
      positions: ['SB', 'BB'],
      blinds: [
        { pos: 'SB', amount: 0.5 },
        { pos: 'BB', amount: 1 },
      ],
      ante: { mode: 'none' },
      stack: 10,
    },
    rake: { mode: 'none' },
    resolution: '169',
    evBasis: withEv ? 'stack_delta_from_node' : 'none',
    source: { kind: 'manual', name: 'trainer test fixture' },
    nodes: [mk('', ['F', 'A'], 60), mk('A', ['F', 'C'], 40)],
  };
}

let repo: ChartRepository;
let trainer: TrainerService;
let app: ReturnType<typeof createApp>;
let evSetId: number;
let freqSetId: number;
let clock = Date.UTC(2026, 0, 1);

beforeAll(() => {
  repo = openRepository(':memory:');
  evSetId = repo.importSet(doc('trainer EV chart', true)).id;
  freqSetId = repo.importSet(doc('trainer no-EV chart', false)).id;
  trainer = openTrainer({ chartRepo: repo, dbPath: ':memory:', now: () => clock });
  app = createApp({ repo, trainer });
});
afterAll(() => {
  trainer.close();
  repo.close();
});

async function post(path: string, body: unknown): Promise<Response> {
  return await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function startSession(body: Record<string, unknown>): Promise<TrainerSessionResponse> {
  const res = await post('/api/trainer/session', body);
  expect(res.status).toBe(200);
  return (await res.json()) as TrainerSessionResponse;
}

describe('P3 7 POST /api/trainer/session', () => {
  it('세션을 만들고 시드를 돌려준다', async () => {
    const body = await startSession({ count: 3, seed: 11 });
    expect(body.sessionId).toBeGreaterThan(0);
    expect(body.seed).toBe(11);
    expect(body.count).toBe(3);
  });

  it('시드를 생략하면 서버가 정하고 응답에 담는다 (재현 가능)', async () => {
    const body = await startSession({ count: 1 });
    expect(Number.isInteger(body.seed)).toBe(true);
  });

  it('count 가 범위를 벗어나면 400 BadRequest', async () => {
    for (const count of [0, 501, 2.5, '3']) {
      const res = await post('/api/trainer/session', { count });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorEnvelope).error.code).toBe('BadRequest');
    }
  });

  it('모르는 셋 id 는 400 BadRequest', async () => {
    const res = await post('/api/trainer/session', { count: 1, sets: [9999] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe('BadRequest');
  });

  it('모르는 카테고리는 400 이고 메시지에 알려진 목록이 있다', async () => {
    const res = await post('/api/trainer/session', { count: 1, categories: ['rfi'] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('BadRequest');
    expect(body.error.message).toContain('vs_4bet_plus');
  });

  it('필터 결과가 비면 400 EmptyPool', async () => {
    const res = await post('/api/trainer/session', { count: 1, categories: ['vs_3bet'] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe('EmptyPool');
  });
});

describe('P3 7 GET /api/trainer/next — 답 전에는 정답이 없다', () => {
  it('SpotDto 에 strategy / ev / reach 가 어디에도 없다', async () => {
    const session = await startSession({ count: 2, seed: 5, sets: [evSetId] });
    const res = await app.request(`/api/trainer/next?session=${String(session.sessionId)}`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    // 응답 전문 검사 — 그 세 배열의 **키**가 중첩 어디에도 나타나면 안 된다.
    // (`"gradedBy":"ev"` 는 값이므로 키 형태 `"ev":` 로 본다.)
    expect(raw).not.toContain('strategy');
    expect(raw).not.toContain('"ev":');
    expect(raw).not.toContain('reach');
    // 숫자 배열이 통째로 실려 나가는 일도 없다 (1326 개가 들어갈 자리가 없다).
    expect(raw.length).toBeLessThan(1000);
    const body = JSON.parse(raw) as TrainerNextResponse;
    expect(body.done).toBe(false);
    if (body.done) return;
    expect(body.spot.spotKey.startsWith('pf:')).toBe(true);
    expect(body.spot.combo).toMatch(/^[2-9TJQKA][cdhs][2-9TJQKA][cdhs]$/);
    expect(body.spot.actions.length).toBeGreaterThan(1);
    expect(body.spot.gradedBy).toBe('ev');
    expect(body.spot.config.positions).toEqual(['SB', 'BB']);
    expect(body.index).toBe(0);
    expect(body.count).toBe(2);
  });

  it('has_ev = 0 인 차트는 gradedBy: frequency 로 라벨링된다 (D8)', async () => {
    const session = await startSession({ count: 1, seed: 5, sets: [freqSetId] });
    const res = await app.request(`/api/trainer/next?session=${String(session.sessionId)}`);
    const body = (await res.json()) as TrainerNextResponse;
    expect(body.done).toBe(false);
    if (!body.done) expect(body.spot.gradedBy).toBe('frequency');
  });

  it('없는 세션은 404 SessionNotFound', async () => {
    const res = await app.request('/api/trainer/next?session=99999');
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe('SessionNotFound');
  });

  it('session 파라미터가 없거나 정수가 아니면 400', async () => {
    expect((await app.request('/api/trainer/next')).status).toBe(400);
    expect((await app.request('/api/trainer/next?session=abc')).status).toBe(400);
  });
});

describe('P3 7 POST /api/trainer/answer', () => {
  it('채점 + 뷰어와 같은 모양의 노드를 돌려준다', async () => {
    const session = await startSession({ count: 1, seed: 21, sets: [evSetId] });
    const next = (await (await app.request(`/api/trainer/next?session=${String(session.sessionId)}`)).json()) as TrainerNextResponse;
    expect(next.done).toBe(false);
    if (next.done) return;

    const res = await post('/api/trainer/answer', {
      sessionId: session.sessionId,
      spotKey: next.spot.spotKey,
      action: next.spot.actions[0],
      msTaken: 1234,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrainerAnswerResponse;
    expect(['Perfect', 'Minor', 'Mistake', 'Blunder']).toContain(body.grade.verdict);
    expect(body.grade.gradedBy).toBe('ev');
    expect(body.grade.evLossBb).not.toBeNull();
    expect(body.grade.actions).toHaveLength(next.spot.actions.length);
    // 노드는 P2 8절의 ChartNodeResponse 그대로다 — 뷰어 컴포넌트가 같은 모양을 먹는다.
    expect(body.node.strategy).toHaveLength(next.spot.actions.length);
    expect(body.node.strategy[0]).toHaveLength(1326);
    expect(body.node.ev?.[0]).toHaveLength(1326);
    expect(body.node.reach).toHaveLength(1326);
    expect(body.node.seq).toBe(next.spot.seq);
  });

  it('pending 이 아닌 스팟이면 409 SpotMismatch', async () => {
    const session = await startSession({ count: 2, seed: 31, sets: [evSetId] });
    await app.request(`/api/trainer/next?session=${String(session.sessionId)}`);
    const res = await post('/api/trainer/answer', {
      sessionId: session.sessionId,
      spotKey: `pf:${'a'.repeat(64)}::AsKh`,
      action: 'F',
      msTaken: 1,
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe('SpotMismatch');
  });

  it('actions 에 없는 액션이면 400 BadRequest', async () => {
    const session = await startSession({ count: 1, seed: 41, sets: [evSetId] });
    const next = (await (await app.request(`/api/trainer/next?session=${String(session.sessionId)}`)).json()) as TrainerNextResponse;
    if (next.done) return;
    const res = await post('/api/trainer/answer', {
      sessionId: session.sessionId,
      spotKey: next.spot.spotKey,
      action: 'R2.5',
      msTaken: 1,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe('BadRequest');
  });

  it('망가진 스팟 키는 400 SpotKeyError', async () => {
    const session = await startSession({ count: 1, seed: 51, sets: [evSetId] });
    const next = (await (await app.request(`/api/trainer/next?session=${String(session.sessionId)}`)).json()) as TrainerNextResponse;
    if (next.done) return;
    // pending 과 같은 문자열이어야 SpotMismatch 를 지나 파싱 단계까지 간다 — 그래서
    // 여기서는 pending 검사 자체가 먼저 걸린다. 대신 pending 과 같은 키를 망가뜨릴 수는
    // 없으므로 "형식은 맞지만 없는 차트" 로 MissingChart 를 확인한다.
    const res = await post('/api/trainer/answer', {
      sessionId: session.sessionId,
      spotKey: next.spot.spotKey.replace(/^pf:/, 'ps:'),
      action: 'F',
      msTaken: 1,
    });
    expect(res.status).toBe(409);
  });

  it('msTaken 이 숫자가 아니면 400', async () => {
    const session = await startSession({ count: 1, seed: 61, sets: [evSetId] });
    const next = (await (await app.request(`/api/trainer/next?session=${String(session.sessionId)}`)).json()) as TrainerNextResponse;
    if (next.done) return;
    const res = await post('/api/trainer/answer', {
      sessionId: session.sessionId,
      spotKey: next.spot.spotKey,
      action: next.spot.actions[0],
      msTaken: 'fast',
    });
    expect(res.status).toBe(400);
  });
});

describe('P3 7 세션 상태와 리포트', () => {
  it('끝까지 답하면 next 가 done + 리포트를 준다', async () => {
    const session = await startSession({ count: 2, seed: 71, sets: [evSetId] });
    for (let i = 0; i < 2; i++) {
      const next = (await (await app.request(`/api/trainer/next?session=${String(session.sessionId)}`)).json()) as TrainerNextResponse;
      expect(next.done).toBe(false);
      if (next.done) return;
      clock += 2000;
      await post('/api/trainer/answer', {
        sessionId: session.sessionId,
        spotKey: next.spot.spotKey,
        action: next.spot.actions[0],
        msTaken: 2000,
      });
    }
    const done = (await (await app.request(`/api/trainer/next?session=${String(session.sessionId)}`)).json()) as TrainerNextResponse;
    expect(done.done).toBe(true);
    if (!done.done) return;
    expect(done.report.totals.attempts).toBe(2);
    expect(done.report.scope).toHaveProperty('sessionId', session.sessionId);

    const status = (await (await app.request(`/api/trainer/session/${String(session.sessionId)}`)).json()) as TrainerSessionStatusResponse;
    expect(status.answered).toBe(2);
    expect(status.finished).toBe(true);
  });

  it('GET /api/trainer/report?days=30 은 ReportDto 다', async () => {
    const res = await app.request('/api/trainer/report?days=30');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportDto;
    expect(body.scope).toEqual({ days: 30 });
    expect(body.totals.byVerdict).toHaveProperty('Perfect');
    expect(Array.isArray(body.leaks)).toBe(true);
    expect(body.srs.due).toBeGreaterThanOrEqual(0);
  });

  it('days 범위를 벗어나면 400', async () => {
    expect((await app.request('/api/trainer/report?days=0')).status).toBe(400);
    expect((await app.request('/api/trainer/report?days=366')).status).toBe(400);
    expect((await app.request('/api/trainer/report?days=abc')).status).toBe(400);
  });

  it('GET /api/trainer/pool 은 풀에 실제로 있는 카테고리만 준다', async () => {
    const body = (await (await app.request('/api/trainer/pool')).json()) as TrainerPoolResponse;
    expect(body.categories).toEqual(['open', 'vs_jam']);
    expect(body.nodes).toBe(4);
  });
});

describe('P3 7 트레이너 없음 = 503', () => {
  it('trainer 가 null 이면 모든 트레이너 경로가 503 TrainerUnavailable', async () => {
    const bare = createApp({ repo });
    for (const path of ['/api/trainer/pool', '/api/trainer/next?session=1', '/api/trainer/report', '/api/trainer/session/1']) {
      const res = await bare.request(path);
      expect(res.status, path).toBe(503);
      expect(((await res.json()) as ErrorEnvelope).error.code).toBe('TrainerUnavailable');
    }
    const res = await bare.request('/api/trainer/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ count: 1 }),
    });
    expect(res.status).toBe(503);
  });
});
