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
}

export interface RunoutsResponse {
  line: string;
  board: string;
  cards: RunoutCard[];
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
  };
}

export function toRunoutsResponse(
  runouts: CanonicalRunouts,
  perm: SuitPerm,
  canonicalBoard: string,
): RunoutsResponse {
  const inv = invertPerm(perm);
  return {
    line: permuteLine(runouts.line, inv),
    board: permuteBoardString(canonicalBoard, inv),
    // 블로커 슈트가 뒤집힌다 — 카드 이름도 반드시 역순열해야 한다 (P4.md 5.5).
    cards: runouts.cards.map((c) => ({ ...c, card: permuteBoardString(c.card, inv) })),
  };
}
