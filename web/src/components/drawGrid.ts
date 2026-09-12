/**
 * Canvas 13x13 그리기. 컴포넌트와 분리해 둔다 (jsdom 에는 2D 컨텍스트가 없다).
 *
 * 셀은 **레이어 스택**으로 그린다 (P2.md 9): 아래에서 위로 layers 순서대로 쌓는다.
 * P1 의 단일 녹색 채움은 레이어 1개짜리 특수 경우라서 이 함수에 분기가 없다.
 */

import type { HandClassIndex } from '@ggto/core';
import type { CellModel } from '../lib/grid';

const COLORS = {
  line: '#0f172a',
  base: { pair: '#3f4d63', suited: '#2a3648', offsuit: '#1e293b' },
  /** 레인지 밖(도달 확률 0) 셀은 바탕을 더 어둡게 깐다 */
  dim: '#111827',
  label: '#e2e8f0',
  labelOnFill: '#0b1220',
  labelDim: '#64748b',
  selected: '#f8fafc',
} as const;

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  cells: readonly CellModel[],
  size: number,
  dpr: number,
  selected: HandClassIndex | null,
): void {
  // 논리 좌표는 항상 CSS 픽셀. 물리 픽셀 배율은 transform 으로만 처리한다.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const step = size / 13;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${String(Math.max(8, Math.round(step * 0.34)))}px ui-sans-serif, system-ui, sans-serif`;
  ctx.lineWidth = 1;

  for (const cell of cells) {
    const row = Math.floor(cell.handClass / 13);
    const col = cell.handClass % 13;
    const x = col * step;
    const y = row * step;

    ctx.fillStyle = cell.inRange ? COLORS.base[cell.kind] : COLORS.dim;
    ctx.fillRect(x, y, step, step);

    // 아래에서 위로 누적. 마지막 레이어가 잘리더라도 셀 밖으로 넘치지 않게 클램프한다.
    let bottom = y + step;
    let used = 0;
    for (const layer of cell.layers) {
      const h = step * Math.max(0, Math.min(layer.fraction, 1 - used));
      if (h <= 0) continue;
      ctx.fillStyle = layer.color;
      ctx.fillRect(x, bottom - h, step, h);
      bottom -= h;
      used += h / step;
    }

    ctx.strokeStyle = COLORS.line;
    ctx.strokeRect(x + 0.5, y + 0.5, step - 1, step - 1);

    ctx.fillStyle = !cell.inRange ? COLORS.labelDim : used >= 0.6 ? COLORS.labelOnFill : COLORS.label;
    ctx.fillText(cell.label, x + step / 2, y + step / 2, step - 4);
  }

  if (selected !== null && selected >= 0 && selected < cells.length) {
    const row = Math.floor(selected / 13);
    const col = selected % 13;
    ctx.strokeStyle = COLORS.selected;
    ctx.lineWidth = 2;
    ctx.strokeRect(col * step + 1, row * step + 1, step - 2, step - 2);
  }
}
