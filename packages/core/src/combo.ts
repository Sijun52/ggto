/**
 * 1326 콤보 인덱스. P0.md 3.2.
 *
 * comboIndex(hi, lo) = hi*(hi-1)/2 + lo,  hi > lo (카드 id 기준).
 * 모든 계산은 이 1326 공간에서 한다. 169 는 표시 전용이다.
 */

import { CARD_COUNT, CardSyntaxError, assertCard, formatCard, type Card } from './card.js';

export type ComboIndex = number;

export const COMBO_COUNT = 1326;

/** 콤보 인덱스 → 두 카드. 역함수 룩업 테이블 (핫 경로에서 나눗셈/탐색을 피한다). */
const COMBO_HI = new Uint8Array(COMBO_COUNT);
const COMBO_LO = new Uint8Array(COMBO_COUNT);

for (let hi = 1; hi < CARD_COUNT; hi++) {
  for (let lo = 0; lo < hi; lo++) {
    const i = (hi * (hi - 1)) / 2 + lo;
    COMBO_HI[i] = hi;
    COMBO_LO[i] = lo;
  }
}

export function comboIndex(a: Card, b: Card): ComboIndex {
  assertCard(a, 'combo card a');
  assertCard(b, 'combo card b');
  if (a === b) throw new CardSyntaxError(`combo needs two distinct cards, got ${formatCard(a)} twice`);
  const hi = a > b ? a : b;
  const lo = a > b ? b : a;
  return (hi * (hi - 1)) / 2 + lo;
}

export function isComboIndex(i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < COMBO_COUNT;
}

export function assertComboIndex(i: number): ComboIndex {
  if (!isComboIndex(i)) throw new CardSyntaxError(`combo index out of range 0..1325: ${String(i)}`);
  return i;
}

export function comboCards(i: ComboIndex): [hi: Card, lo: Card] {
  assertComboIndex(i);
  return [COMBO_HI[i] as number, COMBO_LO[i] as number];
}

export function comboHi(i: ComboIndex): Card {
  return COMBO_HI[i] as number;
}

export function comboLo(i: ComboIndex): Card {
  return COMBO_LO[i] as number;
}

export function comboContainsAny(i: ComboIndex, cards: readonly Card[]): boolean {
  assertComboIndex(i);
  const hi = COMBO_HI[i] as number;
  const lo = COMBO_LO[i] as number;
  for (let k = 0; k < cards.length; k++) {
    const c = cards[k] as number;
    if (c === hi || c === lo) return true;
  }
  return false;
}

/** 내부 고속 경로용 raw 뷰. 변형 금지. */
export const COMBO_HI_TABLE: Readonly<Uint8Array> = COMBO_HI;
export const COMBO_LO_TABLE: Readonly<Uint8Array> = COMBO_LO;
