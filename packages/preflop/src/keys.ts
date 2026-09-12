/**
 * ggto-json 의 전략 키 ↔ 콤보 인덱스. P2.md 5.1.
 *
 * 키 목록은 전부 core 에서 유도한다. 여기에 핸드 이름을 적어두면 core 의 인덱스 규약이
 * 바뀌었을 때 파일 포맷만 조용히 어긋난다 (P2.md 2절: preflop 의 핸드 이름 리터럴 0).
 */

import {
  COMBO_COUNT,
  HAND_CLASS_COUNT,
  comboCards,
  formatCard,
  handClassCombos,
  handClassName,
  handClassOf,
} from '@ggto/core';
import type { Resolution } from './types.js';

/** 169 키: handClassName. 인덱스 = 핸드클래스 인덱스 */
export const CLASS_KEYS: readonly string[] = Array.from({ length: HAND_CLASS_COUNT }, (_, h) =>
  handClassName(h),
);

/** 1326 키: formatCard(hi)+formatCard(lo). 인덱스 = 콤보 인덱스 */
export const COMBO_KEYS: readonly string[] = Array.from({ length: COMBO_COUNT }, (_, i) => {
  const [hi, lo] = comboCards(i);
  return formatCard(hi) + formatCard(lo);
});

/** 클래스 인덱스 → 그 클래스의 콤보 인덱스들 (core 가 정한 4/6/12) */
export const CLASS_COMBOS: readonly (readonly number[])[] = Array.from(
  { length: HAND_CLASS_COUNT },
  (_, h) => handClassCombos(h),
);

/** 콤보 인덱스 → 클래스 인덱스 */
export const CLASS_OF_COMBO: Readonly<Uint8Array> = (() => {
  const t = new Uint8Array(COMBO_COUNT);
  for (let i = 0; i < COMBO_COUNT; i++) t[i] = handClassOf(i);
  return t;
})();

export function keysFor(resolution: Resolution): readonly string[] {
  return resolution === '169' ? CLASS_KEYS : COMBO_KEYS;
}

/** 키 → 인덱스 (클래스 인덱스 또는 콤보 인덱스). 없으면 -1 */
export function keyIndex(resolution: Resolution, key: string): number {
  const table = resolution === '169' ? CLASS_KEY_INDEX : COMBO_KEY_INDEX;
  return table.get(key) ?? -1;
}

const CLASS_KEY_INDEX = new Map<string, number>(CLASS_KEYS.map((k, i) => [k, i]));
const COMBO_KEY_INDEX = new Map<string, number>(COMBO_KEYS.map((k, i) => [k, i]));

/** 해당 해상도의 키 하나가 커버하는 콤보 인덱스들 */
export function combosForKeyIndex(resolution: Resolution, index: number): readonly number[] {
  return resolution === '169' ? (CLASS_COMBOS[index] ?? []) : [index];
}
