/**
 * 채점 (P3.md 3.3 / D8). **EV loss 로 채점한다. 빈도 일치 채점은 금지다.**
 *
 * GTO 가 60/40 으로 섞는 스팟에서 40% 쪽을 골라도 EV 손실이 0 이면 그것은 정답이다.
 * 빈도로 채점하면 "자주 하는 쪽"을 외우게 되고, 그것은 균형이 아니다.
 *
 * EV 없는 외부 차트만 `frequency` 로 폴백하며, 그 경우 verdict 문자열 자체가 달라
 * (InStrategy/OffStrategy) 리포트에서 EV 통계와 섞이지 않는다.
 */

import type { ComboIndex } from '@ggto/core';
import type { Grade, GradeActionRow, GradedBy, Verdict } from './types.js';

/** 혼합 판정 임계. CFR+ 평균 전략의 잔차(순수해가 0.999813 로 찍힌다)를 혼합으로 보지 않기 위한 값 (P3.md 3.4). */
export const MIX_EPS = 0.01;
/**
 * 비교는 **f32 로 반올림한 임계**로 한다. 전략값은 f32 로 저장되므로 (D7) 파일에 0.01 로
 * 적힌 빈도가 메모리에서는 0.009999999776… 이 되고, f64 상수 0.01 과 비교하면 "빈도 ≥ 0.01"
 * 이라고 적힌 액션이 임계 미만으로 떨어진다. 임계를 데이터와 같은 정밀도로 표현해야
 * 경계가 스펙대로 동작한다.
 */
const MIX_EPS_F32 = Math.fround(MIX_EPS);

/** 빈도가 "실제로 플레이되는" 쪽인가 (P3.md 3.4 의 유일한 판정). */
export function isPlayedFreq(freq: number): boolean {
  return freq >= MIX_EPS_F32;
}

/** P3.md 3.3. 임계 0.05 는 D7(f32 ULP)과 MC 노이즈(~1e-3bb) 위에 있다. */
export const PERFECT_MAX_BB = 0.05;
export const MINOR_MAX_BB = 0.3;
export const MISTAKE_MAX_BB = 1.0;

export function verdictForEvLoss(evLossBb: number): Verdict {
  if (evLossBb < PERFECT_MAX_BB) return 'Perfect';
  if (evLossBb < MINOR_MAX_BB) return 'Minor';
  if (evLossBb < MISTAKE_MAX_BB) return 'Mistake';
  return 'Blunder';
}

export interface GradeInput {
  actions: readonly string[];
  /** [a] → 1326 */
  strategy: readonly Float32Array[];
  /** [a] → 1326. null 이면 frequency 폴백 */
  ev: readonly Float32Array[] | null;
  combo: ComboIndex;
  chosen: string;
  /** 차트셋 단위 값 (P2 3.3 이 "노드 단위 전부 아니면 전무" 를 보장한다) */
  gradedBy: GradedBy;
}

export class GradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GradeError';
  }
}

/** 콤보 c 에서 빈도 ≥ MIX_EPS 인 액션이 2개 이상인가 (P3.md 3.4). */
export function isMixed(strategy: readonly Float32Array[], combo: ComboIndex): boolean {
  let n = 0;
  for (const row of strategy) {
    if (isPlayedFreq(row[combo] as number)) {
      n++;
      if (n >= 2) return true;
    }
  }
  return false;
}

/**
 * 노드의 혼합 질량: 도달 레인지 가중으로 본 혼합 콤보 비율 (P3.md 3.4 / 5.2 난이도 가중치).
 * 도달 질량이 0 이면 정의되지 않으므로 0 을 준다 (그 노드는 어차피 P(node) = 0 이다).
 */
export function mixedMassOf(strategy: readonly Float32Array[], reach: Float32Array): number {
  let num = 0;
  let den = 0;
  for (let c = 0; c < reach.length; c++) {
    const w = reach[c] as number;
    if (w <= 0) continue;
    den += w;
    if (isMixed(strategy, c)) num += w;
  }
  return den > 0 ? num / den : 0;
}

export function grade(input: GradeInput): Grade {
  const { actions, strategy, ev, combo, chosen, gradedBy } = input;
  const chosenIdx = actions.indexOf(chosen);
  if (chosenIdx < 0) {
    throw new GradeError(`action ${JSON.stringify(chosen)} is not one of [${actions.join(', ')}]`);
  }
  if (strategy.length !== actions.length) {
    throw new GradeError(`strategy has ${String(strategy.length)} rows but the node has ${String(actions.length)} actions`);
  }
  if (gradedBy === 'ev' && ev === null) {
    throw new GradeError('gradedBy is "ev" but the node has no EV rows');
  }
  if (ev !== null && ev.length !== actions.length) {
    throw new GradeError(`ev has ${String(ev.length)} rows but the node has ${String(actions.length)} actions`);
  }

  const rows: GradeActionRow[] = actions.map((action, a) => ({
    action,
    freq: (strategy[a] as Float32Array)[combo] as number,
    evBb: ev === null ? null : ((ev[a] as Float32Array)[combo] as number),
  }));
  const mixed = isMixed(strategy, combo);
  const chosenFreq = (rows[chosenIdx] as GradeActionRow).freq;

  if (gradedBy === 'frequency' || ev === null) {
    // 최선 = argmax 빈도. 동률이면 먼저 나온 액션 (결정적이어야 한다).
    let best = 0;
    for (let a = 1; a < rows.length; a++) {
      if ((rows[a] as GradeActionRow).freq > (rows[best] as GradeActionRow).freq) best = a;
    }
    return {
      gradedBy: 'frequency',
      verdict: isPlayedFreq(chosenFreq) ? 'InStrategy' : 'OffStrategy',
      evLossBb: null,
      chosenAction: chosen,
      chosenFreq,
      bestAction: (rows[best] as GradeActionRow).action,
      bestEvBb: null,
      mixed,
      actions: rows,
    };
  }

  // 최선은 **빈도 0 인 액션도 후보**다: 균형 전략이 0% 를 주는 액션이라도 그 콤보에서
  // EV 가 더 높으면 손실의 기준점은 그쪽이다 (실제 균형에서는 일어나지 않지만,
  // 채점기가 전략을 정답으로 가정하면 D8 을 어기는 것이다).
  const evAt = (a: number): number => (ev[a] as Float32Array)[combo] as number;
  let best = 0;
  for (let a = 1; a < rows.length; a++) {
    if (evAt(a) > evAt(best)) best = a;
  }
  const bestEv = evAt(best);
  const chosenEv = evAt(chosenIdx);
  // f32 잔차로 −1e-7 이 나올 수 있다. 음수 손실은 없다.
  const evLossBb = Math.max(0, bestEv - chosenEv);

  return {
    gradedBy: 'ev',
    verdict: verdictForEvLoss(evLossBb),
    evLossBb,
    chosenAction: chosen,
    chosenFreq,
    bestAction: (rows[best] as GradeActionRow).action,
    bestEvBb: bestEv,
    mixed,
    actions: rows,
  };
}
