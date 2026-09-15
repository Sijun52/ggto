/**
 * `/api/solve*` 클라이언트 (P5.md 1절 · 4절).
 *
 * base64 1326 배열은 **받는 즉시** `Float32Array` 뷰가 된다 (D7·P1 규약). 서버가 준
 * `aggregate`(169) 는 여기서 건드리지 않고 그대로 넘긴다 — 격자는 1326 에서 브라우저가
 * 다시 집계하고 (D14), `aggregate` 는 어그리게이트 패널과 **대조 테스트**용이다 (1.5).
 *
 * 노드 종류는 **서버 코드로만** 판별한다 (D27): `ChanceNode` 면 chance, `NoSuchLine` 이면
 * 터미널이다. 클라이언트가 `X-X` 를 보고 추측하지 않는다.
 */

import type {
  SolveAggregateDto,
  SolveListResponse,
  SolveNodeResponse,
  SolvePostResponse,
  SolveRequestDto,
  SolveRunoutsResponse,
} from '@ggto/protocol';
import { ApiError, deleteRequest, getJson, postJson } from './client';
import { decodeF32Row, decodeF32Rows } from '../lib/f32';
import { notationQuery, type SolveNotation } from '../lib/solveNotation';
import type { StreetName } from '../lib/solveLine';

/** 화면이 쓰는 노드 표현 (base64 가 풀린 것) */
export interface SolveNodeView {
  street: StreetName;
  line: string;
  /** 응답이 준 보드 = 요청 표기 + 라인에서 딜된 카드 (클라이언트가 이어 붙이지 않는다) */
  board: string;
  player: 'oop' | 'ip';
  potChips: number;
  stacksChips: [number, number];
  actions: string[];
  /** [actions][1326] */
  strategy: Float32Array[];
  /** [actions][1326], bb, stack_delta_from_node */
  ev: Float32Array[];
  reach: [Float32Array, Float32Array];
  equity: [Float32Array, Float32Array];
  evAvgBb: [number, number];
  /** false 면 도달 질량 0 — `evAvgBb` 를 숫자로 그리지 않는다 (P4 R1 MINOR 11) */
  reachable: boolean;
  /** 서버 집계 (대조용, 1.5) */
  aggregate: SolveAggregateDto;
  perm: [number, number, number, number];
}

/** `node` 요청의 결과. chance·터미널은 **오류가 아니라 데이터**다 (P5.md 4절) */
export type SolveNodeResult =
  | { kind: 'node'; node: SolveNodeView }
  | { kind: 'chance' }
  | { kind: 'terminal' };

export interface SolveRunoutCardView {
  card: string;
  /** 도달 질량 0 인 chance 노드에서는 데몬이 NaN → JSON null 을 준다. 숫자로 꾸미지 않는다 */
  evOop: number | null;
  evIp: number | null;
  equityOop: number | null;
  strategyRoot: number[];
}

export interface SolveRunoutsView {
  line: string;
  board: string;
  cards: SolveRunoutCardView[];
  perm: [number, number, number, number];
}

export async function fetchSolves(): Promise<SolveListResponse> {
  return await getJson<SolveListResponse>('/api/solves');
}

function query(line: string, notation: SolveNotation | null): string {
  const q = notationQuery(notation);
  // `line` 은 `+` 를 담지 않지만 규칙을 한 곳으로 모은다 (D13: 직접 인코딩).
  return `line=${encodeURIComponent(line)}${q === '' ? '' : `&${q}`}`;
}

function toView(res: SolveNodeResponse): SolveNodeView {
  const rows = res.actions.length;
  return {
    street: res.street,
    line: res.line,
    board: res.board,
    player: res.player,
    potChips: res.potChips,
    stacksChips: res.stacksChips,
    actions: res.actions,
    strategy: decodeF32Rows(res.strategy, rows),
    ev: decodeF32Rows(res.ev, rows),
    reach: [decodeF32Row(res.reach[0]), decodeF32Row(res.reach[1])],
    equity: [decodeF32Row(res.equity[0]), decodeF32Row(res.equity[1])],
    evAvgBb: res.evAvgBb,
    reachable: res.reachable,
    aggregate: res.aggregate,
    perm: res.perm,
  };
}

export async function fetchSolveNode(
  hash: string,
  line: string,
  notation: SolveNotation | null,
): Promise<SolveNodeResult> {
  try {
    const res = await getJson<SolveNodeResponse>(`/api/solve/${hash}/node?${query(line, notation)}`);
    return { kind: 'node', node: toView(res) };
  } catch (e) {
    if (e instanceof ApiError && e.code === 'ChanceNode') return { kind: 'chance' };
    // 터미널(폴드·리버 쇼다운·올인 뒤)은 `NoSuchLine` 이다 (P5.md 1.4 표).
    //
    // **스펙 충돌**: 1.4 는 터미널에서 "종료 노드 — 이전으로" 를 그리라 하고, 4절의 오류
    // 매핑은 같은 코드를 "`line=''` 로 되돌리고 토스트" 라 한다. 액션 버튼으로 `F` 를
    // 누르면 반드시 여기로 오므로 후자를 따르면 **폴드를 누를 때마다 루트로 튄다**.
    // 더 구체적인 1.4 를 따르고, 잘못된 URL 라인도 같은 화면의 `←` 로 회복한다.
    if (e instanceof ApiError && e.code === 'NoSuchLine') return { kind: 'terminal' };
    // `HashMismatch`·`NoSolve`·`NotLoaded` 는 삼키지 않는다 — 호출부가 다르게 처리한다.
    throw e;
  }
}

export async function fetchSolveRunouts(
  hash: string,
  line: string,
  notation: SolveNotation | null,
): Promise<SolveRunoutsView> {
  const res = await getJson<SolveRunoutsResponse>(`/api/solve/${hash}/runouts?${query(line, notation)}`);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    line: res.line,
    board: res.board,
    perm: res.perm,
    cards: res.cards.map((c) => ({
      card: c.card,
      evOop: num(c.evOop),
      evIp: num(c.evIp),
      equityOop: num(c.equityOop),
      strategyRoot: c.strategyRoot,
    })),
  };
}

export async function postSolve(body: SolveRequestDto): Promise<SolvePostResponse> {
  return await postJson<SolveRequestDto, SolvePostResponse>('/api/solve', body);
}

export async function deleteSolve(hash: string): Promise<void> {
  await deleteRequest(`/api/solves/${hash}`);
}

export async function cancelSolveJob(jobId: string): Promise<void> {
  await deleteRequest(`/api/solve/${jobId}`);
}
