/**
 * 프리플랍 차트 뷰어. P2.md 9.
 *
 * 격자·범례·우측 패널은 `ChartNodeView` 가 그린다 (P3.md 8.1) — 트레이너 해설 화면과
 * **같은 컴포넌트**다. 이 파일에 남은 것은 셋 선택·브레드크럼·탭·"다음:" 버튼이다.
 *
 * 격자에 그려지는 169 값은 전부 서버가 준 1326 배열에서 집계한 것이다 (D14).
 */

import { useEffect, useMemo } from 'react';
import type { HandClassIndex } from '@ggto/core';
import { useChart, useChartNode, useChartRange, useChartRanges, useChartSets } from '../api/queries';
import { ChartNodeView } from '../components/ChartNodeView';
import type { PositionReach } from '../components/ReachPanel';
import { actionColors } from '../lib/chartGrid';
import { urlParam } from '../lib/defaults';
import { BTN_ACTIVE, BTN_DISABLED, BTN_NEUTRAL, PAGE, TEXT_DIM, TEXT_ERROR, TEXT_LINK, TEXT_STRONG, TEXT_WARN, TOUCH } from '../lib/palette';
import { usePageTitle } from '../lib/title';
import { useUiStore } from '../store/ui';

/** seq 를 접두들로 쪼갠다: "A-C" → ["", "A", "A-C"] (D3: 구분자는 '-') */
export function breadcrumbSeqs(seq: string): string[] {
  if (seq === '') return [''];
  const tokens = seq.split('-');
  const out = [''];
  for (let i = 0; i < tokens.length; i++) out.push(tokens.slice(0, i + 1).join('-'));
  return out;
}

export function childSeq(seq: string, action: string): string {
  return seq === '' ? action : `${seq}-${action}`;
}

function readUrl(): { set: number | null; seq: string } {
  if (typeof window === 'undefined') return { set: null, seq: '' };
  const rawSet = urlParam(window.location.search, 'set');
  const n = rawSet === null ? Number.NaN : Number(rawSet);
  return { set: Number.isInteger(n) && n > 0 ? n : null, seq: urlParam(window.location.search, 'seq') ?? '' };
}

function countPositive(xs: Float32Array): number {
  let n = 0;
  for (const x of xs) if (x > 0) n++;
  return n;
}

function sum(xs: Float32Array): number {
  let acc = 0;
  for (const x of xs) acc += x;
  return acc;
}

export function ChartsPage(): React.JSX.Element {
  const initial = useMemo(readUrl, []);
  const chartSetId = useUiStore((s) => s.chartSetId);
  const setChartSetId = useUiStore((s) => s.setChartSetId);
  const seq = useUiStore((s) => s.seq);
  const setSeq = useUiStore((s) => s.setSeq);
  const viewMode = useUiStore((s) => s.viewMode);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const selectedPos = useUiStore((s) => s.selectedPos);
  const setSelectedPos = useUiStore((s) => s.setSelectedPos);
  const selectedClass = useUiStore((s) => s.selectedClass);
  const setSelectedClass = useUiStore((s) => s.setSelectedClass);
  const hoveredClass = useUiStore((s) => s.hoveredClass);
  const setHoveredClass = useUiStore((s) => s.setHoveredClass);

  const sets = useChartSets();
  // URL 이 셋을 지정했으면 그것, 아니면 목록의 첫 번째. 사용자가 고르면 store 가 이긴다.
  const activeId = chartSetId ?? initial.set ?? sets.data?.[0]?.id ?? null;
  const chart = useChart(activeId);
  const node = useChartNode(activeId, seq);

  usePageTitle(chart.data === undefined ? 'GGTO — Charts' : `GGTO — Charts · ${chart.data.name}`);

  useEffect(() => {
    if (initial.seq !== '') setSeq(initial.seq);
  }, [initial.seq, setSeq]);

  // URL 동기화: 라우터 없이 주소만 맞춘다 (뒤로가기 히스토리를 더럽히지 않게 replaceState).
  useEffect(() => {
    if (typeof window === 'undefined' || activeId === null) return;
    const qs = `?set=${String(activeId)}${seq === '' ? '' : `&seq=${encodeURIComponent(seq)}`}`;
    window.history.replaceState(null, '', `/charts${qs}`);
  }, [activeId, seq]);

  const nodeData = node.data ?? null;
  const positions = chart.data?.config.positions ?? [];
  const heroPos = nodeData?.heroPos ?? null;
  const tabPos = selectedPos ?? heroPos;
  const colors = useMemo(() => actionColors(nodeData?.actions ?? []), [nodeData?.actions]);

  // reach 모드에서 히어로가 아닌 포지션 탭을 보면 그 포지션의 도달 레인지를 따로 받는다.
  const otherReach = useChartRange(
    activeId,
    seq,
    viewMode === 'reach' && tabPos !== null && tabPos !== heroPos ? tabPos : null,
  );
  // 패널은 포지션 전부의 질량을 보여준다 (MINOR 3). strategy 모드에서는 받지 않는다.
  const allReach = useChartRanges(activeId, seq, positions, viewMode === 'reach' && nodeData !== null);

  const reachWeights = tabPos === heroPos ? (nodeData?.reach ?? null) : (otherReach.data ?? null);
  const positionReach: PositionReach[] = allReach.map(({ pos, weights }) => ({
    pos,
    hero: pos === heroPos,
    active: pos === tabPos,
    weightSum: weights === null ? null : sum(weights),
    combos: weights === null ? null : countPositive(weights),
  }));

  const nodeSeqs = new Set((chart.data?.nodes ?? []).map((n) => n.seq));
  const crumbs = breadcrumbSeqs(seq);

  return (
    <div className={`flex min-h-screen flex-col p-4 md:p-6 ${PAGE}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h1 className={`text-base font-semibold md:text-xl ${TEXT_STRONG}`}>Charts</h1>
        <a
          className={`flex items-center justify-center rounded px-2 text-sm ${TOUCH} ${TEXT_LINK}`}
          href="/"
          aria-label="Range 로"
        >
          ←<span className="ml-1 hidden md:inline">Range</span>
        </a>
        <a
          className={`flex items-center justify-center rounded px-2 text-sm ${TOUCH} ${TEXT_LINK}`}
          href="/trainer"
          aria-label="Trainer 로"
        >
          <span className="mr-1 hidden md:inline">Trainer</span>→
        </a>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select
          className={`min-h-11 w-full min-w-0 rounded px-2 text-sm md:w-auto ${BTN_NEUTRAL}`}
          data-testid="chart-set-select"
          value={activeId === null ? '' : String(activeId)}
          onChange={(e) => {
            setChartSetId(Number(e.target.value));
          }}
        >
          {(sets.data ?? []).map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.name}
            </option>
          ))}
        </select>
        {chart.data === undefined ? null : (
          <span className={`min-w-0 truncate font-mono text-xs ${TEXT_DIM}`} data-testid="chart-source">
            {`source: ${chart.data.source.kind} / ${chart.data.source.name}`}
            {chart.data.hasEv ? ' · EV' : ' · no EV (graded_by: frequency)'}
            {` · ${chart.data.resolution}`}
          </span>
        )}
      </div>

      {sets.data !== undefined && sets.data.length === 0 ? (
        <p className={`text-sm ${TEXT_WARN}`} data-testid="chart-empty">
          차트가 없습니다. <code className="font-mono">npm run seed</code> 로 시드 차트를 만드세요.
        </p>
      ) : null}
      {sets.error === null || sets.error === undefined ? null : (
        <p className={`text-sm ${TEXT_ERROR}`} data-testid="chart-error">{`${sets.error.code}: ${sets.error.message}`}</p>
      )}
      {node.error === null || node.error === undefined ? null : (
        <p className={`text-sm ${TEXT_ERROR}`} data-testid="node-error">{`${node.error.code}: ${node.error.message}`}</p>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm" data-testid="position-tabs">
        <span className={TEXT_DIM}>포지션:</span>
        {positions.map((p) => (
          <button
            key={p}
            type="button"
            data-testid={`pos-tab-${p}`}
            aria-pressed={p === tabPos}
            className={`rounded px-3 ${TOUCH} ${p === heroPos ? BTN_ACTIVE : BTN_NEUTRAL} ${
              p === tabPos ? 'ring-2 ring-[#38bdf8]' : ''
            }`}
            onClick={() => {
              setSelectedPos(p);
            }}
          >
            {p}
            {p === heroPos ? ' •' : ''}
          </button>
        ))}
        {/* 좁은 화면에서는 44px 줄을 하나 더 쓰는 값이 없다 — 같은 설명이 reach 패널에 있다 */}
        <span className={`hidden text-xs md:inline ${TEXT_DIM}`}>(• = 이 노드에서 행동하는 포지션)</span>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1 text-sm" data-testid="breadcrumb">
        <span className={`mr-1 ${TEXT_DIM}`}>라인:</span>
        {crumbs.map((s, i) => {
          const label = s === '' ? 'root' : (s.split('-').pop() as string);
          const exists = nodeSeqs.has(s);
          return (
            <span key={s === '' ? 'root' : s} className="flex items-center gap-1">
              {i === 0 ? null : <span className={TEXT_DIM}>›</span>}
              {exists ? (
                <button
                  type="button"
                  data-testid={`crumb-${s === '' ? 'root' : s}`}
                  className={`rounded px-2 ${TOUCH} ${s === seq ? BTN_ACTIVE : `${BTN_NEUTRAL} underline`}`}
                  onClick={() => {
                    setSeq(s);
                    setSelectedPos(null);
                  }}
                >
                  {label}
                </button>
              ) : (
                <span className={`px-2 ${TEXT_DIM}`}>{label}</span>
              )}
            </span>
          );
        })}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm" data-testid="next-actions">
        <span className={TEXT_DIM}>다음:</span>
        {(nodeData?.actions ?? []).map((a) => {
          const child = childSeq(seq, a);
          const exists = nodeSeqs.has(child);
          return (
            <button
              key={a}
              type="button"
              data-testid={`action-${a}`}
              disabled={!exists}
              title={exists ? `go to ${child}` : '이 액션 다음은 터미널이거나 차트에 없습니다'}
              className={`rounded px-3 ${TOUCH} ${exists ? BTN_ACTIVE : BTN_DISABLED}`}
              onClick={() => {
                setSeq(child);
                setSelectedPos(null);
              }}
            >
              <span
                className="mr-1 inline-block h-3 w-3 rounded-sm align-middle"
                style={{ backgroundColor: colors[a] ?? '#a855f7' }}
              />
              {a}
            </button>
          );
        })}
        {nodeData === null ? null : (
          <span className={`font-mono text-xs ${TEXT_DIM}`}>{`pot ${nodeData.potBb.toFixed(2)}bb`}</span>
        )}
        <button
          type="button"
          data-testid="mode-strategy"
          aria-pressed={viewMode === 'strategy'}
          className={`rounded px-3 ${TOUCH} ${viewMode === 'strategy' ? BTN_ACTIVE : BTN_NEUTRAL}`}
          onClick={() => {
            setViewMode('strategy');
          }}
        >
          strategy
        </button>
        <button
          type="button"
          data-testid="mode-reach"
          aria-pressed={viewMode === 'reach'}
          className={`rounded px-3 ${TOUCH} ${viewMode === 'reach' ? BTN_ACTIVE : BTN_NEUTRAL}`}
          onClick={() => {
            setViewMode('reach');
          }}
        >
          reach
        </button>
      </div>

      <ChartNodeView
        node={nodeData}
        masked={false}
        highlightClass={null}
        viewMode={viewMode}
        colors={colors}
        resolution={chart.data?.resolution ?? '1326'}
        reachWeights={reachWeights}
        reachPos={tabPos}
        positionReach={positionReach}
        selectedClass={selectedClass}
        hoveredClass={hoveredClass}
        onSelectClass={(h: HandClassIndex) => {
          setSelectedClass(h);
        }}
        onHoverClass={setHoveredClass}
        placeholder={node.isPending ? 'loading…' : 'no chart node to draw'}
      />
    </div>
  );
}
