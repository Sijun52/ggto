/**
 * 1326 콤보 가중치 → 169 셀 표시 모델. P1.md 4.2.
 *
 * **표시 전용이다.** 여기서 나온 169 값은 어떤 계산에도 다시 들어가지 않는다 (P0.md 3.3).
 * 격자 라벨/구성은 전부 @ggto/core 에서 유도한다 — 핸드 이름 배열을 여기 적어두면
 * core 의 인덱스 규약이 바뀌었을 때 화면만 조용히 틀려진다.
 */

import {
  HAND_CLASS_COUNT,
  HandClassKind,
  handClassCombos,
  handClassKind,
  handClassName,
  toHandClassView,
  type HandClassIndex,
  type Range,
} from '@ggto/core';

export type CellKind = 'pair' | 'suited' | 'offsuit';

/**
 * 셀 안에 아래에서 위로 쌓이는 색 레이어 하나. P1 의 단일 녹색 채움도 레이어 1개로 표현한다
 * (P2.md 9: 격자는 액션별 색 누적을 그린다).
 */
export interface CellLayer {
  /** 액션 토큰('F','A','R2.5') 또는 P1 weight 모드의 'weight' */
  key: string;
  color: string;
  /** 셀 높이 대비 비율 [0,1]. 레이어 합은 1 을 넘지 않는다 */
  fraction: number;
}

export interface CellModel {
  /** = row*13 + col. P0.md 3.3 의 인덱스 그대로. 재매핑하지 않는다 */
  handClass: HandClassIndex;
  label: string;
  kind: CellKind;
  /** 클래스 크기: 페어 6, 수티드 4, 오프수트 12 */
  comboCount: number;
  /** weight > 0 인 콤보 수 */
  activeCombos: number;
  weightSum: number;
  /** weightSum / comboCount ∈ [0,1]. P1 의 유일한 시각 매핑 */
  fill: number;
  /** 레인지 밖(분모 0)이면 false — 셀을 흐리게 두고 레이어를 그리지 않는다 (P2.md 3.5) */
  inRange: boolean;
  /** 아래에서 위로 쌓는 색 레이어. P1 weight 모드는 녹색 하나 */
  layers: readonly CellLayer[];
}

/** P1 weight 모드의 채움 색. drawGrid 가 아니라 모델이 색을 정한다 (P2 의 액션 색과 같은 규칙). */
export const WEIGHT_COLOR = '#22c55e';

const KIND_OF: Record<HandClassKind, CellKind> = {
  [HandClassKind.Pair]: 'pair',
  [HandClassKind.Suited]: 'suited',
  [HandClassKind.Offsuit]: 'offsuit',
};

/** 클래스 크기는 core 의 콤보 테이블에서 한 번만 읽어 고정한다. */
const CLASS_SIZE: number[] = Array.from({ length: HAND_CLASS_COUNT }, (_, h) => handClassCombos(h).length);

export function buildCells(weights: Range): CellModel[] {
  const view = toHandClassView(weights);
  const cells: CellModel[] = new Array<CellModel>(HAND_CLASS_COUNT);
  for (let h = 0; h < HAND_CLASS_COUNT; h++) {
    const size = CLASS_SIZE[h] ?? 0;
    const weightSum = view.weight[h] ?? 0;
    const fill = size === 0 ? 0 : Math.min(1, weightSum / size);
    cells[h] = {
      handClass: h,
      label: handClassName(h),
      kind: KIND_OF[handClassKind(h)],
      comboCount: size,
      activeCombos: view.count[h] ?? 0,
      weightSum,
      fill,
      inRange: weightSum > 0,
      layers: fill > 0 ? [{ key: 'weight', color: WEIGHT_COLOR, fraction: fill }] : [],
    };
  }
  return cells;
}

/**
 * 툴팁 / 상태줄 공통 표기: `AKs · 4.00 / 4`.
 *
 * 분모는 **항상 클래스 크기(comboCount)** 다. 셀의 유일한 시각 매핑이 fill = weightSum/comboCount
 * 이므로 분모가 다르면(예: activeCombos) 그림과 숫자가 서로 다른 말을 한다 (P1.md 4.1).
 */
export function formatCellSummary(cell: CellModel): string {
  return `${cell.label} · ${cell.weightSum.toFixed(2)} / ${String(cell.comboCount)}`;
}

/** 캔버스 좌표(CSS 픽셀) → 셀 인덱스. 격자 밖이면 null. */
export function cellAt(x: number, y: number, size: number): HandClassIndex | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || y < 0 || x >= size || y >= size) return null;
  const step = size / 13;
  const col = Math.floor(x / step);
  const row = Math.floor(y / step);
  // 부동소수점으로 13 이 나오는 경계를 막는다 (x < size 를 이미 통과했으므로 clamp 가 맞다).
  if (col > 12 || row > 12) return null;
  return row * 13 + col;
}

/** 격자 축 라벨(A..2). 대각선 페어 클래스 이름의 첫 글자에서 유도한다 (하드코딩 금지). */
export function axisLabels(): string[] {
  return Array.from({ length: 13 }, (_, i) => handClassName(i * 13 + i).charAt(0));
}
