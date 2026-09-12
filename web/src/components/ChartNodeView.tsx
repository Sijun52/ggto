/**
 * 노드 표시부 (격자 + 범례 + 상태줄 + 우측 패널). P3.md 8.1 / DESIGN 6.5.
 *
 * **뷰어와 트레이너가 이 컴포넌트 하나를 공유한다.** 트레이너 출제 화면은 `masked`
 * 로 같은 컴포넌트를 그린다 — 전략 데이터가 클라이언트에 **없기 때문에** 레이어가 없는
 * 것이지, 있는데 안 그리는 것이 아니다 (`/api/trainer/next` 응답에 strategy 가 없다).
 */

import { useMemo } from 'react';
import { HAND_CLASS_COUNT, handClassCombos, handClassKind, handClassName, HandClassKind, type HandClassIndex } from '@ggto/core';
import type { ChartNodeView as ChartNodeData } from '../api/charts';
import { ChartComboPanel } from './ChartComboPanel';
import { ReachPanel, type PositionReach } from './ReachPanel';
import { RangeGrid } from './RangeGrid';
import { buildChartCells, formatChartCellSummary, formatPct, type ChartCellModel } from '../lib/chartGrid';
import { buildCells, formatCellSummary, type CellModel } from '../lib/grid';

export type ChartViewMode = 'strategy' | 'reach';

const KIND_OF: Record<HandClassKind, CellModel['kind']> = {
  [HandClassKind.Pair]: 'pair',
  [HandClassKind.Suited]: 'suited',
  [HandClassKind.Offsuit]: 'offsuit',
};

/**
 * 마스크 셀: 169개 전부 "레인지 안, 레이어 없음". 색을 정할 데이터가 없으므로 바탕만 그린다.
 * 클래스 구성·이름은 core 에서 유도한다 (D14: 169 하드코딩 금지).
 */
export function maskedCells(): CellModel[] {
  return Array.from({ length: HAND_CLASS_COUNT }, (_unused, h) => {
    const size = handClassCombos(h).length;
    return {
      handClass: h as HandClassIndex,
      label: handClassName(h),
      kind: KIND_OF[handClassKind(h)],
      comboCount: size,
      activeCombos: size,
      weightSum: 0,
      fill: 0,
      inRange: true,
      layers: [],
    };
  });
}

export interface ChartNodeViewProps {
  node: ChartNodeData | null;
  /** true 면 전략 레이어도 콤보 패널도 없다 (트레이너 출제 화면) */
  masked: boolean;
  /** 트레이너 히어로 클래스. 강조는 격자의 `selected` 로 그린다 */
  highlightClass: HandClassIndex | null;
  viewMode: ChartViewMode;
  colors: Record<string, string>;
  resolution: '169' | '1326';
  /** reach 모드에서 격자에 그릴 가중치. null 이면 노드의 히어로 reach */
  reachWeights: Float32Array | null;
  reachPos: string | null;
  /** reach 모드 우측 패널 (P2 R1 MINOR 3): 포지션별 도달 질량·콤보 수 */
  positionReach: readonly PositionReach[];
  selectedClass: HandClassIndex | null;
  hoveredClass: HandClassIndex | null;
  onSelectClass: (h: HandClassIndex) => void;
  onHoverClass: (h: HandClassIndex | null) => void;
  /** 격자 대신 보여줄 문구 (로딩/없음) */
  placeholder?: string | null;
  /** 우측 패널을 통째로 숨긴다 (트레이너는 채점 박스를 쓴다) */
  hidePanel?: boolean;
  size?: number;
}

export function ChartNodeView(props: ChartNodeViewProps): React.JSX.Element {
  const { node, masked, viewMode, colors, reachWeights, reachPos, positionReach } = props;

  const chartCells: ChartCellModel[] | null = useMemo(() => {
    // 마스크 상태에서는 buildChartCells 를 아예 부르지 않는다 (넘길 전략 배열이 없다).
    if (masked || node === null) return null;
    return buildChartCells({ actions: node.actions, strategy: node.strategy, ev: node.ev, reach: node.reach }, colors);
  }, [masked, node, colors]);

  const reachCells = useMemo(
    () => (masked || reachWeights === null ? null : buildCells(reachWeights)),
    [masked, reachWeights],
  );

  const maskCells = useMemo(() => (masked ? maskedCells() : null), [masked]);

  const cells: CellModel[] | null = masked ? maskCells : viewMode === 'strategy' ? chartCells : reachCells;

  const hoveredText = ((): string => {
    const h = props.hoveredClass;
    if (cells === null || h === null) return 'hover: —';
    const cell = cells[h];
    if (cell === undefined) return 'hover: —';
    // 마스크 상태의 상태줄은 클래스 이름만 — 빈도를 모르니 말할 것이 없다.
    if (masked) return `hover: ${cell.label}`;
    if (viewMode === 'reach') return `hover: ${formatCellSummary(cell)}`;
    return `hover: ${formatChartCellSummary(cell as ChartCellModel, node?.actions ?? [])}`;
  })();

  const selected = masked ? props.highlightClass : props.selectedClass;

  return (
    <div className="flex flex-wrap gap-8">
      <div>
        {masked ? null : (
          <div className="mb-2 flex items-center gap-2 text-xs" data-testid="legend">
            {viewMode === 'strategy' ? (
              (node?.actions ?? []).map((a) => (
                <span key={a} className="flex items-center gap-1 text-slate-300">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: colors[a] ?? '#a855f7' }} />
                  {a}
                </span>
              ))
            ) : (
              <span className="flex items-center gap-1 text-slate-300">
                <span className="inline-block h-2 w-2 rounded-sm bg-[#22c55e]" />
                {`reach ${reachPos ?? ''}`}
              </span>
            )}
          </div>
        )}

        {cells === null ? (
          <p className="text-sm text-slate-400" data-testid="chart-grid-placeholder">
            {props.placeholder ?? 'no chart node to draw'}
          </p>
        ) : (
          <RangeGrid
            cells={cells}
            {...(props.size === undefined ? {} : { size: props.size })}
            selected={selected}
            onSelect={props.onSelectClass}
            onHover={props.onHoverClass}
          />
        )}
        <p className="mt-2 h-5 font-mono text-xs text-slate-400" data-testid="chart-hover-readout">
          {hoveredText}
        </p>
        {!masked && viewMode === 'reach' && reachWeights !== null ? (
          <p className="font-mono text-xs text-slate-500" data-testid="reach-summary">
            {`${reachPos ?? ''} reach: ${formatPct(sum(reachWeights) / 1326)} of all combos`}
          </p>
        ) : null}
      </div>

      {props.hidePanel === true ? null : (
        <div className="w-96">
          {viewMode === 'reach' ? (
            <ReachPanel positions={positionReach} />
          ) : (
            <ChartComboPanel
              node={node}
              cells={chartCells}
              selected={props.selectedClass}
              resolution={props.resolution}
              colors={colors}
            />
          )}
        </div>
      )}
    </div>
  );
}

function sum(xs: Float32Array): number {
  let acc = 0;
  for (const x of xs) acc += x;
  return acc;
}
