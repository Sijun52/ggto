/**
 * 13x13 레인지 격자. P1.md 4.3 + P2.md 9 (액션 색 누적 레이어).
 * P2 뷰어 / P3 트레이너 / P5 탐색기가 이 props 계약을 재사용한다.
 *
 * 호버 텍스트는 **그리지 않는다**: 상태줄이 같은 문자열을 항상 보여주므로 툴팁은 정보
 * 중복이고, 이웃 셀을 가리는 부작용만 남는다 (P1 R2 MINOR 5). 격자는 onHover 로
 * 인덱스만 올려보내고 문구는 페이지가 만든다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HandClassIndex } from '@ggto/core';
import { axisLabels, cellAt, type CellModel } from '../lib/grid';
import { drawGrid } from './drawGrid';

export interface RangeGridProps {
  /** 169. 인덱스 = handClass */
  cells: readonly CellModel[];
  /** CSS 픽셀 한 변 */
  size?: number;
  selected?: HandClassIndex | null;
  onSelect?: (h: HandClassIndex) => void;
  onHover?: (h: HandClassIndex | null) => void;
}

const DEFAULT_SIZE = 520;

export function RangeGrid(props: RangeGridProps): React.JSX.Element {
  const { cells, onSelect, onHover } = props;
  const size = props.size ?? DEFAULT_SIZE;
  const selected = props.selected ?? null;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dpr = useDevicePixelRatio();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return; // jsdom 등 2D 컨텍스트가 없는 환경
    drawGrid(ctx, cells, size, dpr, selected);
  }, [cells, size, dpr, selected]);

  const locate = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): HandClassIndex | null => {
      const rect = e.currentTarget.getBoundingClientRect();
      return cellAt(e.clientX - rect.left, e.clientY - rect.top, size);
    },
    [size],
  );

  const handleMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      onHover?.(locate(e));
    },
    [locate, onHover],
  );

  const handleLeave = useCallback(() => {
    onHover?.(null);
  }, [onHover]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const h = locate(e);
      if (h !== null) onSelect?.(h);
    },
    [locate, onSelect],
  );

  const selectedLabel = selected === null ? '' : (cells[selected]?.label ?? '');
  const step = size / 13;
  const labels = axisLabels();

  return (
    <div className="inline-block select-none">
      <div className="flex">
        <div style={{ width: 18 }} />
        <div className="flex" style={{ width: size }}>
          {labels.map((r, i) => (
            <div
              key={`col-${String(i)}`}
              className="text-center text-[11px] text-slate-400"
              style={{ width: step }}
            >
              {r}
            </div>
          ))}
        </div>
      </div>
      <div className="flex">
        <div className="flex flex-col" style={{ width: 18, height: size }}>
          {labels.map((r, i) => (
            <div
              key={`row-${String(i)}`}
              className="flex items-center justify-center text-[11px] text-slate-400"
              style={{ height: step }}
            >
              {r}
            </div>
          ))}
        </div>
        <div className="relative" style={{ width: size, height: size }}>
          <canvas
            ref={canvasRef}
            role="grid"
            aria-label="range grid"
            data-selected={selectedLabel}
            width={Math.round(size * dpr)}
            height={Math.round(size * dpr)}
            style={{ width: size, height: size }}
            className="block cursor-pointer rounded"
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
            onClick={handleClick}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * 브라우저 줌/모니터 이동으로 devicePixelRatio 가 바뀌면 새 배율로 다시 그린다 (R1 MINOR 5).
 * 줌 변경은 resize 이벤트를 보장하지 않으므로 현재 배율에 고정된 미디어 쿼리를 구독하고,
 * 그 쿼리가 깨지는 순간(= 배율이 바뀐 순간) 새 값으로 재구독한다.
 */
function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() =>
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(`(resolution: ${String(dpr)}dppx)`);
    const onChange = (): void => {
      setDpr(window.devicePixelRatio || 1);
    };
    mql.addEventListener('change', onChange);
    return () => {
      mql.removeEventListener('change', onChange);
    };
  }, [dpr]);

  return dpr;
}
