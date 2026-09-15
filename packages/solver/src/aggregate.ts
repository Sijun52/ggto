/**
 * 1326 → 169 집계 (P4.md 5.4, P2.md 3.5 규칙).
 *
 * **표시 전용이다** (D4). 여기서 나온 169 값은 어떤 계산에도 다시 들어가지 않는다.
 * 집계는 도달 가중 평균이다 — 단순 평균은 콤보 가중치를 무시해서 틀린다:
 *   `freq(h, a) = Σ_{c∈h} reach[c]·strategy[a][c] / Σ_{c∈h} reach[c]`
 * 분모가 0 인 클래스(전부 차단·레인지 밖)는 0 이다 (`inRange = false` 로 그려진다).
 */

import { HAND_CLASS_COUNT, handClassCombos } from '@ggto/core';

const CLASS_COMBOS: readonly (readonly number[])[] = Array.from({ length: HAND_CLASS_COUNT }, (_u, h) =>
  handClassCombos(h),
);

export interface NodeAggregate {
  /** [actions][169] */
  strategy: number[][];
  /** [actions][169] */
  ev: number[][];
  /** [2][169] — 플레이어별 도달 질량 합 */
  reach: number[][];
}

function weightedByClass(values: Float32Array, reach: Float32Array): number[] {
  const out = new Array<number>(HAND_CLASS_COUNT).fill(0);
  for (let h = 0; h < HAND_CLASS_COUNT; h++) {
    const combos = CLASS_COMBOS[h] as readonly number[];
    let den = 0;
    let acc = 0;
    for (const c of combos) {
      const w = reach[c] as number;
      if (w <= 0) continue;
      den += w;
      acc += w * (values[c] as number);
    }
    out[h] = den > 0 ? acc / den : 0;
  }
  return out;
}

function massByClass(reach: Float32Array): number[] {
  const out = new Array<number>(HAND_CLASS_COUNT).fill(0);
  for (let h = 0; h < HAND_CLASS_COUNT; h++) {
    let acc = 0;
    for (const c of CLASS_COMBOS[h] as readonly number[]) acc += reach[c] as number;
    out[h] = acc;
  }
  return out;
}

export function aggregateNode(input: {
  /** 행동하는 플레이어의 [actions][1326] */
  strategy: readonly Float32Array[];
  ev: readonly Float32Array[];
  /** [oop, ip] 1326 */
  reach: readonly [Float32Array, Float32Array];
  /** 행동하는 플레이어 (가중치의 출처) */
  player: 'oop' | 'ip';
}): NodeAggregate {
  const actorReach = input.reach[input.player === 'oop' ? 0 : 1];
  return {
    strategy: input.strategy.map((row) => weightedByClass(row, actorReach)),
    ev: input.ev.map((row) => weightedByClass(row, actorReach)),
    reach: [massByClass(input.reach[0]), massByClass(input.reach[1])],
  };
}
