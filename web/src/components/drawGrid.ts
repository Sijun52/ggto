/**
 * Canvas 13x13 그리기. 컴포넌트와 분리해 둔다 (jsdom 에는 2D 컨텍스트가 없다).
 *
 * 셀은 **레이어 스택**으로 그린다 (P2.md 9): 아래에서 위로 layers 순서대로 쌓는다.
 * P1 의 단일 녹색 채움은 레이어 1개짜리 특수 경우라서 이 함수에 분기가 없다.
 */

import type { HandClassIndex } from '@ggto/core';
import { bestTextOn } from '../lib/palette';
import type { CellModel } from '../lib/grid';

const COLORS = {
  line: '#0f172a',
  base: { pair: '#3f4d63', suited: '#2a3648', offsuit: '#1e293b' },
  /** 레인지 밖(도달 확률 0) 셀은 바탕을 더 어둡게 깐다 */
  dim: '#111827',
  label: '#e2e8f0',
  labelDim: '#64748b',
  selected: '#f8fafc',
} as const;

/** 라벨을 `A7o` 로 다 쓰려면 셀이 이만큼은 돼야 한다 (아래는 랭크 두 글자만) */
export const COMPACT_LABEL_STEP = 28;

/** 모바일 셀(25px)에서도 읽히는 하한. 9px 미만은 안티앨리어싱에 뭉갠다 */
const MIN_LABEL_PX = 9;

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  cells: readonly CellModel[],
  size: number,
  dpr: number,
  selected: HandClassIndex | null,
  compactLabels = false,
): void {
  // 논리 좌표는 항상 CSS 픽셀. 물리 픽셀 배율은 transform 으로만 처리한다.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const step = size / 13;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${String(Math.max(MIN_LABEL_PX, Math.round(step * 0.34)))}px ui-sans-serif, system-ui, sans-serif`;
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
    let dominant = '';
    let dominantFraction = 0;
    for (const layer of cell.layers) {
      const h = step * Math.max(0, Math.min(layer.fraction, 1 - used));
      if (h <= 0) continue;
      ctx.fillStyle = layer.color;
      ctx.fillRect(x, bottom - h, step, h);
      bottom -= h;
      used += h / step;
      if (h > dominantFraction) {
        dominantFraction = h;
        dominant = layer.color;
      }
    }

    ctx.strokeStyle = COLORS.line;
    ctx.strokeRect(x + 0.5, y + 0.5, step - 1, step - 1);

    // 채움 위의 글자색은 **채운 색에서 유도**한다. 고정 `#0b1220` 은 `A`(#dc2626) 위에서
    // 3.88, `F`(#64748b) 위에서 3.93 으로 AA 에 미달했다 (P3M 5절 재측정).
    ctx.fillStyle = !cell.inRange
      ? COLORS.labelDim
      : used >= 0.6 && dominant !== ''
        ? bestTextOn(dominant)
        : COLORS.label;
    // 좁은 셀에서는 랭크 두 글자만 그린다. 수티드/오프수트는 대각선 위/아래로 정해지므로
    // 정보 손실이 없다 (범례 한 줄이 격자 아래에 있다) — P3M 3절.
    const label = compactLabels ? cell.label.slice(0, 2) : cell.label;
    ctx.fillText(label, x + step / 2, y + step / 2, step - 4);
  }

  if (selected !== null && selected >= 0 && selected < cells.length) {
    const row = Math.floor(selected / 13);
    const col = selected % 13;
    ctx.strokeStyle = COLORS.selected;
    ctx.lineWidth = 2;
    ctx.strokeRect(col * step + 1, row * step + 1, step - 2, step - 2);
  }
}
