/**
 * P3.md 6절 리포트. **두 채점 체계는 절대 합산되지 않는다** (D8).
 */

import { describe, expect, it } from 'vitest';
import { LEAK_MIN_ATTEMPTS, LEAK_MIN_MEAN_BB, aggregate, byCategory, bySet, leaksOf } from '../src/report.js';
import type { AttemptAgg } from '../src/store.js';
import type { Category, Verdict } from '../src/types.js';

function ev(evLossBb: number, verdict: Verdict, opts: { category?: Category; hash?: string; mixed?: 0 | 1 } = {}): AttemptAgg {
  return {
    contentHash: opts.hash ?? 'a'.repeat(64),
    category: opts.category ?? 'open',
    gradedBy: 'ev',
    evLossBb,
    verdict,
    mixed: opts.mixed ?? 0,
  };
}

function freq(verdict: 'InStrategy' | 'OffStrategy', opts: { category?: Category; hash?: string } = {}): AttemptAgg {
  return {
    contentHash: opts.hash ?? 'a'.repeat(64),
    category: opts.category ?? 'open',
    gradedBy: 'frequency',
    evLossBb: null,
    verdict,
    mixed: 0,
  };
}

describe('P3 6 집계', () => {
  it('EV 평균의 분모는 attempts 가 아니라 evGraded 다', () => {
    const rows = [ev(0, 'Perfect'), ev(1, 'Blunder'), freq('InStrategy'), freq('OffStrategy')];
    const agg = aggregate(rows);
    expect(agg.attempts).toBe(4);
    expect(agg.evGraded).toBe(2);
    // 4 로 나누면 0.25 가 된다 — 빈도 채점을 "손실 0" 으로 세면 안 된다.
    expect(agg.meanEvLossBb).toBeCloseTo(0.5, 10);
    expect(agg.bb100).toBeCloseTo(50, 10);
  });

  it('byVerdict 는 6개 키 전부를 갖고 두 체계를 함께 센다', () => {
    const agg = aggregate([ev(0, 'Perfect'), freq('InStrategy')]);
    expect(Object.keys(agg.byVerdict).sort()).toEqual(
      ['Blunder', 'InStrategy', 'Minor', 'Mistake', 'OffStrategy', 'Perfect'].sort(),
    );
    expect(agg.byVerdict.Perfect).toBe(1);
    expect(agg.byVerdict.InStrategy).toBe(1);
    expect(agg.byVerdict.Mistake).toBe(0);
  });

  it('ev 채점이 하나도 없으면 EV 통계는 null 이다 (0 이 아니다)', () => {
    const agg = aggregate([freq('InStrategy'), freq('OffStrategy')]);
    expect(agg.attempts).toBe(2);
    expect(agg.evGraded).toBe(0);
    expect(agg.meanEvLossBb).toBeNull();
    expect(agg.bb100).toBeNull();
    expect(agg.mixedShare).toBeNull();
  });

  it('mixedShare 의 분모도 evGraded 다', () => {
    const agg = aggregate([ev(0, 'Perfect', { mixed: 1 }), ev(0, 'Perfect'), freq('InStrategy')]);
    expect(agg.mixedShare).toBeCloseTo(0.5, 10);
  });

  it('빈 목록도 6개 verdict 키를 준다', () => {
    const agg = aggregate([]);
    expect(agg.attempts).toBe(0);
    expect(agg.byVerdict.Blunder).toBe(0);
    expect(agg.meanEvLossBb).toBeNull();
  });
});

describe('P3 6 분해', () => {
  it('카테고리 순서는 CATEGORIES 고정 순서다', () => {
    const rows = [ev(0, 'Perfect', { category: 'vs_jam' }), ev(0, 'Perfect', { category: 'open' })];
    expect(byCategory(rows).map((c) => c.category)).toEqual(['open', 'vs_jam']);
  });

  it('셋별 이름은 질의 시 해시로 찾고 없으면 null 이다', () => {
    const rows = [ev(0, 'Perfect', { hash: 'b'.repeat(64) }), ev(0, 'Perfect', { hash: 'c'.repeat(64) })];
    const out = bySet(rows, (h) => (h.startsWith('b') ? 'HU 10bb' : null));
    expect(out).toHaveLength(2);
    expect(out[0]?.name).toBe('HU 10bb');
    expect(out[1]?.name).toBeNull();
  });
});

describe('P3 6 리크', () => {
  it('ev 채점 20회 이상 + 평균 0.10bb 이상만 리크다', () => {
    const many = (n: number, loss: number, category: Category): AttemptAgg[] =>
      Array.from({ length: n }, () => ev(loss, 'Minor', { category }));
    const cats = byCategory([
      ...many(LEAK_MIN_ATTEMPTS, 0.31, 'vs_jam'),
      ...many(LEAK_MIN_ATTEMPTS - 1, 5, 'vs_3bet'), // 표본 부족
      ...many(LEAK_MIN_ATTEMPTS, 0.05, 'open'), // 평균 미달
    ]);
    const leaks = leaksOf(cats);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.category).toBe('vs_jam');
    expect(leaks[0]?.attempts).toBe(LEAK_MIN_ATTEMPTS);
    expect(leaks[0]?.meanEvLossBb).toBeCloseTo(0.31, 6);
  });

  it('평균 내림차순이다', () => {
    const many = (loss: number, category: Category): AttemptAgg[] =>
      Array.from({ length: 30 }, () => ev(loss, 'Minor', { category }));
    const leaks = leaksOf(byCategory([...many(0.2, 'open'), ...many(0.9, 'vs_jam')]));
    expect(leaks.map((l) => l.category)).toEqual(['vs_jam', 'open']);
  });

  it('빈도 채점만 쌓이면 리크가 잡히지 않는다 (EV 가 없으므로 손실을 모른다)', () => {
    const rows = Array.from({ length: 100 }, () => freq('OffStrategy', { category: 'vs_jam' }));
    expect(leaksOf(byCategory(rows))).toHaveLength(0);
  });

  it('임계 상수는 20 / 0.10bb 다', () => {
    expect(LEAK_MIN_ATTEMPTS).toBe(20);
    expect(LEAK_MIN_MEAN_BB).toBe(0.1);
  });
});
