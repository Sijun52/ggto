/**
 * 핸드 평가기. P0.md 4.4.
 *
 * HandValue = (category << 20) | tiebreak.  클수록 강함. 같은 값 = 무승부.
 * tiebreak 은 카테고리별로 랭크(0=2..12=A)를 4비트씩 내림차순으로 채운다.
 *
 * 랭크 카운트는 배열 대신 4개의 13비트 마스크로 들고 다닌다:
 *   m1 = count>=1 인 랭크, m2 = count>=2, m3 = count>=3, m4 = count>=4.
 * 이 표현은 (a) 카드 한 장 추가, (b) 두 마스크 집합 합치기가 전부 비트 연산이라
 * 전수 열거(2.6M / 133M 핸드)에서 배열 할당 없이 증분 계산이 된다.
 */

import { CardSyntaxError, formatCard, type Card } from './card.js';

export type HandValue = number;

export enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export const HAND_CATEGORY_COUNT = 9;

// 핫 경로에서 enum 프로퍼티 로드를 피하기 위한 사전 시프트 상수.
const C_HIGH = HandCategory.HighCard << 20;
const C_PAIR = HandCategory.Pair << 20;
const C_TWOPAIR = HandCategory.TwoPair << 20;
const C_TRIPS = HandCategory.Trips << 20;
const C_STRAIGHT = HandCategory.Straight << 20;
const C_FLUSH = HandCategory.Flush << 20;
const C_BOAT = HandCategory.FullHouse << 20;
const C_QUADS = HandCategory.Quads << 20;
const C_SF = HandCategory.StraightFlush << 20;

const MASK_SIZE = 1 << 13;

/** 13비트 랭크 마스크 → 가장 높은 스트레이트의 하이 랭크 (없으면 -1). */
const STRAIGHT_HIGH = new Int8Array(MASK_SIZE);
/** 13비트 랭크 마스크 → 상위 5개 랭크를 4비트씩 20비트로 팩. */
const TOP5 = new Int32Array(MASK_SIZE);
const POPCNT = new Uint8Array(MASK_SIZE);

// A-2-3-4-5 (휠). 비트 12(A) + 비트 0..3(2,3,4,5). 하이 랭크는 5 = 랭크 인덱스 3.
const WHEEL_MASK = (1 << 12) | 0b1111;

for (let m = 0; m < MASK_SIZE; m++) {
  let pc = 0;
  for (let i = 0; i < 13; i++) if ((m & (1 << i)) !== 0) pc++;
  POPCNT[m] = pc;

  let packed = 0;
  let n = 0;
  for (let i = 12; i >= 0 && n < 5; i--) {
    if ((m & (1 << i)) !== 0) {
      packed = (packed << 4) | i;
      n++;
    }
  }
  TOP5[m] = packed << (4 * (5 - n));

  const run = m & (m >> 1) & (m >> 2) & (m >> 3) & (m >> 4);
  if (run !== 0) STRAIGHT_HIGH[m] = 31 - Math.clz32(run) + 4;
  else if ((m & WHEEL_MASK) === WHEEL_MASK) STRAIGHT_HIGH[m] = 3;
  else STRAIGHT_HIGH[m] = -1;
}

/**
 * 마스크 집합에서 직접 평가한다 (내부 핫 경로 + 전수 열거 테스트용).
 * s0..s3 은 각 슈트의 13비트 랭크 마스크 (0=c,1=d,2=h,3=s).
 */
export function evaluateMasks(
  m1: number,
  m2: number,
  m3: number,
  m4: number,
  s0: number,
  s1: number,
  s2: number,
  s3: number,
): HandValue {
  let fm = 0;
  if ((POPCNT[s0] as number) >= 5) fm = s0;
  else if ((POPCNT[s1] as number) >= 5) fm = s1;
  else if ((POPCNT[s2] as number) >= 5) fm = s2;
  else if ((POPCNT[s3] as number) >= 5) fm = s3;

  if (fm !== 0) {
    // 7장 이하에서 한 슈트가 5장 이상이면 풀하우스/쿼드는 성립할 수 없다
    // (남는 카드가 2장뿐이라 트립+페어를 동시에 못 만든다). 따라서 SF/플러시가 곧 정답.
    const sh = STRAIGHT_HIGH[fm] as number;
    if (sh >= 0) return C_SF | sh;
    return C_FLUSH | (TOP5[fm] as number);
  }

  if (m4 !== 0) {
    const q = 31 - Math.clz32(m4);
    const k = (TOP5[m1 & ~(1 << q)] as number) >>> 16;
    return C_QUADS | (q << 4) | k;
  }

  if (m3 !== 0) {
    const t = 31 - Math.clz32(m3);
    // 두 번째 트립스도 페어 역할을 할 수 있다 (AAAKKK → AAAKK).
    const rest = (m3 & ~(1 << t)) | (m2 & ~m3);
    if (rest !== 0) {
      const p = 31 - Math.clz32(rest);
      return C_BOAT | (t << 4) | p;
    }
  }

  const sh = STRAIGHT_HIGH[m1] as number;
  if (sh >= 0) return C_STRAIGHT | sh;

  if (m3 !== 0) {
    const t = 31 - Math.clz32(m3);
    const k2 = (TOP5[m1 & ~(1 << t)] as number) >>> 12;
    return C_TRIPS | (t << 8) | k2;
  }

  if (m2 !== 0) {
    const p1 = 31 - Math.clz32(m2);
    const rest2 = m2 & ~(1 << p1);
    if (rest2 !== 0) {
      const p2 = 31 - Math.clz32(rest2);
      const k = (TOP5[m1 & ~(1 << p1) & ~(1 << p2)] as number) >>> 16;
      return C_TWOPAIR | (p1 << 8) | (p2 << 4) | k;
    }
    const k3 = (TOP5[m1 & ~(1 << p1)] as number) >>> 8;
    return C_PAIR | (p1 << 12) | k3;
  }

  return C_HIGH | (TOP5[m1] as number);
}

function evalCards(cards: readonly Card[]): HandValue {
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  // 52장 중복 검사용 카드 집합. JS 비트 연산이 32비트라 두 개로 쪼갠다.
  // 이 함수는 핫 경로가 아니다 (에퀴티는 evaluateMasks 를 직접 부른다) → 검사 비용을 감수한다.
  let seenLo = 0;
  let seenHi = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i] as number;
    if (!Number.isInteger(c) || c < 0 || c > 51) {
      throw new CardSyntaxError(`card out of range 0..51: ${String(c)}`);
    }
    if (c < 32) {
      const bit = 1 << c;
      if ((seenLo & bit) !== 0) {
        throw new CardSyntaxError(`duplicate card ${formatCard(c)} at index ${String(i)}`);
      }
      seenLo |= bit;
    } else {
      const bit = 1 << (c - 32);
      if ((seenHi & bit) !== 0) {
        throw new CardSyntaxError(`duplicate card ${formatCard(c)} at index ${String(i)}`);
      }
      seenHi |= bit;
    }
    const b = 1 << (c >> 2);
    m4 |= m3 & b;
    m3 |= m2 & b;
    m2 |= m1 & b;
    m1 |= b;
    const s = c & 3;
    if (s === 0) s0 |= b;
    else if (s === 1) s1 |= b;
    else if (s === 2) s2 |= b;
    else s3 |= b;
  }
  return evaluateMasks(m1, m2, m3, m4, s0, s1, s2, s3);
}

/**
 * 정확히 5장. 카드 범위(0..51)와 **중복 카드**를 검사한다 (P0.md 4.4, R1).
 * 중복 검사가 없으면 evaluate5(As,As,Ks,Qs,Js) 가 조용히 Pair 를 돌려준다.
 */
export function evaluate5(cards: readonly Card[]): HandValue {
  if (cards.length !== 5) {
    throw new CardSyntaxError(`evaluate5 needs exactly 5 cards, got ${String(cards.length)}`);
  }
  return evalCards(cards);
}

/** 5..7장에서 베스트 5. 카드 범위와 중복 카드를 검사한다 (P0.md 4.4, R1). */
export function evaluate7(cards: readonly Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) {
    throw new CardSyntaxError(`evaluate7 needs 5..7 cards, got ${String(cards.length)}`);
  }
  return evalCards(cards);
}

export function handCategory(v: HandValue): HandCategory {
  return (v >>> 20) as HandCategory;
}

export function handCategoryName(c: HandCategory): string {
  return HandCategory[c] ?? `Unknown(${String(c)})`;
}
