/**
 * 노드 표시부 (격자 + 범례 + 상태줄 + 콤보 패널). P3.md 8.1 / P3M 3·4절 / DESIGN 6.5.
 *
 * **뷰어와 트레이너가 이 컴포넌트 하나를 공유한다.** 트레이너 출제 화면은 `masked`
 * 로 같은 컴포넌트를 그린다 — 전략 데이터가 클라이언트에 **없기 때문에** 레이어가 없는
 * 것이지, 있는데 안 그리는 것이 아니다 (`/api/trainer/next` 응답에 strategy 가 없다).
 *
 * 콤보 패널은 **접힘이 기본이고 격자 아래**다 (D20). 우측 열에 두면 1280×720 에서
 * 채점 박스를 화면 밖으로 밀어낸다 (P3 R1 MINOR 1).
 */

import { useMemo, useState } from 'react';
import { HAND_CLASS_COUNT, handClassCombos, handClassKind, handClassName, HandClassKind, type HandClassIndex } from '@ggto/core';
import type { ChartNodeView as ChartNodeData } from '../api/charts';
import { ChartComboPanel } from './ChartComboPanel';
import { COMPACT_LABEL_STEP } from './drawGrid';
import { ReachPanel, type PositionReach } from './ReachPanel';
import { RangeGrid } from './RangeGrid';
import { buildChartCells, formatChartCellSummary, formatPct, type ChartCellModel } from '../lib/chartGrid';
import { buildCells, formatCellSummary, type CellModel } from '../lib/grid';
import { gridMaxFor, gridSizeFor, useContainerWidth, useHoverCapable, useMediaQuery } from '../lib/layout';
import { SURFACE, TEXT_BODY, TEXT_DIM, TOUCH } from '../lib/palette';

export type ChartViewMode = 'strategy' | 'reach';

/** 콤보 패널 배치. `none` 은 보여줄 데이터가 없는 화면(트레이너 출제)이다 */
export type PanelPlacement = 'below-collapsed' | 'none';

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
  /** reach 모드 패널 (P2 R1 MINOR 3): 포지션별 도달 질량·콤보 수 */
  positionReach: readonly PositionReach[];
  selectedClass: HandClassIndex | null;
  hoveredClass: HandClassIndex | null;
  onSelectClass: (h: HandClassIndex) => void;
  onHoverClass: (h: HandClassIndex | null) => void;
  /** 격자 대신 보여줄 문구 (로딩/없음) */
  placeholder?: string | null;
  /** 콤보 패널 배치 (기본 `below-collapsed`) */
  panel?: PanelPlacement;
  /** 격자와 콤보 패널 사이에 끼울 것 (트레이너 액션표) */
  belowGrid?: React.ReactNode;
  size?: number;
}

export function ChartNodeView(props: ChartNodeViewProps): React.JSX.Element {
  const { node, masked, viewMode, colors, reachWeights, reachPos, positionReach } = props;
  const panel: PanelPlacement = props.panel ?? 'below-collapsed';

  const [gridRef, containerWidth] = useContainerWidth<HTMLDivElement>();
  const isXl = useMediaQuery('(min-width: 1280px)', true);
  const isMd = useMediaQuery('(min-width: 768px)', true);
  const hoverCapable = useHoverCapable();
  const [panelOpen, setPanelOpen] = useState(false);

  const size =
    props.size ??
    (containerWidth === null
      ? undefined
      : gridSizeFor(containerWidth, gridMaxFor(isXl ? 1280 : isMd ? 768 : 375)));
  const compactLabels = size !== undefined && size / 13 < COMPACT_LABEL_STEP;

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

  // 호버가 없는 장치(터치)에서는 **선택 셀**이 상태줄의 내용이다. 접두는 하나로 통일한다
  // — 사용자에게 "호버" 와 "선택" 은 같은 질문("이 셀이 뭐냐")의 답이다 (P3M 4절).
  const readoutClass = hoverCapable ? (props.hoveredClass ?? props.selectedClass) : props.selectedClass;
  const readoutText = ((): string => {
    if (cells === null || readoutClass === null) return '선택: —';
    const cell = cells[readoutClass];
    if (cell === undefined) return '선택: —';
    // 마스크 상태의 상태줄은 클래스 이름만 — 빈도를 모르니 말할 것이 없다.
    if (masked) return `선택: ${cell.label}`;
    if (viewMode === 'reach') return `선택: ${formatCellSummary(cell)}`;
    return `선택: ${formatChartCellSummary(cell as ChartCellModel, node?.actions ?? [])}`;
  })();

  const selected = masked ? props.highlightClass : props.selectedClass;
  const selectedCombos = props.selectedClass === null ? 0 : handClassCombos(props.selectedClass).length;

  // reach 패널은 D20(콤보 패널 접힘+아래) 의 대상이 **아니다**: 아래로 내리면 1280x720
  // 에서 top 813 으로 화면 밖이고 격자 오른쪽 700px 이 빈다 (P3M R1 MAJOR 2).
  // `< md` 에서만 격자 아래, `>= md` 에서는 격자 오른쪽 열 (P3M 6.2).
  const reachAside = panel !== 'none' && viewMode === 'reach';

  return (
    <div className={`flex min-w-0 flex-col gap-3 ${reachAside ? 'md:flex-row md:items-start md:gap-6' : ''}`}>
      <div className={`flex min-w-0 flex-col gap-3 ${reachAside ? 'md:min-w-0 md:flex-1' : ''}`}>
      <div ref={gridRef} className="min-w-0">
        {masked ? null : (
          <div className={`mb-2 flex flex-wrap items-center gap-3 text-sm md:text-xs ${TEXT_BODY}`} data-testid="legend">
            {viewMode === 'strategy' ? (
              (node?.actions ?? []).map((a) => (
                <span key={a} className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: colors[a] ?? '#a855f7' }} />
                  {a}
                </span>
              ))
            ) : (
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-sm bg-[#22c55e]" />
                {`reach ${reachPos ?? ''}`}
              </span>
            )}
          </div>
        )}

        {cells === null ? (
          <p className={`text-sm ${TEXT_DIM}`} data-testid="chart-grid-placeholder">
            {props.placeholder ?? 'no chart node to draw'}
          </p>
        ) : (
          <RangeGrid
            cells={cells}
            {...(size === undefined ? {} : { size })}
            selected={selected}
            onSelect={props.onSelectClass}
            {...(hoverCapable ? { onHover: props.onHoverClass } : {})}
          />
        )}

        {compactLabels && cells !== null ? (
          <p className={`mt-1 text-xs md:text-[11px] ${TEXT_DIM}`} data-testid="grid-compact-legend">
            셀 라벨은 랭크 두 글자 — 대각선 위 = 수티드 · 아래 = 오프수트
          </p>
        ) : null}

        <p className={`mt-2 min-h-5 font-mono text-sm ${TEXT_BODY}`} data-testid="chart-hover-readout">
          {readoutText}
        </p>
        {!masked && viewMode === 'reach' && reachWeights !== null ? (
          <p className={`font-mono text-xs ${TEXT_DIM}`} data-testid="reach-summary">
            {`${reachPos ?? ''} reach: ${formatPct(sum(reachWeights) / 1326)} of all combos`}
          </p>
        ) : null}
      </div>

      {props.belowGrid ?? null}

      {panel === 'none' || viewMode === 'reach' ? null : (
        <div className="min-w-0">
          <button
            type="button"
            data-testid="combo-toggle"
            aria-expanded={panelOpen}
            className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${SURFACE} ${TEXT_BODY} ${TOUCH}`}
            onClick={() => {
              setPanelOpen((v) => !v);
            }}
          >
            <span>
              {panelOpen ? '▾' : '▸'}
              {props.selectedClass === null ? ' 콤보 (셀을 탭하면 열립니다)' : ` 콤보 ${String(selectedCombos)}개`}
            </span>
            <span className={TEXT_DIM}>{panelOpen ? '접기' : '펼치기'}</span>
          </button>
          {panelOpen ? (
            <div className={`mt-2 rounded p-3 ${SURFACE}`}>
              <ChartComboPanel
                node={node}
                cells={chartCells}
                selected={props.selectedClass}
                resolution={props.resolution}
                colors={colors}
              />
            </div>
          ) : null}
        </div>
      )}
      </div>

      {reachAside ? (
        <div className="min-w-0 md:w-80 md:shrink-0" data-testid="reach-aside">
          <ReachPanel positions={positionReach} />
        </div>
      ) : null}
    </div>
  );
}

function sum(xs: Float32Array): number {
  let acc = 0;
  for (const x of xs) acc += x;
  return acc;
}
