/**
 * P3M 5 — 격자 채움 위 라벨색 (R1 MINOR 2).
 *
 * 라벨은 셀 중앙에 찍힌다. 글자색을 **최대 레이어**에서 유도하면 6-max 임포트 차트처럼
 * 레이어가 셋 이상인 셀에서 라벨 밑 색과 다른 색을 고르게 된다. 기댓값은 구현이 아니라
 * WCAG 대비식에서 온다: "찍힌 글자색과 **중앙을 덮은 레이어 색**의 대비가 4.5 이상".
 */

import { describe, expect, it } from 'vitest';
import type { HandClassIndex } from '@ggto/core';
import { drawGrid } from '../src/components/drawGrid';
import { contrastRatio } from '../src/lib/palette';
import type { CellLayer, CellModel } from '../src/lib/grid';

interface Painted {
  label: string;
  color: string;
}

/** 한 셀만 든 격자를 그리고 그 셀에 찍힌 글자색을 돌려준다 */
function paint(layers: CellLayer[], inRange = true): Painted {
  const cell: CellModel = {
    handClass: 0 as HandClassIndex,
    label: 'AA',
    kind: 'pair',
    comboCount: 6,
    activeCombos: 6,
    weightSum: 6,
    fill: 1,
    inRange,
    layers,
  };
  const out: Painted[] = [];
  const ctx = {
    setTransform: () => undefined,
    clearRect: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    fillText: (text: string) => {
      out.push({ label: text, color: ctx.fillStyle });
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
  };
  drawGrid(ctx as unknown as CanvasRenderingContext2D, [cell], 520, 1, null);
  const first = out[0];
  if (first === undefined) throw new Error('fillText 가 불리지 않았다');
  return first;
}

/** 아래에서 위로 쌓은 레이어 중 중앙(0.5) 을 덮는 것 — 테스트가 독립적으로 다시 센다 */
function layerAtCenter(layers: CellLayer[]): CellLayer | null {
  let acc = 0;
  for (const l of layers) {
    const next = acc + l.fraction;
    if (acc <= 0.5 && 0.5 < next) return l;
    acc = next;
  }
  return null;
}

const F = '#64748b';
const C = '#38bdf8';
const A = '#dc2626';

describe('P3M 5 격자 라벨색은 라벨 밑 레이어에서 유도한다', () => {
  it('P3M 5 [F .35, C .30, A .35] — 최대는 F 지만 중앙은 C 다 (R1 MINOR 2 의 반례)', () => {
    const layers: CellLayer[] = [
      { key: 'F', color: F, fraction: 0.35 },
      { key: 'C', color: C, fraction: 0.3 },
      { key: 'A', color: A, fraction: 0.35 },
    ];
    expect(layerAtCenter(layers)?.color).toBe(C);
    const { color } = paint(layers);
    // 최대 레이어(F) 기준이면 흰 글자가 나오고 C 위에서 2.14 로 떨어진다.
    expect(contrastRatio(color, F)).toBeGreaterThan(0); // 색 문자열이 hex 임을 보장
    expect(contrastRatio(color, C)).toBeGreaterThanOrEqual(4.5);
    expect(color).not.toBe('#ffffff');
  });

  it('P3M 5 레이어가 하나면 그 색 위에서 AA 를 넘긴다', () => {
    for (const bg of [F, C, A, '#10b981', '#a855f7']) {
      const { color } = paint([{ key: 'x', color: bg, fraction: 1 }]);
      expect(contrastRatio(color, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('P3M 5 채움이 중앙에 못 닿으면 바탕 글자색(#e2e8f0) 을 쓴다', () => {
    // 아래 40% 만 채운 셀 — 라벨 중앙은 base 위다
    const { color } = paint([{ key: 'A', color: A, fraction: 0.4 }]);
    expect(color).toBe('#e2e8f0');
  });

  it('P3M 5 중앙을 덮은 레이어가 얇아도 그 색을 본다', () => {
    const layers: CellLayer[] = [
      { key: 'F', color: F, fraction: 0.48 },
      { key: 'C', color: C, fraction: 0.04 },
      { key: 'A', color: A, fraction: 0.48 },
    ];
    expect(layerAtCenter(layers)?.color).toBe(C);
    const { color } = paint(layers);
    expect(contrastRatio(color, C)).toBeGreaterThanOrEqual(4.5);
  });

  it('P3M 5 레인지 밖 셀은 흐린 라벨색을 유지한다 (정보성이 아니다)', () => {
    const { color } = paint([], false);
    expect(color).toBe('#64748b');
  });

  it('P3M 5 레이어 합이 1 을 넘어도 클램프된 실제 높이로 중앙을 판정한다', () => {
    // fraction 합 1.4 — A 는 0.3 만 그려지고 중앙(0.5) 은 여전히 C 다
    const layers: CellLayer[] = [
      { key: 'F', color: F, fraction: 0.4 },
      { key: 'C', color: C, fraction: 0.3 },
      { key: 'A', color: A, fraction: 0.7 },
    ];
    const { color } = paint(layers);
    expect(contrastRatio(color, C)).toBeGreaterThanOrEqual(4.5);
  });
});
