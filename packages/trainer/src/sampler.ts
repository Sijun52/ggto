/**
 * 노드 추첨 가중치 (P3.md 5.2 = DESIGN 6.3 `w1×w2×w4` 의 v1 구체화).
 *
 *   w1 = mass                                  실전빈도 (랜덤 핸드가 이 노드에 도달할 확률)
 *   w2 = 1 + 0.5·mixedMass                     난이도 (혼합 질량이 큰 노드가 더 자주)
 *   w4 = 1 + min(2, meanEvLoss30d(cat)/0.3)    리크보정 (내가 못 하는 카테고리를 더 자주)
 *
 * w3(망각) 은 가중치가 아니라 **삽입**이다 (5.3): due 스팟은 확률을 조금 올리는 것이
 * 아니라 큐 앞에 끼워 넣어야 간격 반복이 성립한다.
 *
 * 상수는 고정이고 테스트는 상수의 현명함이 아니라 **비례 관계**를 검사한다.
 */

import type { Rng } from '@ggto/core';
import type { PoolNode } from './pool.js';
import type { Category } from './types.js';

/** 난이도 가중의 최대 배수 (혼합 질량 1 인 노드는 순수 노드의 1.5배). */
export const MIXED_WEIGHT = 0.5;
/** 리크보정이 1 배 늘어나는 평균 EV loss (bb). 0.3 = Minor 임계. */
export const LEAK_SCALE_BB = 0.3;
/** 리크보정 상한 (최대 3배). 한 카테고리가 큐를 독점하지 않게 한다. */
export const LEAK_CAP = 2;

export function difficultyWeight(mixedMass: number): number {
  return 1 + MIXED_WEIGHT * mixedMass;
}

export function leakWeight(meanEvLossBb: number | undefined): number {
  if (meanEvLossBb === undefined || !(meanEvLossBb > 0)) return 1;
  return 1 + Math.min(LEAK_CAP, meanEvLossBb / LEAK_SCALE_BB);
}

export function nodeWeight(node: PoolNode, leaks: ReadonlyMap<Category, number>): number {
  return node.mass * difficultyWeight(node.mixedMass) * leakWeight(leaks.get(node.category));
}

/** 가중치에 비례해 노드 하나. 전부 0 이면 (있을 수 없지만) 첫 노드로 떨어진다. */
export function pickNode(nodes: readonly PoolNode[], leaks: ReadonlyMap<Category, number>, rng: Rng): PoolNode {
  const weights = nodes.map((n) => nodeWeight(n, leaks));
  let total = 0;
  for (const w of weights) total += w;
  const first = nodes[0];
  if (first === undefined) throw new Error('pickNode called with an empty pool');
  if (!(total > 0)) return first;
  let target = rng.nextFloat() * total;
  for (let i = 0; i < nodes.length; i++) {
    target -= weights[i] as number;
    if (target < 0) return nodes[i] as PoolNode;
  }
  return nodes[nodes.length - 1] as PoolNode;
}
