/**
 * 런아웃 히트맵의 색 스케일 (P5.md 3.3).
 *
 * 규칙: 값에서 **평균을 뺀 편차**를 `[−max|d|, +max|d|]` 로 **대칭** 정규화한다.
 * 대칭이 아니면 (예: [0, max] 로 정규화) 평균보다 나쁜 카드가 전부 같은 색이 되어
 * "어느 런아웃이 OOP 에 유리한가" 라는 질문에 답하지 못한다.
 *
 * 색은 회색(편차 0) → 초록(+) / 빨강(−) 선형 보간이다. 글자색은 `bestTextOn` 으로
 * 배경에서 유도한다 (P3M 5절): 고정 색을 쓰면 중간 톤에서 AA 4.5 를 깬다.
 */

import { bestTextOn } from './palette';

/** 편차 0 (평균과 같은 카드). `bestTextOn` = 검정, 대비 7.87 */
export const HEAT_NEUTRAL = '#94a3b8';
/** +1 (가장 유리) — 대비 7.88 */
export const HEAT_POSITIVE = '#34d399';
/** −1 (가장 불리) — 대비 5.84 */
export const HEAT_NEGATIVE = '#f87171';

export interface SymmetricScale {
  /** 편차의 최대 절댓값. 0 이면 전부 같은 값이라 회색이다 */
  max: number;
  /** 편차 → [−1, 1] */
  normalize: (value: number) => number;
}

/**
 * 유한한 값들만으로 대칭 스케일을 만든다.
 *
 * 값이 전부 같으면 `max = 0` 이고 모든 정규화 결과가 0 이다 (회색) — 0 으로 나누지 않는다.
 */
export function symmetricScale(values: readonly number[]): SymmetricScale {
  let max = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const a = Math.abs(v);
    if (a > max) max = a;
  }
  return {
    max,
    normalize: (value: number): number => {
      if (!Number.isFinite(value) || max === 0) return 0;
      const t = value / max;
      return t > 1 ? 1 : t < -1 ? -1 : t;
    },
  };
}

/** 유한한 값들의 평균. 하나도 없으면 null (그릴 것이 없다 — 0 으로 꾸미지 않는다). */
export function meanOf(values: readonly (number | null)[]): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    sum += v;
    n++;
  }
  return n === 0 ? null : sum / n;
}

/** 값 목록 → 평균 대비 편차 (값이 없으면 null 을 유지한다) */
export function deviations(values: readonly (number | null)[]): (number | null)[] {
  const mean = meanOf(values);
  if (mean === null) return values.map(() => null);
  return values.map((v) => (v === null || !Number.isFinite(v) ? null : v - mean));
}

function mix(from: string, to: string, t: number): string {
  const a = Number.parseInt(from.slice(1), 16);
  const b = Number.parseInt(to.slice(1), 16);
  const ch = (shift: number): number => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * t);
  };
  return `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** 정규화된 편차 `t ∈ [−1, 1]` → 배경색. `null`(값 없음) 은 회색이다. */
export function heatColor(t: number | null): string {
  if (t === null || !Number.isFinite(t) || t === 0) return HEAT_NEUTRAL;
  return t > 0 ? mix(HEAT_NEUTRAL, HEAT_POSITIVE, Math.min(1, t)) : mix(HEAT_NEUTRAL, HEAT_NEGATIVE, Math.min(1, -t));
}

/** 히트맵 칸의 글자색 (배경에서 유도 — P3M 5절) */
export function heatTextColor(bg: string): string {
  return bestTextOn(bg);
}
