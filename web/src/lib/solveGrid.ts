/**
 * 솔브 노드 → 격자·패널이 쓰는 표현 (P5.md 1.5).
 *
 * **169 는 브라우저가 1326 에서 집계한다** (D14). 집계 규칙은 P2 의 `chartGrid.ts` 를
 * 그대로 재사용한다 — 서버의 `aggregate`(P4 `aggregateNode`) 와 규칙이 갈라지면
 * `solveAggregate.test.ts` 가 픽스처에서 깨진다. 두 구현이 있는 것이 아니라,
 * **한 규칙을 두 곳에서 독립적으로 계산해 대조**하는 것이다.
 */

import type { SolveAggregateDto } from '@ggto/protocol';
import { HAND_CLASS_COUNT, handClassCombos } from '@ggto/core';
import type { ChartNodeView as ChartNodeData } from '../api/charts';
import type { SolveNodeView } from '../api/solve';
import { buildChartCells } from './chartGrid';

const CLASS_COMBOS: readonly (readonly number[])[] = Array.from({ length: HAND_CLASS_COUNT }, (_u, h) =>
  handClassCombos(h),
);

/** 행동 플레이어의 도달 레인지 (전략·EV 가중의 분모) */
export function actorReach(node: SolveNodeView): Float32Array {
  return node.reach[node.player === 'oop' ? 0 : 1];
}

/**
 * `ChartNodeView`(P2/P3 컴포넌트) 가 먹는 모양으로. 뷰어·트레이너·탐색기가 **같은 격자
 * 컴포넌트**를 쓴다 — 포스트플랍이라고 다른 격자를 만들면 라벨·집계 규칙이 갈라진다.
 */
export function toChartNode(node: SolveNodeView): ChartNodeData {
  return {
    seq: node.line,
    heroPos: node.player.toUpperCase(),
    potBb: node.potChips / 100,
    actions: node.actions,
    hasEv: true,
    strategy: node.strategy,
    ev: node.ev,
    reach: actorReach(node),
  };
}

/** 클래스별 도달 질량 합 (서버 `massByClass` 와 같은 정의) */
function massByClass(reach: Float32Array): number[] {
  const out = new Array<number>(HAND_CLASS_COUNT).fill(0);
  for (let h = 0; h < HAND_CLASS_COUNT; h++) {
    let acc = 0;
    for (const c of CLASS_COMBOS[h] as readonly number[]) acc += reach[c] as number;
    out[h] = acc;
  }
  return out;
}

/**
 * 브라우저 집계 (1326 → 169). 서버 `aggregate` 와 같은 값이어야 한다 — 그것이 8.1 의
 * 대조 테스트다. 레인지 밖 클래스는 서버와 같이 **0** 이다 (`null` 이 아니다).
 */
export function solveAggregate(node: SolveNodeView): SolveAggregateDto {
  const reach = actorReach(node);
  const cells = buildChartCells(
    { actions: node.actions, strategy: node.strategy, ev: node.ev, reach },
    {},
  );
  const strategy = node.actions.map((_a, i) => cells.map((cell) => cell.freq[i] as number));
  const ev = node.actions.map((_a, i) => cells.map((cell) => (cell.ev === null ? 0 : (cell.ev[i] as number))));
  return { strategy, ev, reach: [massByClass(node.reach[0]), massByClass(node.reach[1])] };
}

/**
 * 노드 전체의 액션 빈도 (도달 가중 평균). 169 집계에서 되집계한다:
 * `Σ_h mass[h]·freq[h][a] / Σ_h mass[h]` 는 `Σ_c reach[c]·strategy[a][c] / Σ_c reach[c]` 와
 * 항등이다 (클래스 분모가 약분된다) — 그래서 서버 `aggregate` 를 쓸 수 있다 (P5.md 1.5).
 */
export function actionFrequencies(aggregate: SolveAggregateDto, player: 'oop' | 'ip'): number[] {
  const mass = aggregate.reach[player === 'oop' ? 0 : 1] as number[];
  let den = 0;
  for (const m of mass) den += m;
  if (den <= 0) return aggregate.strategy.map(() => 0);
  return aggregate.strategy.map((row) => {
    let acc = 0;
    for (let h = 0; h < row.length; h++) acc += (mass[h] as number) * (row[h] as number);
    return acc / den;
  });
}

/**
 * 격자에 그릴 **도달 레인지** (상대 쪽 레이어).
 *
 * 데몬이 주는 도달 가중치는 카드 제거까지 반영된 **정규화 가중치**라 절댓값이 작다
 * (실측: 26 콤보 합 0.29). 프리플랍 차트의 0..1 가중치를 전제한 격자에 그대로 넣으면
 * 모든 셀이 거의 빈 칸으로 보인다 — 사실이 아니라 **단위가 다른 것**이다. 그래서 최댓값을
 * 1 로 맞춘 상대값으로 그린다: "가장 흔한 콤보 대비 얼마나 남아 있는가".
 * 절대 수치(콤보 수)는 어그리게이트 패널이 따로 말한다.
 */
export function displayReach(reach: Float32Array): Float32Array {
  let max = 0;
  for (const x of reach) if (x > max) max = x;
  if (max <= 0 || max === 1) return reach;
  const out = new Float32Array(reach.length);
  for (let c = 0; c < reach.length; c++) out[c] = (reach[c] as number) / max;
  return out;
}

/** weight > 0 인 콤보 수 (도달 레인지의 크기) */
export function reachCombos(reach: Float32Array): number {
  let n = 0;
  for (const x of reach) if (x > 0) n++;
  return n;
}

/** 1326 값의 도달 가중 평균. 도달 질량이 0 이면 `null` (0 으로 꾸미지 않는다) */
export function weightedMean(values: Float32Array, weights: Float32Array): number | null {
  let num = 0;
  let den = 0;
  for (let c = 0; c < weights.length; c++) {
    const w = weights[c] as number;
    if (w <= 0) continue;
    den += w;
    num += w * (values[c] as number);
  }
  return den > 0 ? num / den : null;
}
