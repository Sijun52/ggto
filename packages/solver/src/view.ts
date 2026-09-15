/**
 * 정규 보드 기준 응답 → **사용자의 원본 슈트** 응답 (P4.md 5.4 "슈트 역순열").
 *
 * 데몬은 정규 보드로 계산한다. 서버·웹은 정규 보드를 **모른다** — 응답의 `board` 는 항상
 * 사용자가 보낸 원본 슈트다 (P4.md 2절). 그 변환을 여기 한 곳에서만 한다:
 * 모든 1326 배열 · `line` 안의 카드 · `board` · `runouts` 의 카드 이름.
 */

import { COMBO_COUNT, invertPerm, permuteRangeSuits, type Range, type SuitPerm } from '@ggto/core';
import { aggregateNode, type NodeAggregate } from './aggregate.js';
import { permuteBoardString, permuteLine } from './line.js';
import type { CanonicalNode, CanonicalRunouts, RunoutCard, Street } from './types.js';

/** 와이어 `NodeResponse` (P4.md 5.4). base64 는 f32 little-endian. */
export interface NodeResponse {
  street: Street;
  line: string;
  /**
   * 응답의 모든 카드 표기가 선 슈트 공간. `perm` 이 항등이면 **정규 보드** 공간이고
   * (요청이 설정 쿼리를 주지 않은 경우), 아니면 사용자가 보낸 원본 슈트다 (P4.md 2절).
   * 라인이 턴/리버 카드를 지났으면 그 카드가 **여기에 포함된다** (P4 R1 MAJOR 1).
   */
  board: string;
  player: 'oop' | 'ip';
  potChips: number;
  stacksChips: [number, number];
  actions: string[];
  strategy: string;
  ev: string;
  reach: [string, string];
  equity: [string, string];
  /** [oop, ip] 평균 EV (bb). 합 = `potChips / 100` (P4.md 3.5) */
  evAvgBb: [number, number];
  aggregate: NodeAggregate;
  evBasis: 'stack_delta_from_node';
  /**
   * 이 응답에 적용된 **원본 → 정규** 슈트 순열. 항등 `[0,1,2,3]` 이면 응답이 정규 보드
   * 공간이라는 뜻이다 (요청에 설정 쿼리가 없었다). P5 가 이 표지로 "지금 보고 있는
   * 표기가 사용자 것인가" 를 안다.
   */
  perm: [number, number, number, number];
}

export interface RunoutsResponse {
  line: string;
  board: string;
  cards: RunoutCard[];
  perm: [number, number, number, number];
}

function b64(rows: readonly Float32Array[]): string {
  const total = rows.reduce((n, r) => n + r.length, 0);
  const flat = new Float32Array(total);
  let off = 0;
  for (const r of rows) {
    flat.set(r, off);
    off += r.length;
  }
  return Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength).toString('base64');
}

/** base64 f32 → `Float32Array` 뷰 묶음. `rows` 개로 쪼갠다 (각 1326). */
export function decodeRows(text: string, rows: number): Float32Array[] {
  const buf = Buffer.from(text, 'base64');
  const need = rows * COMBO_COUNT * 4;
  if (buf.byteLength !== need) {
    throw new Error(`expected ${String(need)} bytes for ${String(rows)}x1326 f32, got ${String(buf.byteLength)}`);
  }
  // Buffer 는 풀에서 잘라 쓰므로 byteOffset 이 4의 배수가 아닐 수 있다. 정렬을 보장하려면
  // 뷰를 그대로 만들 수 없어 복사한다 (1326 f32 = 5KB, 무시 가능).
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  const out: Float32Array[] = [];
  for (let i = 0; i < rows; i++) {
    out.push(new Float32Array(copy.buffer, i * COMBO_COUNT * 4, COMBO_COUNT));
  }
  return out;
}

function invert(arr: Float32Array, inv: SuitPerm): Float32Array {
  return permuteRangeSuits(arr as Range, inv) as Float32Array;
}

/**
 * 역순열 적용 + 169 집계.
 *
 * `perm` 은 **원본 → 정규** 다. 응답은 정규 → 원본이므로 `invertPerm(perm)` 을 쓴다.
 */
export function toNodeResponse(node: CanonicalNode, perm: SuitPerm): NodeResponse {
  const inv = invertPerm(perm);
  const strategy = node.strategy.map((r) => invert(r, inv));
  const ev = node.ev.map((r) => invert(r, inv));
  const reach: [Float32Array, Float32Array] = [invert(node.reach[0], inv), invert(node.reach[1], inv)];
  const equity: [Float32Array, Float32Array] = [invert(node.equity[0], inv), invert(node.equity[1], inv)];
  return {
    street: node.street,
    line: permuteLine(node.line, inv),
    board: permuteBoardString(node.board, inv),
    player: node.player,
    potChips: node.potChips,
    stacksChips: node.stacksChips,
    actions: node.actions,
    strategy: b64(strategy),
    ev: b64(ev),
    reach: [b64([reach[0]]), b64([reach[1]])],
    equity: [b64([equity[0]]), b64([equity[1]])],
    evAvgBb: node.evAvgBb,
    aggregate: aggregateNode({ strategy, ev, reach, player: node.player }),
    evBasis: node.evBasis,
    perm: [perm[0], perm[1], perm[2], perm[3]],
  };
}

/**
 * 응답의 `board` 를 **사용자가 보낸 표기 + 라인에서 딜된 카드**로 조립한다 (P4 R1 MAJOR 1).
 *
 * 역순열은 슈트를 되돌리지만 카드 **순서**는 정규 보드의 정렬 순서다. 사용자가 친 그대로
 * 보여주려고 시작 보드를 덮어쓰면 턴/리버로 딜된 카드가 사라진다 — 라운드 1 의 실제 버그다
 * (`line=X-X/Qc` 가 `street: turn` 인데 `board` 는 플랍 3장이었다).
 *
 * `responseBoard` 는 이미 역순열된 전체 보드다. 거기서 시작 보드의 카드들을 **집합으로**
 * 빼고 남은 것이 딜된 카드다 (위치로 자르지 않는다 — 정규 보드의 정렬 순서가 원본과 다르다).
 */
export function boardWithDealt(originalBoard: string, responseBoard: string): string {
  const cards = (responseBoard.match(/../g) ?? []).slice();
  const remaining = [...cards];
  for (const c of originalBoard.match(/../g) ?? []) {
    const at = remaining.indexOf(c);
    if (at < 0) {
      // 순열이 틀렸거나 다른 게임의 결과다. 조용히 틀린 보드를 그리느니 터진다.
      throw new Error(`response board ${responseBoard} does not contain the requested board card ${c}`);
    }
    remaining.splice(at, 1);
  }
  return originalBoard + remaining.join('');
}

export function toRunoutsResponse(runouts: CanonicalRunouts, perm: SuitPerm): RunoutsResponse {
  const inv = invertPerm(perm);
  return {
    line: permuteLine(runouts.line, inv),
    // 보드는 **데몬이 준 그 노드의 보드**다 (딜된 턴 카드를 포함한다). 시작 보드를 쓰면
    // 리버 chance 노드에서 3장이 나온다 (P4 R1 MAJOR 1).
    board: permuteBoardString(runouts.board, inv),
    perm: [perm[0], perm[1], perm[2], perm[3]],
    // 블로커 슈트가 뒤집힌다 — 카드 이름도 반드시 역순열해야 한다 (P4.md 5.5).
    cards: runouts.cards.map((c) => ({ ...c, card: permuteBoardString(c.card, inv) })),
  };
}
