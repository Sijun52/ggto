/**
 * P3.md 5.1 풀 / 5.2 가중치. 테스트는 상수의 현명함이 아니라 **비례 관계**를 본다.
 */

import { COMBO_COUNT, createRng, type ComboIndex } from '@ggto/core';
import { describe, expect, it } from 'vitest';
import { buildPool, sampleCombo, type PoolNode } from '../src/pool.js';
import { difficultyWeight, leakWeight, nodeWeight, pickNode } from '../src/sampler.js';
import { EmptyPoolError, type Category } from '../src/types.js';
import { seededRepo } from './helpers.js';

function fakeNode(over: Partial<PoolNode>): PoolNode {
  const reach = new Float32Array(COMBO_COUNT).fill(1);
  const cum = new Float64Array(COMBO_COUNT);
  let acc = 0;
  for (let c = 0; c < COMBO_COUNT; c++) {
    acc += reach[c] as number;
    cum[c] = acc;
  }
  return {
    contentHash: 'a'.repeat(64),
    chartSetId: 1,
    chartName: 'fake',
    config: { positions: ['SB', 'BB'], blinds: [{ pos: 'SB', amount: 0.5 }], ante: { mode: 'none' }, stack: 10 },
    resolution: '1326',
    gradedBy: 'ev',
    seq: '',
    heroPos: 'SB',
    potBb: 1.5,
    actions: ['F', 'A'],
    category: 'open',
    reachHero: reach,
    mass: 1,
    mixedMass: 0,
    cumulative: cum,
    ...over,
  };
}

describe('P3 5.1 후보 풀', () => {
  it('시드 6개 × 비터미널 2노드 = 12 이고 터미널은 없다', () => {
    const repo = seededRepo();
    try {
      const pool = buildPool(repo, {});
      expect(pool.nodes).toHaveLength(12);
      expect(pool.categories).toEqual(['open', 'vs_jam']);
      for (const n of pool.nodes) {
        expect(['', 'A']).toContain(n.seq);
        expect(n.mass).toBeGreaterThan(0);
        expect(n.reachHero).toHaveLength(COMBO_COUNT);
      }
    } finally {
      repo.close();
    }
  });

  it('HU 푸시폴드는 두 노드 다 히어로 도달 질량이 1 이다 (아직 아무도 폴드하지 않았다)', () => {
    const repo = seededRepo();
    try {
      for (const n of buildPool(repo, {}).nodes) expect(n.mass).toBeCloseTo(1, 6);
    } finally {
      repo.close();
    }
  });

  it('카테고리 필터가 풀을 줄인다', () => {
    const repo = seededRepo();
    try {
      const open = buildPool(repo, { categories: ['open'] });
      expect(open.nodes).toHaveLength(6);
      expect(open.nodes.every((n) => n.category === 'open')).toBe(true);
    } finally {
      repo.close();
    }
  });

  it('맞는 노드가 없으면 EmptyPoolError (세션을 만들지 않는다)', () => {
    const repo = seededRepo();
    try {
      expect(() => buildPool(repo, { categories: ['vs_3bet' as Category] })).toThrow(EmptyPoolError);
      expect(() => buildPool(repo, { contentHashes: ['f'.repeat(64)] })).toThrow(EmptyPoolError);
    } finally {
      repo.close();
    }
  });
});

describe('P3 5.2 가중치 비례 관계', () => {
  it('w1: 가중치는 mass 에 비례한다', () => {
    const a = fakeNode({ mass: 1 });
    const b = fakeNode({ mass: 0.25 });
    const none = new Map<Category, number>();
    expect(nodeWeight(a, none) / nodeWeight(b, none)).toBeCloseTo(4, 10);
  });

  it('w2: 혼합 질량 1 인 노드는 순수 노드의 1.5배다', () => {
    expect(difficultyWeight(0)).toBe(1);
    expect(difficultyWeight(1)).toBe(1.5);
    expect(difficultyWeight(0.5)).toBe(1.25);
    // 단조 증가
    expect(difficultyWeight(0.3)).toBeGreaterThan(difficultyWeight(0.2));
  });

  it('w4: 평균 EV loss 0.3bb 면 2배, 상한은 3배다', () => {
    expect(leakWeight(undefined)).toBe(1);
    expect(leakWeight(0)).toBe(1);
    expect(leakWeight(0.3)).toBeCloseTo(2, 10);
    expect(leakWeight(0.15)).toBeCloseTo(1.5, 10);
    expect(leakWeight(10)).toBe(3);
  });

  it('세 가중치는 곱이다', () => {
    const n = fakeNode({ mass: 0.5, mixedMass: 1, category: 'vs_jam' });
    const leaks = new Map<Category, number>([['vs_jam', 0.3]]);
    expect(nodeWeight(n, leaks)).toBeCloseTo(0.5 * 1.5 * 2, 10);
  });

  it('리크가 있는 카테고리가 실제로 더 자주 뽑힌다', () => {
    const nodes = [fakeNode({ category: 'open', seq: '' }), fakeNode({ category: 'vs_jam', seq: 'A' })];
    const leaks = new Map<Category, number>([['vs_jam', 0.6]]); // w4 = 3
    const rng = createRng(7);
    let jam = 0;
    for (let i = 0; i < 4000; i++) if (pickNode(nodes, leaks, rng).category === 'vs_jam') jam++;
    // 기대 비율 3/4. 표본 4000 의 표준편차는 0.007 이므로 ±0.03 은 넉넉하다.
    expect(jam / 4000).toBeGreaterThan(0.72);
    expect(jam / 4000).toBeLessThan(0.78);
  });
});

describe('P3 5.2 콤보 추첨은 reach_hero 비례', () => {
  it('reach 0 인 콤보는 절대 나오지 않는다', () => {
    const reach = new Float32Array(COMBO_COUNT);
    reach[5] = 1;
    reach[9] = 3;
    const cum = new Float64Array(COMBO_COUNT);
    let acc = 0;
    for (let c = 0; c < COMBO_COUNT; c++) {
      acc += reach[c] as number;
      cum[c] = acc;
    }
    const node = fakeNode({ reachHero: reach, cumulative: cum });
    const rng = createRng(11);
    const counts = new Map<ComboIndex, number>();
    for (let i = 0; i < 8000; i++) {
      const c = sampleCombo(node, rng);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual([5, 9]);
    // 3:1 비례 (±3%p)
    expect((counts.get(9) ?? 0) / 8000).toBeGreaterThan(0.72);
    expect((counts.get(9) ?? 0) / 8000).toBeLessThan(0.78);
  });

  it('균등 reach 면 1326 전체가 고르게 나온다', () => {
    const node = fakeNode({});
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 40_000; i++) seen.add(sampleCombo(node, rng));
    // 40k 추첨이면 1326 개 중 안 나올 확률은 무시할 수 있다.
    expect(seen.size).toBe(COMBO_COUNT);
  });
});
