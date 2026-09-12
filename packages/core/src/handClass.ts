/**
 * 169 핸드클래스. P0.md 3.3. **표시 전용.**
 *
 * 13x13 격자, row/col 모두 0=A … 12=2. index = row*13 + col.
 *   row === col → 포켓페어 (AA=0, 22=168)
 *   row  <  col → 수티드 (우상단). 높은 랭크가 row. AKs = 1
 *   row  >  col → 오프수트 (좌하단). 높은 랭크가 col. AKo = 13
 *
 * 주의: 이 모듈은 "콤보 → 클래스" 와 "클래스 → 콤보 집합" 만 제공한다.
 * 169 인덱스를 입력으로 받아 확률/에퀴티 등을 계산하는 함수는 만들지 않는다 (설계 위반).
 */

import { CardSyntaxError, RANKS, cardRank, cardSuit } from './card.js';
import { COMBO_COUNT, comboCards, type ComboIndex } from './combo.js';

export type HandClassIndex = number;

export const HAND_CLASS_COUNT = 169;

/** 랭크(0=2..12=A) → 격자 좌표(0=A..12=2) */
function gridOf(rank: number): number {
  return 12 - rank;
}

/** 격자 좌표(0=A..12=2) → 랭크(0=2..12=A) */
function rankOfGrid(g: number): number {
  return 12 - g;
}

const HAND_CLASS_OF_COMBO = new Uint8Array(COMBO_COUNT);
const CLASS_COMBOS: ComboIndex[][] = Array.from({ length: HAND_CLASS_COUNT }, () => []);

function computeHandClass(hi: number, lo: number): HandClassIndex {
  const rh = cardRank(hi);
  const rl = cardRank(lo);
  // 카드 id 순서상 hi > lo 지만 같은 랭크면 랭크는 동률이다. 높은 랭크를 hiRank 로 재정렬.
  const hiRank = rh >= rl ? rh : rl;
  const loRank = rh >= rl ? rl : rh;
  const gHi = gridOf(hiRank);
  const gLo = gridOf(loRank);
  if (hiRank === loRank) return gHi * 13 + gHi;
  const suited = cardSuit(hi) === cardSuit(lo);
  return suited ? gHi * 13 + gLo : gLo * 13 + gHi;
}

for (let i = 0; i < COMBO_COUNT; i++) {
  const [hi, lo] = comboCards(i);
  const h = computeHandClass(hi, lo);
  HAND_CLASS_OF_COMBO[i] = h;
  (CLASS_COMBOS[h] as ComboIndex[]).push(i);
}

export function handClassOf(i: ComboIndex): HandClassIndex {
  if (!Number.isInteger(i) || i < 0 || i >= COMBO_COUNT) {
    throw new CardSyntaxError(`combo index out of range 0..1325: ${String(i)}`);
  }
  return HAND_CLASS_OF_COMBO[i] as number;
}

export function assertHandClassIndex(h: number): HandClassIndex {
  if (!Number.isInteger(h) || h < 0 || h >= HAND_CLASS_COUNT) {
    throw new CardSyntaxError(`hand class index out of range 0..168: ${String(h)}`);
  }
  return h;
}

export function handClassName(h: HandClassIndex): string {
  assertHandClassIndex(h);
  const row = (h / 13) | 0;
  const col = h % 13;
  const rRow = RANKS[rankOfGrid(row)] as string;
  const rCol = RANKS[rankOfGrid(col)] as string;
  if (row === col) return rRow + rRow;
  if (row < col) return rRow + rCol + 's';
  return rCol + rRow + 'o';
}

export function parseHandClass(name: string): HandClassIndex {
  if (typeof name !== 'string') throw new CardSyntaxError('parseHandClass expects a string');
  if (name.length !== 2 && name.length !== 3) {
    throw new CardSyntaxError(`bad hand class ${JSON.stringify(name)}`);
  }
  const r1 = RANKS.indexOf(name[0] as string);
  const r2 = RANKS.indexOf(name[1] as string);
  if (r1 < 0 || r2 < 0) throw new CardSyntaxError(`bad rank in hand class ${JSON.stringify(name)}`);
  const sfx = name.length === 3 ? name[2] : undefined;
  if (r1 === r2) {
    if (sfx !== undefined) throw new CardSyntaxError(`pair must not carry a suffix: ${JSON.stringify(name)}`);
    return gridOf(r1) * 13 + gridOf(r1);
  }
  if (r1 <= r2) throw new CardSyntaxError(`hand class must be written high rank first: ${JSON.stringify(name)}`);
  if (sfx !== 's' && sfx !== 'o') {
    throw new CardSyntaxError(`non-pair hand class needs 's' or 'o' suffix: ${JSON.stringify(name)}`);
  }
  const gHi = gridOf(r1);
  const gLo = gridOf(r2);
  return sfx === 's' ? gHi * 13 + gLo : gLo * 13 + gHi;
}

/** 클래스에 속한 콤보들 (페어 6, 수티드 4, 오프수트 12). 방어적 복사본을 돌려준다. */
export function handClassCombos(h: HandClassIndex): ComboIndex[] {
  assertHandClassIndex(h);
  return (CLASS_COMBOS[h] as ComboIndex[]).slice();
}

/** 내부 고속 경로용. 변형 금지. */
export const HAND_CLASS_OF_COMBO_TABLE: Readonly<Uint8Array> = HAND_CLASS_OF_COMBO;
export const HAND_CLASS_COMBOS_TABLE: readonly (readonly ComboIndex[])[] = CLASS_COMBOS;

export enum HandClassKind {
  Pair = 0,
  Suited = 1,
  Offsuit = 2,
}

export function handClassKind(h: HandClassIndex): HandClassKind {
  assertHandClassIndex(h);
  const row = (h / 13) | 0;
  const col = h % 13;
  if (row === col) return HandClassKind.Pair;
  return row < col ? HandClassKind.Suited : HandClassKind.Offsuit;
}

/** 클래스 → (높은 랭크, 낮은 랭크). 페어면 둘이 같다. 랭크는 0=2..12=A. */
export function handClassRanks(h: HandClassIndex): [hi: number, lo: number] {
  assertHandClassIndex(h);
  const row = (h / 13) | 0;
  const col = h % 13;
  const a = rankOfGrid(row);
  const b = rankOfGrid(col);
  return a >= b ? [a, b] : [b, a];
}

/** 랭크 쌍 + 수티드 여부 → 클래스 인덱스. 내부 파서/포매터용. */
export function handClassFromRanks(hiRank: number, loRank: number, suited: boolean): HandClassIndex {
  if (hiRank === loRank) {
    const g = gridOf(hiRank);
    return g * 13 + g;
  }
  const gHi = gridOf(hiRank);
  const gLo = gridOf(loRank);
  return suited ? gHi * 13 + gLo : gLo * 13 + gHi;
}
