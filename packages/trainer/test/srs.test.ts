/**
 * P3.md 5.3 SM-2 변형. 검증값은 스펙이 못박은 숫자다 — 구현을 복사해 오지 않는다.
 */

import { describe, expect, it } from 'vitest';
import { DAY_MS, INITIAL_EASE, LEECH_LAPSES, MIN_EASE, applyReview, isLeech, qualityOf } from '../src/srs.js';

const T0 = 1_000_000;

describe('P3 5.3 SM-2 검증값', () => {
  it('[Perfect, Perfect, Perfect] → interval 1, 6, 16', () => {
    const a = applyReview(null, 'Perfect', T0);
    expect(a.intervalDays).toBe(1);
    expect(a.ease).toBeCloseTo(2.6, 10);
    expect(a.reps).toBe(1);
    expect(a.dueAt).toBe(T0 + DAY_MS);

    const b = applyReview(a, 'Perfect', T0);
    expect(b.intervalDays).toBe(6);
    expect(b.ease).toBeCloseTo(2.7, 10);
    expect(b.reps).toBe(2);

    const c = applyReview(b, 'Perfect', T0);
    // round(6 × 2.7) = 16 — interval 은 **갱신 전** ease 로 계산한다.
    expect(c.intervalDays).toBe(16);
    expect(c.ease).toBeCloseTo(2.8, 10);
    expect(c.reps).toBe(3);
    expect(c.dueAt).toBe(T0 + 16 * DAY_MS);
  });

  it('그 다음 Blunder → interval 1, lapses 1, ease 2.0', () => {
    let s = applyReview(null, 'Perfect', T0);
    s = applyReview(s, 'Perfect', T0);
    s = applyReview(s, 'Perfect', T0);
    const lapsed = applyReview(s, 'Blunder', T0);
    expect(lapsed.intervalDays).toBe(1);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.reps).toBe(0);
    // max(1.3, 2.8 + 0.1 − 5 × 0.18) = 2.0
    expect(lapsed.ease).toBeCloseTo(2.0, 10);
  });

  it('[Blunder × 3] → lapses 3 = leech', () => {
    let s = applyReview(null, 'Blunder', T0);
    expect(isLeech(s)).toBe(false);
    s = applyReview(s, 'Blunder', T0);
    expect(isLeech(s)).toBe(false);
    s = applyReview(s, 'Blunder', T0);
    expect(s.lapses).toBe(LEECH_LAPSES);
    expect(isLeech(s)).toBe(true);
  });

  it('ease 는 1.3 아래로 내려가지 않는다', () => {
    let s = applyReview(null, 'Blunder', T0);
    for (let i = 0; i < 20; i++) s = applyReview(s, 'Blunder', T0);
    expect(s.ease).toBe(MIN_EASE);
  });

  it('초기 ease 는 2.5 다', () => {
    expect(INITIAL_EASE).toBe(2.5);
  });
});

describe('P3 5.3 verdict → q', () => {
  it('두 채점 체계가 같은 q 축에 올라간다 (큐는 하나다)', () => {
    expect(qualityOf('Perfect')).toBe(5);
    expect(qualityOf('Minor')).toBe(3);
    expect(qualityOf('Mistake')).toBe(1);
    expect(qualityOf('Blunder')).toBe(0);
    expect(qualityOf('InStrategy')).toBe(4);
    expect(qualityOf('OffStrategy')).toBe(1);
  });

  it('q ≥ 3 만 간격이 늘어난다 (Minor 는 유지, Mistake 는 lapse)', () => {
    const minor = applyReview(null, 'Minor', T0);
    expect(minor.reps).toBe(1);
    expect(minor.lapses).toBe(0);

    const mistake = applyReview(null, 'Mistake', T0);
    expect(mistake.reps).toBe(0);
    expect(mistake.lapses).toBe(1);
    expect(mistake.intervalDays).toBe(1);
  });

  it('InStrategy(q=4) 도 간격을 늘린다 — EV 없는 차트로도 복습 큐가 돈다', () => {
    const a = applyReview(null, 'InStrategy', T0);
    expect(a.intervalDays).toBe(1);
    const b = applyReview(a, 'InStrategy', T0);
    expect(b.intervalDays).toBe(6);
    // q=4 는 ease 를 정확히 유지한다: +0.1 − 1×(0.08 + 1×0.02) = 0
    expect(b.ease).toBeCloseTo(2.5, 10);
  });
});
