/**
 * P3.md 3.3 채점 / 3.4 혼합 / 3.5 균형 일관성.
 *
 * 3.5 는 **실데이터 성질 게이트**다: 시드 6개의 모든 노드·모든 콤보에서 "실제로 플레이되는
 * 액션은 최선과 무차별" 이어야 한다. 이 테스트가 3.3 채점기의 1차 정확성 근거다 —
 * 채점기가 틀렸거나 차트가 틀렸으면 여기서 깨진다.
 */

import { COMBO_COUNT, type ComboIndex } from '@ggto/core';
import { describe, expect, it } from 'vitest';
import { MIX_EPS, grade, isMixed, isPlayedFreq, mixedMassOf, verdictForEvLoss } from '../src/grade.js';
import { seededRepo } from './helpers.js';

function rows(values: number[][]): Float32Array[] {
  // [액션][콤보] 배열을 1326 행으로 편다. 콤보 0 만 쓰는 단위 테스트용.
  return values.map((v) => {
    const f = new Float32Array(COMBO_COUNT);
    v.forEach((x, c) => {
      f[c] = x;
    });
    return f;
  });
}

describe('P3 3.3 EV loss 채점', () => {
  it('EV 가 같으면 저빈도 액션도 Perfect 다 (D8: 빈도 일치 채점 금지)', () => {
    const g = grade({
      actions: ['F', 'A'],
      strategy: rows([[0.63], [0.37]]),
      ev: rows([[1.0], [1.0]]),
      combo: 0 as ComboIndex,
      chosen: 'A',
      gradedBy: 'ev',
    });
    expect(g.evLossBb).toBe(0);
    expect(g.verdict).toBe('Perfect');
    expect(g.chosenFreq).toBeCloseTo(0.37, 6);
    expect(g.mixed).toBe(true);
  });

  it('최선은 빈도 0 인 액션도 후보다 (전략을 정답으로 가정하지 않는다)', () => {
    const g = grade({
      actions: ['F', 'A'],
      strategy: rows([[1], [0]]),
      ev: rows([[0], [2.5]]),
      combo: 0 as ComboIndex,
      chosen: 'F',
      gradedBy: 'ev',
    });
    expect(g.bestAction).toBe('A');
    expect(g.evLossBb).toBeCloseTo(2.5, 6);
    expect(g.verdict).toBe('Blunder');
  });

  it('등급 경계는 0.05 / 0.3 / 1.0 이고 모두 < 이다', () => {
    expect(verdictForEvLoss(0)).toBe('Perfect');
    expect(verdictForEvLoss(0.049999)).toBe('Perfect');
    expect(verdictForEvLoss(0.05)).toBe('Minor');
    expect(verdictForEvLoss(0.299999)).toBe('Minor');
    expect(verdictForEvLoss(0.3)).toBe('Mistake');
    expect(verdictForEvLoss(0.999999)).toBe('Mistake');
    expect(verdictForEvLoss(1.0)).toBe('Blunder');
  });

  it('f32 잔차로 음수가 나와도 EV loss 는 0 이상이다', () => {
    const g = grade({
      actions: ['F', 'A'],
      strategy: rows([[0.5], [0.5]]),
      // 같은 값을 f32 로 담아도 비트가 같으므로 손실은 정확히 0 이어야 한다.
      ev: rows([[0.1], [0.1]]),
      combo: 0 as ComboIndex,
      chosen: 'F',
      gradedBy: 'ev',
    });
    expect(g.evLossBb).toBe(0);
    expect(g.evLossBb).toBeGreaterThanOrEqual(0);
  });

  it('없는 액션을 고르면 GradeError 다', () => {
    expect(() =>
      grade({
        actions: ['F', 'A'],
        strategy: rows([[1], [0]]),
        ev: rows([[0], [1]]),
        combo: 0 as ComboIndex,
        chosen: 'R2.5',
        gradedBy: 'ev',
      }),
    ).toThrow(/is not one of/);
  });
});

describe('P3 3.3 빈도 채점 폴백 (has_ev = 0)', () => {
  it('빈도 ≥ 0.01 이면 InStrategy, 아니면 OffStrategy 이고 evLossBb 는 null 이다', () => {
    const base = {
      actions: ['F', 'A'],
      strategy: rows([[0.99], [0.01]]),
      ev: null,
      combo: 0 as ComboIndex,
      gradedBy: 'frequency' as const,
    };
    const inStrat = grade({ ...base, chosen: 'A' });
    expect(inStrat.verdict).toBe('InStrategy');
    expect(inStrat.evLossBb).toBeNull();
    expect(inStrat.bestEvBb).toBeNull();

    const off = grade({ ...base, strategy: rows([[1], [0.005]]), chosen: 'A' });
    expect(off.verdict).toBe('OffStrategy');
    expect(off.evLossBb).toBeNull();
  });

  it('gradedBy 가 ev 인데 EV 행이 없으면 조용히 폴백하지 않고 던진다', () => {
    expect(() =>
      grade({
        actions: ['F', 'A'],
        strategy: rows([[1], [0]]),
        ev: null,
        combo: 0 as ComboIndex,
        chosen: 'F',
        gradedBy: 'ev',
      }),
    ).toThrow(/no EV rows/);
  });
});

describe('P3 3.4 혼합 정의', () => {
  it('|{a: freq ≥ 0.01}| ≥ 2 이다 — CFR+ 잔차 0.999813 은 혼합이 아니다', () => {
    expect(isMixed(rows([[0.999813], [0.000187]]), 0 as ComboIndex)).toBe(false);
    expect(isMixed(rows([[0.99], [0.01]]), 0 as ComboIndex)).toBe(true);
    expect(isMixed(rows([[0.995], [0.005]]), 0 as ComboIndex)).toBe(false);
  });

  it('3액션 이상에서도 같은 정의다 ([0.6, 0.4, 0] 은 혼합)', () => {
    expect(isMixed(rows([[0.6], [0.4], [0]]), 0 as ComboIndex)).toBe(true);
    expect(isMixed(rows([[1], [0], [0]]), 0 as ComboIndex)).toBe(false);
  });

  it('임계는 MIX_EPS 상수 하나이고 f32 로 저장된 0.01 도 통과한다', () => {
    expect(MIX_EPS).toBe(0.01);
    // f32 왕복한 0.01 은 0.009999999776… 이다. f64 상수와 직접 비교하면 경계가 어긋난다 (D7).
    expect(Math.fround(0.01) < 0.01).toBe(true);
    expect(isPlayedFreq(Math.fround(0.01))).toBe(true);
    expect(isPlayedFreq(Math.fround(0.0099))).toBe(false);
  });

  it('mixedMass 는 도달 가중 비율이다 (도달 0 인 콤보는 세지 않는다)', () => {
    const strategy = [new Float32Array(COMBO_COUNT), new Float32Array(COMBO_COUNT)];
    const reach = new Float32Array(COMBO_COUNT);
    // 콤보 0: 혼합, 도달 1. 콤보 1: 순수, 도달 3. 콤보 2: 혼합이지만 도달 0.
    strategy[0]?.set([0.5, 1, 0.5], 0);
    strategy[1]?.set([0.5, 0, 0.5], 0);
    reach.set([1, 3, 0], 0);
    expect(mixedMassOf(strategy, reach)).toBeCloseTo(1 / 4, 6);
  });
});

describe('P3 3.5 균형 일관성 (실데이터 게이트)', () => {
  it('시드 6개의 모든 노드에서 빈도 ≥ 0.01 인 액션의 EV loss < 0.01bb', () => {
    const repo = seededRepo();
    let checked = 0;
    let worst = 0;
    let worstWhere = '';
    try {
      const sets = repo.listSets();
      expect(sets).toHaveLength(6);
      for (const set of sets) {
        expect(set.hasEv).toBe(true);
        for (const meta of repo.listNodes(set.id)) {
          const node = repo.getNode(set.id, meta.seq);
          expect(node).not.toBeNull();
          const ev = node?.ev;
          expect(ev).not.toBeNull();
          if (node === null || ev === null || ev === undefined) continue;
          for (let c = 0; c < COMBO_COUNT; c++) {
            let best = -Infinity;
            for (const row of ev) best = Math.max(best, row[c] as number);
            for (let a = 0; a < node.actions.length; a++) {
              const freq = (node.strategy[a] as Float32Array)[c] as number;
              if (!isPlayedFreq(freq)) continue;
              const loss = best - ((ev[a] as Float32Array)[c] as number);
              checked++;
              if (loss > worst) {
                worst = loss;
                worstWhere = `${set.name} seq=${JSON.stringify(meta.seq)} action=${String(node.actions[a])} combo=${String(c)}`;
              }
            }
          }
        }
      }
    } finally {
      repo.close();
    }
    // 전 콤보를 다 봤다는 것 자체가 게이트의 일부다 (0건이면 아무것도 검사하지 않은 것).
    expect(checked).toBeGreaterThan(6 * 2 * 1000);
    expect(worst, `worst at ${worstWhere}`).toBeLessThan(0.01);
  });

  it('같은 게이트를 채점기로 돌려도 전부 Perfect 다 (3.3 이 3.5 와 같은 말을 한다)', () => {
    const repo = seededRepo();
    try {
      for (const set of repo.listSets()) {
        for (const meta of repo.listNodes(set.id)) {
          const node = repo.getNode(set.id, meta.seq);
          if (node === null || node.ev === null) continue;
          for (let c = 0; c < COMBO_COUNT; c += 7) {
            for (let a = 0; a < node.actions.length; a++) {
              if (!isPlayedFreq((node.strategy[a] as Float32Array)[c] as number)) continue;
              const g = grade({
                actions: node.actions,
                strategy: node.strategy,
                ev: node.ev,
                combo: c as ComboIndex,
                chosen: node.actions[a] as string,
                gradedBy: 'ev',
              });
              expect(g.verdict).toBe('Perfect');
              expect(g.evLossBb).toBeLessThan(0.01);
            }
          }
        }
      }
    } finally {
      repo.close();
    }
  });

  it('혼합 콤보가 실제로 존재한다 (게이트가 순수해만 보고 통과하는 것이 아니다)', () => {
    const repo = seededRepo();
    try {
      let mixedCombos = 0;
      for (const set of repo.listSets()) {
        for (const meta of repo.listNodes(set.id)) {
          const node = repo.getNode(set.id, meta.seq);
          if (node === null) continue;
          for (let c = 0; c < COMBO_COUNT; c++) if (isMixed(node.strategy, c as ComboIndex)) mixedCombos++;
        }
      }
      expect(mixedCombos).toBeGreaterThan(0);
    } finally {
      repo.close();
    }
  });
});
