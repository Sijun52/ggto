// @vitest-environment node
// (순수 함수 테스트. DOM 이 필요 없다)
import { COMBO_COUNT, handClassCombos, parseHandClass, parseRange } from '@ggto/core';
import { describe, expect, it } from 'vitest';
import { axisLabels, buildCells, cellAt, formatCellSummary, type CellModel } from '../src/lib/grid';

const REFERENCE = '22+,A2s+,KTo+';

/** toHandClassView 를 믿지 않고 1326 가중치에서 직접 다시 계산한다. */
function fillByHand(weights: Float32Array, name: string): number {
  const combos = handClassCombos(parseHandClass(name));
  let sum = 0;
  for (const i of combos) sum += weights[i] as number;
  return sum / combos.length;
}

function activeByHand(weights: Float32Array, name: string): number {
  return handClassCombos(parseHandClass(name)).filter((i) => (weights[i] as number) > 0).length;
}

describe('4.5 lib/grid buildCells', () => {
  const weights = parseRange(REFERENCE);
  const cells = buildCells(weights);

  it('4.5 169 셀, 인덱스 = handClass, 라벨이 P0 3.3 격자 규약과 일치', () => {
    expect(cells.length).toBe(169);
    expect(cells[0]?.label).toBe('AA');
    expect(cells[1]?.label).toBe('AKs');
    expect(cells[13]?.label).toBe('AKo');
    expect(cells[168]?.label).toBe('22');
    cells.forEach((c, i) => {
      expect(c.handClass).toBe(i);
    });
  });

  it('4.5 kind 분포 13/78/78, comboCount 합 1326 (13x6 + 78x4 + 78x12)', () => {
    const byKind = { pair: 0, suited: 0, offsuit: 0 };
    let total = 0;
    for (const c of cells) {
      byKind[c.kind]++;
      total += c.comboCount;
    }
    expect(byKind).toEqual({ pair: 13, suited: 78, offsuit: 78 });
    expect(total).toBe(COMBO_COUNT);
    expect(total).toBe(13 * 6 + 78 * 4 + 78 * 12);
    for (const c of cells) {
      expect(c.comboCount).toBe(c.kind === 'pair' ? 6 : c.kind === 'suited' ? 4 : 12);
    }
  });

  it('4.5 fill 은 weights 에서 손으로 계산한 값과 같다 (169 셀 전부)', () => {
    for (const c of cells) {
      expect(c.fill, c.label).toBeCloseTo(fillByHand(weights, c.label), 6);
      expect(c.activeCombos, c.label).toBe(activeByHand(weights, c.label));
    }
  });

  it('4.5 "22+,A2s+,KTo+" 의 fill: AA=1, AKs=1, KQo=1, AKo=0, A2o=0, 72o=0', () => {
    // AKo 는 이 레인지에 없다. "KTo+" 는 키커 런이라 KTo,KJo,KQo 세 클래스뿐이고,
    // 그래서 총 콤보가 78+48+36=162 가 된다 (P1.md 3.4 와 같은 수치).
    const fill = (name: string): number => cells[parseHandClass(name)]?.fill ?? -1;
    expect(fill('AA')).toBe(1);
    expect(fill('AKs')).toBe(1);
    expect(fill('KQo')).toBe(1);
    expect(fill('KTo')).toBe(1);
    expect(fill('AKo')).toBe(0);
    expect(fill('A2o')).toBe(0);
    expect(fill('72o')).toBe(0);
  });

  it('4.5 activeCombos 합 = 162', () => {
    expect(cells.reduce((a, c) => a + c.activeCombos, 0)).toBe(162);
    expect(cells.reduce((a, c) => a + c.weightSum, 0)).toBeCloseTo(162, 4);
  });

  it('4.5 "QQ:0.5" → QQ 셀 fill 0.5 / activeCombos 6, 나머지 168칸은 0', () => {
    const w = parseRange('QQ:0.5');
    const cs = buildCells(w);
    const qq = parseHandClass('QQ');
    expect(cs[qq]?.fill).toBe(0.5);
    expect(cs[qq]?.activeCombos).toBe(6);
    expect(cs[qq]?.weightSum).toBeCloseTo(3, 6);
    expect(cs.filter((c) => c.fill > 0).length).toBe(1);
    expect(cs.reduce((a, c) => a + c.activeCombos, 0)).toBe(6);
  });

  it('4.5 axisLabels 는 A..2 (core 의 대각선 페어 이름에서 유도)', () => {
    expect(axisLabels().join('')).toBe('AKQJT98765432');
  });
});

describe('4.5 cellAt', () => {
  const SIZE = 520; // 13 x 40px

  it('4.5 네 모서리와 중앙', () => {
    expect(cellAt(0, 0, SIZE)).toBe(0); // 좌상단 = AA
    expect(cellAt(SIZE - 1, 0, SIZE)).toBe(12); // 우상단 = A2s
    expect(cellAt(0, SIZE - 1, SIZE)).toBe(156); // 좌하단 = A2o
    expect(cellAt(SIZE - 1, SIZE - 1, SIZE)).toBe(168); // 우하단 = 22
    expect(cellAt(SIZE / 2, SIZE / 2, SIZE)).toBe(6 * 13 + 6);
  });

  it('4.5 경계: size-1 은 마지막 칸, size 이상과 음수는 null', () => {
    expect(cellAt(SIZE - 1, SIZE - 1, SIZE)).toBe(168);
    expect(cellAt(SIZE, 0, SIZE)).toBeNull();
    expect(cellAt(0, SIZE, SIZE)).toBeNull();
    expect(cellAt(-1, 0, SIZE)).toBeNull();
    expect(cellAt(0, -0.5, SIZE)).toBeNull();
    expect(cellAt(Number.NaN, 0, SIZE)).toBeNull();
  });

  it('4.5 셀 경계 픽셀은 다음 셀로 넘어간다', () => {
    const step = SIZE / 13;
    expect(cellAt(step - 0.001, 0, SIZE)).toBe(0);
    expect(cellAt(step, 0, SIZE)).toBe(1);
    expect(cellAt(0, step, SIZE)).toBe(13);
  });

  it('4.5 13으로 나누어떨어지지 않는 크기에서도 인덱스가 0..168 을 벗어나지 않는다', () => {
    for (const size of [100, 333, 521]) {
      for (let p = 0; p < size; p++) {
        const h = cellAt(p, p, size);
        expect(h).not.toBeNull();
        expect(h as number).toBeGreaterThanOrEqual(0);
        expect(h as number).toBeLessThan(169);
      }
    }
  });
});

describe('4.1 formatCellSummary (툴팁/상태줄 표기)', () => {
  it('4.1 분모는 클래스 크기다 — 페어 6, 수티드 4, 오프수트 12', () => {
    const cells = buildCells(parseRange(REFERENCE));
    expect(formatCellSummary(cells[parseHandClass('AA')] as CellModel)).toBe('AA · 6.00 / 6');
    expect(formatCellSummary(cells[parseHandClass('A2s')] as CellModel)).toBe('A2s · 4.00 / 4');
    expect(formatCellSummary(cells[parseHandClass('KTo')] as CellModel)).toBe('KTo · 12.00 / 12');
    // 이 레인지에 없는 클래스도 분모는 클래스 크기 그대로 (0/0 이 아니다)
    expect(formatCellSummary(cells[parseHandClass('AKo')] as CellModel)).toBe('AKo · 0.00 / 12');
    expect(formatCellSummary(cells[parseHandClass('72o')] as CellModel)).toBe('72o · 0.00 / 12');
  });

  it('4.1 콤보 하나만 든 클래스도 분모가 6 이다 (R1 MAJOR 2 반례)', () => {
    const cells = buildCells(parseRange('QsQh:0.5'));
    const qq = cells[parseHandClass('QQ')] as CellModel;
    expect(formatCellSummary(qq)).toBe('QQ · 0.50 / 6');
    // 셀 채움과 같은 분모여야 한다: fill = 0.5/6
    expect(qq.fill).toBeCloseTo(0.5 / 6, 12);
    expect(qq.activeCombos).toBe(1);
  });
});
