import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COMBO_COUNT, type HandClassIndex } from '@ggto/core';
import { useParseRange } from '../api/queries';
import type { ParsedRange } from '../api/client';
import { ComboPanel } from '../components/ComboPanel';
import { RangeGrid } from '../components/RangeGrid';
import { RangeInput } from '../components/RangeInput';
import { buildCells, formatCellSummary } from '../lib/grid';
import { gridMaxFor, gridSizeFor, useContainerWidth, useHoverCapable, useMediaQuery } from '../lib/layout';
import { rangeTextFromUrl } from '../lib/defaults';
import { PAGE, TEXT_BODY, TEXT_DIM, TEXT_ERROR, TEXT_STRONG } from '../lib/palette';
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

  const [gridRef, containerWidth] = useContainerWidth<HTMLDivElement>();
  const isXl = useMediaQuery('(min-width: 1280px)', true);
  const isMd = useMediaQuery('(min-width: 768px)', true);
  const hoverCapable = useHoverCapable();
  const size =
    containerWidth === null
      ? undefined
      : gridSizeFor(containerWidth, gridMaxFor(isXl ? 1280 : isMd ? 768 : 375));

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
  // 터치에는 호버가 없다 — 상태줄은 그때 **선택 셀**을 말한다 (P3M 4절).
  const readoutClass = hoverCapable ? (hoveredClass ?? selectedClass) : selectedClass;
  const readoutCell = cells === null || readoutClass === null ? null : (cells[readoutClass] ?? null);

  const submit = (text: string): void => {
    mutate(text);
  };

  const error = mutation.error;

  return (
    <div className={`flex min-h-screen flex-col p-4 md:p-6 ${PAGE}`}>
      <h1 className={`mb-3 text-base font-semibold md:text-xl ${TEXT_STRONG}`}>GGTO — Range</h1>

      <RangeInput pending={mutation.isPending} onSubmit={submit} />

      {error === null ? null : (
        <p className={`mt-2 text-sm ${TEXT_ERROR}`} data-testid="range-error">
          {`${error.code}: ${error.message}`}
        </p>
      )}

      <p className={`mt-3 min-w-0 font-mono text-sm break-all ${TEXT_BODY}`} data-testid="range-summary">
        {parsed === null
          ? 'canonical: —   combos: —   weight: —'
          : `canonical: ${parsed.text}   combos: ${String(parsed.comboCount)} / ${String(COMBO_COUNT)}   weight: ${formatWeight(parsed.totalWeight)}`}
      </p>

      <div ref={gridRef} className="mt-4 flex min-w-0 flex-col gap-4">
        {cells === null ? (
          // 첫 파싱이 실패하면 보여줄 격자가 없다. 영원한 "loading…" 대신 이유를 남긴다
          // (에러 문구는 입력 상자 아래에 이미 떠 있다).
          <p className={`text-sm ${TEXT_DIM}`} data-testid="grid-placeholder">
            {error === null ? 'loading…' : 'no range to draw'}
          </p>
        ) : (
          <div className="min-w-0">
            <RangeGrid
              cells={cells}
              {...(size === undefined ? {} : { size })}
              selected={selectedClass}
              onSelect={(h: HandClassIndex) => {
                setSelectedClass(h);
              }}
              {...(hoverCapable ? { onHover: setHoveredClass } : {})}
            />
            {/* 상태줄. 셀을 벗어나도 자리를 차지해 레이아웃이 흔들리지 않게 한다. */}
            <p className={`mt-2 min-h-5 font-mono text-sm ${TEXT_BODY}`} data-testid="hover-readout">
              {readoutCell === null ? '선택: —' : `선택: ${formatCellSummary(readoutCell)}`}
            </p>
          </div>
        )}
        <div className="min-w-0">
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
