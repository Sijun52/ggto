/**
 * /api/charts/* 인프로세스 테스트. P2.md 8.
 *
 * 문서는 여기서 만든다 (서버 패키지가 chart-gen 에 의존하면 의존 방향이 뒤집힌다).
 * 값은 클래스 인덱스의 결정적 함수이고, 진짜 균형 차트의 성질은 chart-gen 테스트가 본다.
 */

import { CLASS_KEYS, openRepository, type ChartRepository, type GgtoJson } from '@ggto/preflop';
import type { ChartDetailResponse, ChartListResponse, ChartNodeResponse, ChartRangeResponse } from '@ggto/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { queryParam } from '../src/routes/charts.js';

const CUTOFF_ROOT = 60;
const CUTOFF_BB = 40;

function doc(): GgtoJson {
  const mk = (seq: string, actions: [string, string], cutoff: number): GgtoJson['nodes'][number] => {
    const strategy: Record<string, number[]> = {};
    const ev: Record<string, number[]> = {};
    CLASS_KEYS.forEach((key, h) => {
      const p = h < cutoff ? 1 : 0;
      strategy[key] = [1 - p, p];
      ev[key] = [0, Number((1.5 - h / 200).toFixed(4))];
    });
    return { seq, actions: [...actions], strategy, ev };
  };
  return {
    format: 'ggto-json',
    version: 1,
    name: 'server test HU 10bb',
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
    evBasis: 'stack_delta_from_node',
    source: { kind: 'manual', name: 'server test fixture' },
    nodes: [mk('', ['F', 'A'], CUTOFF_ROOT), mk('A', ['F', 'C'], CUTOFF_BB)],
  };
}

let repo: ChartRepository;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  repo = openRepository(':memory:');
  repo.importSet(doc());
  app = createApp({ repo });
});
afterAll(() => {
  repo.close();
});

async function get<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as T };
}

describe('8 쿼리 파싱 (D13)', () => {
  it('8 queryParam 은 리터럴 + 를 보존한다 — Hono 의 c.req.query() 는 공백으로 바꾼다', () => {
    // 실측(2026-09-11, hono 4.13.7): app.request('/t?seq=a+b') 에서 c.req.query('seq') === 'a b'.
    // 프리플랍 문법에 + 는 없지만 레인지 문법에는 있고(P1 R1 MAJOR 1), 같은 함정을 두 번
    // 밟지 않도록 서버의 모든 쿼리 파싱을 decodeURIComponent 규칙으로 통일한다.
    expect(queryParam('http://x/y?seq=a+b', 'seq')).toBe('a+b');
    expect(queryParam('http://x/y?seq=a%2Bb', 'seq')).toBe('a+b');
    expect(queryParam('http://x/y?seq=A%2DC', 'seq')).toBe('A-C');
    expect(queryParam('http://x/y?seq=x%20y', 'seq')).toBe('x y');
    // 첫 번째 값이 이긴다 / 없으면 null / 해시는 쿼리가 아니다
    expect(queryParam('http://x/y?seq=A&seq=B', 'seq')).toBe('A');
    expect(queryParam('http://x/y?pos=SB', 'seq')).toBeNull();
    expect(queryParam('http://x/y', 'seq')).toBeNull();
    expect(queryParam('http://x/y?seq=A#seq=B', 'seq')).toBe('A');
  });

  it('8 깨진 퍼센트 시퀀스는 400 BadRequest 다 (500 아님)', async () => {
    // R1 회귀: decodeURIComponent 의 URIError 가 그대로 올라가 500 Internal + 스택 로그가 났다.
    // 사용자 입력 결함이므로 4xx 다 (P1.md 3.1, P2.md 8 R2).
    expect(() => queryParam('http://x/y?seq=%zz', 'seq')).toThrow(/percent-encoding/);
    // 다른 키의 깨진 값은 건드리지 않는다 (요청한 키만 디코드한다).
    expect(queryParam('http://x/y?pos=%zz&seq=A', 'seq')).toBe('A');

    for (const path of ['/api/charts/1/node?seq=%zz', '/api/charts/1/range?seq=%zz&pos=SB', '/api/charts/1/range?seq=&pos=%zz']) {
      const res = await app.request(path);
      expect([path, res.status]).toEqual([path, 400]);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BadRequest');
    }
  });
});

describe('8 GET /api/charts', () => {
  it('8 목록은 메타를 그대로 준다', async () => {
    const { status, body } = await get<ChartListResponse>('/api/charts');
    expect(status).toBe(200);
    expect(body.sets).toHaveLength(1);
    expect(body.sets[0]).toMatchObject({
      id: 1,
      name: 'server test HU 10bb',
      resolution: '169',
      hasEv: true,
      evBasis: 'stack_delta_from_node',
    });
    expect(body.sets[0]?.config.positions).toEqual(['SB', 'BB']);
    expect(body.sets[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('8 저장소가 없으면 빈 배열이다 (503 아님)', async () => {
    const res = await createApp().request('/api/charts');
    expect(res.status).toBe(200);
    expect(((await res.json()) as ChartListResponse).sets).toEqual([]);
  });
});

describe('8 GET /api/charts/:id', () => {
  it('8 트리 스켈레톤에 두 노드가 상태 기계 값과 함께 들어 있다', async () => {
    const { status, body } = await get<ChartDetailResponse>('/api/charts/1');
    expect(status).toBe(200);
    expect(body.nodes.map((n) => n.seq)).toEqual(['', 'A']);
    expect(body.nodes[0]).toEqual({ seq: '', heroPos: 'SB', potBb: 1.5, actions: ['F', 'A'], hasEv: true });
    expect(body.nodes[1]).toEqual({ seq: 'A', heroPos: 'BB', potBb: 11, actions: ['F', 'C'], hasEv: true });
  });

  it('8 없는 id 는 404 NotFound, 이상한 id 는 400', async () => {
    const missing = await app.request('/api/charts/99');
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('NotFound');
    expect((await app.request('/api/charts/abc')).status).toBe(400);
  });
});

describe('8 GET /api/charts/:id/node', () => {
  it('8 seq 없으면 루트, strategy 는 1326 길이, reach 는 전부 1', async () => {
    const { status, body } = await get<ChartNodeResponse>('/api/charts/1/node');
    expect(status).toBe(200);
    expect(body.seq).toBe('');
    expect(body.strategy).toHaveLength(2);
    expect(body.strategy[0]).toHaveLength(1326);
    expect(body.ev?.[0]).toHaveLength(1326);
    expect(body.reach).toHaveLength(1326);
    expect(body.reach.every((x) => x === 1)).toBe(true);
    // 각 콤보의 전략 합은 1
    for (let c = 0; c < 1326; c++) {
      expect((body.strategy[0]?.[c] as number) + (body.strategy[1]?.[c] as number)).toBeCloseTo(1, 6);
    }
  });

  it('8 seq=A 는 BB 노드이고 reach 는 BB 기준(전부 1)이다', async () => {
    const { body } = await get<ChartNodeResponse>('/api/charts/1/node?seq=A');
    expect(body.heroPos).toBe('BB');
    expect(body.actions).toEqual(['F', 'C']);
    expect(body.reach.every((x) => x === 1)).toBe(true);
  });

  it('8 없는 노드는 404 MissingNode, 문법 오류는 400 ActionSyntaxError', async () => {
    const missing = await app.request('/api/charts/1/node?seq=A-C');
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('MissingNode');

    const bad = await app.request('/api/charts/1/node?seq=Z9');
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('ActionSyntaxError');
  });

  it('8 seq 는 decodeURIComponent 로 읽는다 (%2D 와 - 가 같은 노드)', async () => {
    // "A-C" 는 터미널이라 없는 노드지만, 인코딩 형태와 리터럴 형태가 **같은 응답**이어야 한다
    const literal = await app.request('/api/charts/1/node?seq=A-C');
    const encoded = await app.request('/api/charts/1/node?seq=A%2DC');
    expect(encoded.status).toBe(literal.status);
    expect(await encoded.text()).toBe(await literal.text());
  });
});

describe('8 GET /api/charts/:id/range', () => {
  it('8 루트 reach 는 전부 1', async () => {
    const { status, body } = await get<ChartRangeResponse>('/api/charts/1/range?pos=SB');
    expect(status).toBe(200);
    expect(body.weights).toHaveLength(1326);
    expect(body.weights.every((x) => x === 1)).toBe(true);
  });

  it('8 seq=A 의 SB reach 는 루트 잼 열과 같다 (BB 는 전부 1)', async () => {
    const node = (await get<ChartNodeResponse>('/api/charts/1/node')).body;
    const sb = (await get<ChartRangeResponse>('/api/charts/1/range?seq=A&pos=SB')).body;
    expect(sb.weights).toEqual(node.strategy[1]);
    const bb = (await get<ChartRangeResponse>('/api/charts/1/range?seq=A&pos=BB')).body;
    expect(bb.weights.every((x) => x === 1)).toBe(true);
  });

  it('8 config 에 없는 포지션은 400 BadRequest, pos 가 없으면 400', async () => {
    const res = await app.request('/api/charts/1/range?seq=&pos=BTN');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BadRequest');
    expect((await app.request('/api/charts/1/range')).status).toBe(400);
  });

  it('8 경로 노드가 없으면 404 MissingNode', async () => {
    const res = await app.request('/api/charts/1/range?seq=A-R3&pos=SB');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('MissingNode');
  });
});

describe('P2 R1 MINOR 8 — R<stack> 404 에 D10 힌트', () => {
  it('?seq=R10 은 404 이고 메시지가 "A" 를 알려준다', async () => {
    const res = await app.request('/api/charts/1/node?seq=R10');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('MissingNode');
    expect(body.error.message).toContain('use "A" for all-in (D10)');
    expect(body.error.message).toContain('full-stack raise');
  });

  it('range 경로도 같은 힌트를 준다', async () => {
    const res = await app.request('/api/charts/1/range?seq=R10&pos=SB');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('use "A" for all-in (D10)');
  });

  it('스택 미만 레이즈는 힌트 없이 그냥 404 다', async () => {
    const res = await app.request('/api/charts/1/node?seq=R3');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).not.toContain('D10');
  });

  it('A 는 실제로 존재하는 노드다 (힌트가 가리키는 곳이 맞다)', async () => {
    const res = await app.request('/api/charts/1/node?seq=A');
    expect(res.status).toBe(200);
  });
});
