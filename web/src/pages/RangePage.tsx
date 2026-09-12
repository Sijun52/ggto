import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COMBO_COUNT, type HandClassIndex } from '@ggto/core';
import { useParseRange } from '../api/queries';
import type { ParsedRange } from '../api/client';
import { ComboPanel } from '../components/ComboPanel';
import { RangeGrid } from '../components/RangeGrid';
import { RangeInput } from '../components/RangeInput';
import { buildCells, formatCellSummary } from '../lib/grid';
import { rangeTextFromUrl } from '../lib/defaults';
import { usePageTitle } from '../lib/title';
import { useUiStore } from '../store/ui';


export function RangePage(): React.JSX.Element {
  usePageTitle('GGTO — Range');
  const initialText = useMemo(
    () => rangeTextFromUrl(typeof window === 'undefined' ? '' : window.location.search),
    [],
  );

  // 실패해도 이전 격자를 유지해야 하므로 마지막 성공 결과를 따로 붙잡는다
  // (mutation.data 는 다음 호출이 실패하면 사라진다).
  const [parsed, setParsed] = useState<ParsedRange | null>(null);
  const setRangeText = useUiStore((s) => s.setRangeText);
  const selectedClass = useUiStore((s) => s.selectedClass);
  const setSelectedClass = useUiStore((s) => s.setSelectedClass);
  const hoveredClass = useUiStore((s) => s.hoveredClass);
  const setHoveredClass = useUiStore((s) => s.setHoveredClass);

  // 입력 상자는 store 가 소유한다 (RangeInput 참조). 첫 페인트 전에 URL 값을 넣어야
  // 빈 입력 상자가 한 프레임 보이지 않으므로 layout effect 다. 의존성이 전부 안정값이라 1회 실행.
  useLayoutEffect(() => {
    setRangeText(initialText);
  }, [initialText, setRangeText]);

  const mutation = useParseRange(setParsed);
  const { mutate } = mutation;

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    mutate(initialText);
  }, [initialText, mutate]);

  const cells = useMemo(() => (parsed === null ? null : buildCells(parsed.weights)), [parsed]);
  const hoveredCell = cells === null || hoveredClass === null ? null : (cells[hoveredClass] ?? null);

  const submit = (text: string): void => {
    mutate(text);
  };

  const error = mutation.error;

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <h1 className="mb-4 text-xl font-semibold">GGTO — Range</h1>

      <RangeInput pending={mutation.isPending} onSubmit={submit} />

      {error === null ? null : (
        <p className="mt-2 text-sm text-red-400" data-testid="range-error">
          {`${error.code}: ${error.message}`}
        </p>
      )}

      <p className="mt-3 font-mono text-sm text-slate-300" data-testid="range-summary">
        {parsed === null
          ? 'canonical: —   combos: —   weight: —'
          : `canonical: ${parsed.text}   combos: ${String(parsed.comboCount)} / ${String(COMBO_COUNT)}   weight: ${formatWeight(parsed.totalWeight)}`}
      </p>

      <div className="mt-4 flex flex-wrap gap-8">
        {cells === null ? (
          // 첫 파싱이 실패하면 보여줄 격자가 없다. 영원한 "loading…" 대신 이유를 남긴다
          // (에러 문구는 입력 상자 아래에 이미 떠 있다).
          <p className="text-sm text-slate-400" data-testid="grid-placeholder">
            {error === null ? 'loading…' : 'no range to draw'}
          </p>
        ) : (
          <div>
            <RangeGrid
              cells={cells}
              selected={selectedClass}
              onSelect={(h: HandClassIndex) => {
                setSelectedClass(h);
              }}
              onHover={setHoveredClass}
            />
            {/* 호버 상태줄. 마우스가 격자를 벗어나도 자리를 차지해 레이아웃이 흔들리지 않게 한다. */}
            <p className="mt-2 h-5 font-mono text-xs text-slate-400" data-testid="hover-readout">
              {hoveredCell === null ? 'hover: —' : `hover: ${formatCellSummary(hoveredCell)}`}
            </p>
          </div>
        )}
        <div className="w-80">
          <ComboPanel weights={parsed === null ? null : parsed.weights} selected={selectedClass} />
        </div>
      </div>
    </div>
  );
}

/** 162 는 "162", 3 은 "3", 0.5 는 "0.5" — 정수는 소수점을 붙이지 않는다. */
function formatWeight(w: number): string {
  return Number.isInteger(w) ? String(w) : w.toFixed(2);
}
