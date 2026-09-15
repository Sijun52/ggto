/**
 * P5.md 3.3 / 8.1 — 런아웃 히트맵의 대칭 스케일.
 *
 * 대칭이 아니면 (`[0, max]` 정규화) 평균보다 나쁜 카드가 전부 같은 색이 되어 히트맵이
 * 답해야 할 질문("어느 런아웃이 유리한가")에 답하지 못한다.
 */

import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../src/lib/palette';
import {
  deviations,
  heatColor,
  heatTextColor,
  meanOf,
  symmetricScale,
  HEAT_NEUTRAL,
} from '../src/lib/runoutScale';

describe('P5 3.3 대칭 정규화', () => {
  it('P5 3.3 [+2, −1] 은 max 2 이고 −1 이 −0.5 다', () => {
    const s = symmetricScale([2, -1]);
    expect(s.max).toBe(2);
    expect(s.normalize(-1)).toBe(-0.5);
    expect(s.normalize(2)).toBe(1);
    expect(s.normalize(0)).toBe(0);
  });

  it('P5 3.3 전부 0 이면 max 0 이고 모두 회색이다 (0 으로 나누지 않는다)', () => {
    const s = symmetricScale([0, 0, 0]);
    expect(s.max).toBe(0);
    expect(s.normalize(0)).toBe(0);
    expect(Number.isNaN(s.normalize(5))).toBe(false);
    expect(heatColor(s.normalize(0))).toBe(HEAT_NEUTRAL);
  });

  it('P5 3.3 편차는 평균 기준이고 합이 0 이다', () => {
    const values = [3, 1, 2];
    expect(meanOf(values)).toBe(2);
    const d = deviations(values) as number[];
    expect(d).toEqual([1, -1, 0]);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 10);
  });

  it('P5 3.3 값이 없는 카드(null·NaN)는 평균에도 색에도 들어가지 않는다', () => {
    expect(meanOf([null, 2, 4])).toBe(3);
    expect(meanOf([null, null])).toBeNull();
    expect(deviations([null, 2, 4])).toEqual([null, -1, 1]);
    expect(heatColor(null)).toBe(HEAT_NEUTRAL);
  });

  it('P5 3.3 부호가 색을 가른다 — +는 초록 쪽, −는 빨강 쪽', () => {
    const plus = heatColor(1);
    const minus = heatColor(-1);
    expect(plus).not.toBe(minus);
    const green = (hex: string): number => Number.parseInt(hex.slice(3, 5), 16);
    const red = (hex: string): number => Number.parseInt(hex.slice(1, 3), 16);
    expect(green(plus)).toBeGreaterThan(green(minus));
    expect(red(minus)).toBeGreaterThan(red(plus));
  });
});

describe('P5 5 히트맵 대비 (WCAG AA)', () => {
  it('P5 5 모든 칸 색 위의 글자 대비가 4.5 이상이다', () => {
    const steps = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
    for (const t of steps) {
      const bg = heatColor(t);
      const fg = heatTextColor(bg);
      expect(contrastRatio(fg, bg), `t=${String(t)} bg=${bg} fg=${fg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
