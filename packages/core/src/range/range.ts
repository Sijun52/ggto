/**
 * Range = Float32Array(1326). P0.md 3.4.
 * 전 연산이 콤보 공간에서 일어난다. 169 는 toHandClassView 로 "나가는" 방향만 있다.
 */

import { type Card } from '../card.js';
import {
  COMBO_COUNT,
  COMBO_HI_TABLE,
  COMBO_LO_TABLE,
  assertComboIndex,
  comboIndex,
  type ComboIndex,
} from '../combo.js';
import { HAND_CLASS_COUNT, HAND_CLASS_OF_COMBO_TABLE } from '../handClass.js';
import { applyPermToCard, isSuitPerm, type SuitPerm } from '../suitPerm.js';

// 번들러/ESM 네임스페이스 간접 참조를 핫 루프 밖으로 빼기 위한 모듈 지역 별칭.
// (Vite SSR 변환에서는 import 바인딩이 네임스페이스 프로퍼티 로드가 되어 루프마다 비용이 붙는다.)
const N = COMBO_COUNT;
const HI = COMBO_HI_TABLE;
const LO = COMBO_LO_TABLE;
const CLASS_OF = HAND_CLASS_OF_COMBO_TABLE;

export type Range = Float32Array;

export class EmptyRangeError extends Error {
  constructor(message = 'range has zero total weight') {
    super(message);
    this.name = 'EmptyRangeError';
  }
}

export function emptyRange(): Range {
  return new Float32Array(N);
}

export function fullRange(): Range {
  return new Float32Array(N).fill(1);
}

export function rangeFromCombos(entries: Iterable<readonly [ComboIndex, number]>): Range {
  const r = emptyRange();
  for (const [i, w] of entries) {
    assertComboIndex(i);
    if (!Number.isFinite(w) || w < 0 || w > 1) {
      throw new RangeError(`combo weight must be in [0,1]: ${String(w)}`);
    }
    r[i] = w;
  }
  return r;
}

export function cloneRange(r: Range): Range {
  return new Float32Array(r);
}

function assertRange(r: Range, what = 'range'): void {
  if (!(r instanceof Float32Array) || r.length !== COMBO_COUNT) {
    throw new TypeError(`${what} must be a Float32Array of length ${String(COMBO_COUNT)}`);
  }
}

/** 보드 카드를 포함하는 콤보의 가중치를 0으로. 새 배열 반환. */
export function removeBoard(r: Range, board: readonly Card[]): Range {
  assertRange(r);
  const out = new Float32Array(r);
  if (board.length === 0) return out;
  // 52비트 마스크를 두 개의 32비트로 나눠 O(1) 판정
  let lo = 0;
  let hi = 0;
  for (const c of board) {
    if (c < 32) lo |= 1 << c;
    else hi |= 1 << (c - 32);
  }
  for (let i = 0; i < N; i++) {
    if (out[i] === 0) continue;
    const a = HI[i] as number;
    const b = LO[i] as number;
    const aHit = a < 32 ? (lo >>> a) & 1 : (hi >>> (a - 32)) & 1;
    const bHit = b < 32 ? (lo >>> b) & 1 : (hi >>> (b - 32)) & 1;
    if (aHit !== 0 || bHit !== 0) out[i] = 0;
  }
  return out;
}

export function totalWeight(r: Range): number {
  assertRange(r);
  let s = 0;
  for (let i = 0; i < N; i++) s += r[i] as number;
  return s;
}

export function comboCount(r: Range): number {
  assertRange(r);
  let n = 0;
  for (let i = 0; i < N; i++) if ((r[i] as number) > 0) n++;
  return n;
}

/** 합이 1이 되도록. 합 0이면 EmptyRangeError. */
export function normalize(r: Range): Range {
  const s = totalWeight(r);
  if (s === 0) throw new EmptyRangeError('cannot normalize a range whose total weight is 0');
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = (r[i] as number) / s;
  return out;
}

/** 원소별 곱. */
export function intersect(a: Range, b: Range): Range {
  assertRange(a, 'range a');
  assertRange(b, 'range b');
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = (a[i] as number) * (b[i] as number);
  return out;
}

export function scale(r: Range, k: number): Range {
  assertRange(r);
  if (!Number.isFinite(k)) throw new RangeError(`scale factor must be finite: ${String(k)}`);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = (r[i] as number) * k;
  return out;
}

export interface HandClassView {
  weight: Float32Array; // 169: 클래스별 가중치 합
  count: Uint8Array; // 169: weight>0 콤보 수
}

/**
 * 표시용 집계. **여기서 나온 169 값을 다시 계산에 넣지 않는다.**
 */
export function toHandClassView(r: Range): HandClassView {
  assertRange(r);
  const weight = new Float32Array(HAND_CLASS_COUNT);
  const count = new Uint8Array(HAND_CLASS_COUNT);
  for (let i = 0; i < N; i++) {
    const w = r[i] as number;
    if (w === 0) continue;
    const h = CLASS_OF[i] as number;
    weight[h] = (weight[h] as number) + w;
    if (w > 0) count[h] = (count[h] as number) + 1;
  }
  return { weight, count };
}

/** perm[s] = 원본 슈트 s 가 가는 슈트. 콤보 가중치를 그대로 옮긴다. */
export function permuteRangeSuits(r: Range, perm: SuitPerm): Range {
  assertRange(r);
  if (!isSuitPerm(perm)) throw new TypeError(`not a suit permutation: ${JSON.stringify(perm)}`);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const w = r[i] as number;
    if (w === 0) continue;
    const a = applyPermToCard(HI[i] as number, perm);
    const b = applyPermToCard(LO[i] as number, perm);
    out[comboIndex(a, b)] = w;
  }
  return out;
}
