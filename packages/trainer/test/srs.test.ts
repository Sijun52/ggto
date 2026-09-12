/**
 * P3.md 5.3 SM-2 변형. 검증값은 스펙이 못박은 숫자다 — 구현을 복사해 오지 않는다.
 */

import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  INITIAL_EASE,
  LEECH_LAPSES,
  MAX_INTERVAL_DAYS,
  MIN_EASE,
  applyReview,
  dueCapAt,
  isLeech,
  qualityOf,
} from '../src/srs.js';

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

describe('P3 5.3 간격 상한 (R2 / P3 R1 MAJOR 1)', () => {
  it('Perfect ×100 → interval ≤ 365, dueAt 이 2^53 안에 있다', () => {
    let s = applyReview(null, 'Perfect', T0);
    for (let i = 1; i < 100; i++) {
      s = applyReview(s, 'Perfect', T0);
      // 매 스텝이 전부 안전해야 한다 (마지막만 보면 중간에 Infinity 가 났어도 못 본다).
      expect(Number.isFinite(s.intervalDays)).toBe(true);
      expect(s.intervalDays).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
      expect(s.dueAt).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
      expect(Number.isSafeInteger(s.dueAt)).toBe(true);
    }
    expect(s.reps).toBe(100);
    // 상한 없는 판이라면 여기서 interval 이 1e8 일 규모, dueAt 이 1e16 을 넘었다.
    expect(s.intervalDays).toBe(MAX_INTERVAL_DAYS);
    expect(s.dueAt).toBe(T0 + MAX_INTERVAL_DAYS * DAY_MS);
    // ease 는 막지 않는다 (상한 근거: 간격이 막히면 폭주하지 않는다).
    expect(s.ease).toBeGreaterThan(INITIAL_EASE);
  });

  it('상한은 검증값 1, 6, 16 을 건드리지 않는다', () => {
    // 상한이 낮게 잡혔거나 잘못된 분기에 걸리면 이 값들이 흔들린다.
    let s = applyReview(null, 'Perfect', T0);
    expect(s.intervalDays).toBe(1);
    s = applyReview(s, 'Perfect', T0);
    expect(s.intervalDays).toBe(6);
    s = applyReview(s, 'Perfect', T0);
    expect(s.intervalDays).toBe(16);
  });

  it('상한 이전에 저장된 비정상 간격이 들어와도 정상 범위로 돌아온다', () => {
    const broken = {
      ease: 4.1,
      intervalDays: 120_864_680,
      reps: 16,
      lapses: 0,
      dueAt: 10_444_497_534_716_632,
      lastVerdict: 'Perfect' as const,
      updatedAt: T0,
    };
    const fixed = applyReview(broken, 'Perfect', T0);
    expect(fixed.intervalDays).toBe(MAX_INTERVAL_DAYS);
    expect(Number.isSafeInteger(fixed.dueAt)).toBe(true);
  });

  it('dueCapAt 은 now + 365일이다', () => {
    expect(dueCapAt(T0)).toBe(T0 + 365 * DAY_MS);
  });
});
