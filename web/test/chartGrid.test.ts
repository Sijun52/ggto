// @vitest-environment node
// (순수 함수 테스트. DOM 이 필요 없다)
import { comboCount, handClassCombos, parseHandClass, parseRange } from '@ggto/core';
import { describe, expect, it } from 'vitest';
import { actionColors, buildChartCells, formatChartCellSummary, formatEv, formatPct } from '../src/lib/chartGrid';

/**
 * 테스트 입력은 전부 core 에서 만든다 (손으로 쓴 1326 배열 금지).
 * 전략은 "레인지 A 에 속하면 잼" 같은 규칙으로 만들고, 169 기댓값은 아래에서 손으로 재계산한다.
 */
function strategyFromRanges(jamText: string): [Float32Array, Float32Array] {
  const jam = parseRange(jamText);
  const fold = new Float32Array(1326);
  const jamRow = new Float32Array(1326);
  for (let c = 0; c < 1326; c++) {
    const p = jam[c] ?? 0;
    jamRow[c] = p;
    fold[c] = 1 - p;
  }
  return [fold, jamRow];
}

describe('3.5 169 집계 (reach 가중 평균)', () => {
  it('3.5 셀 빈도는 1326 에서 손으로 재계산한 값과 같다 (단순 평균이 아니다)', () => {
    // reach: AKo 12콤보 중 3개만 살아 있고 가중치도 제각각 → 단순 평균이면 틀린다
    const reach = parseRange('AsKh:1,AhKs:0.5,AdKc:0.25,AA');
    const [fold, jam] = strategyFromRanges('AsKh,AdKc,AA'); // AKo 중 두 콤보만 잼
    const cells = buildChartCells(
      { actions: ['F', 'A'], strategy: [fold, jam], ev: null, reach },
      actionColors(['F', 'A']),
    );
    const ako = cells[parseHandClass('AKo')];

    // 손 계산: 분모 = 1 + 0.5 + 0.25 = 1.75, 잼 분자 = 1·1 + 0.5·0 + 0.25·1 = 1.25
    expect(ako?.weightSum).toBeCloseTo(1.75, 6);
    expect(ako?.freq[1]).toBeCloseTo(1.25 / 1.75, 6);
    expect(ako?.freq[0]).toBeCloseTo(0.5 / 1.75, 6);
    // 단순 평균(콤보별 균등)이었다면 2/3 가 됐을 것이다 — 다른 값임을 못 박는다
    expect(ako?.freq[1]).not.toBeCloseTo(2 / 3, 3);
    expect(ako?.activeCombos).toBe(3);
    expect(ako?.comboCount).toBe(12);
  });

  it('3.5 분모가 0 인 클래스는 inRange=false 이고 레이어가 없다', () => {
    const reach = parseRange('AA');
    const [fold, jam] = strategyFromRanges('AA');
    const cells = buildChartCells(
      { actions: ['F', 'A'], strategy: [fold, jam], ev: null, reach },
      actionColors(['F', 'A']),
    );
    expect(cells[parseHandClass('AA')]?.inRange).toBe(true);
    const outside = cells[parseHandClass('72o')];
    expect(outside?.inRange).toBe(false);
    expect(outside?.layers).toEqual([]);
    expect(outside?.freq).toEqual([0, 0]);
    // 레인지 밖 클래스 개수 = 169 - 1
    expect(cells.filter((c) => !c.inRange).length).toBe(168);
  });

  it('3.5 레이어 fraction 합은 1 을 넘지 않는다 (169 셀 전부)', () => {
    const reach = parseRange('22+,A2s+,KTo+');
    const [fold, jam] = strategyFromRanges('22+,ATs+');
    const cells = buildChartCells(
      { actions: ['F', 'A'], strategy: [fold, jam], ev: null, reach },
      actionColors(['F', 'A']),
    );
    for (const cell of cells) {
      const total = cell.layers.reduce((acc, l) => acc + l.fraction, 0);
      expect(total).toBeLessThanOrEqual(1 + 1e-6);
      if (cell.inRange) expect(total).toBeCloseTo(1, 6);
    }
    // in-range 클래스 수는 core 의 레인지와 일치한다
    const inRange = cells.filter((c) => c.inRange).length;
    const expected = new Set(
      [...parseRange('22+,A2s+,KTo+').entries()].filter(([, w]) => w > 0).map(([c]) => c),
    );
    expect(comboCount(parseRange('22+,A2s+,KTo+'))).toBe(expected.size);
    expect(inRange).toBe(13 + 12 + 3); // 페어 13 + A2s~AKs 12 + KTo/KJo/KQo 3
  });

  it('3.5 EV 는 reach 가중 평균이다', () => {
    const reach = parseRange('AsKh:1,AhKs:0.5');
    const [fold, jam] = strategyFromRanges('AsKh,AhKs');
    const evJam = new Float32Array(1326);
    const evFold = new Float32Array(1326);
    const combos = handClassCombos(parseHandClass('AKo'));
    // 콤보마다 다른 EV 를 준다 (169 해상도라면 같겠지만 1326 차트는 갈릴 수 있다)
    for (const c of combos) evJam[c] = c % 2 === 0 ? 2 : 4;
    const cells = buildChartCells(
      { actions: ['F', 'A'], strategy: [fold, jam], ev: [evFold, evJam], reach },
      actionColors(['F', 'A']),
    );
    const ako = cells[parseHandClass('AKo')];
    const [c1, c2] = [...combos].filter((c) => (reach[c] ?? 0) > 0);
    const expected =
      ((reach[c1 as number] as number) * (evJam[c1 as number] as number) +
        (reach[c2 as number] as number) * (evJam[c2 as number] as number)) /
      1.5;
    expect(ako?.ev?.[1]).toBeCloseTo(expected, 5);
    expect(ako?.ev?.[0]).toBe(0);
  });
});

describe('9 액션 색과 표기', () => {
  it('9 액션 종류별 고정 색, 사이즈는 amber → red 순서', () => {
    const colors = actionColors(['F', 'C', 'R2.5', 'R7', 'A']);
    expect(colors['F']).toBe('#64748b');
    expect(colors['C']).toBe('#10b981');
    expect(colors['A']).toBe('#dc2626');
    expect(colors['R2.5']).toBe('#f59e0b'); // 가장 작은 레이즈 = amber
    expect(colors['R7']).toBe('#ef4444'); // 가장 큰 레이즈 = red
    // 모든 액션에 색이 있다 (조용히 안 그려지는 액션이 없어야 한다)
    for (const a of ['F', 'C', 'R2.5', 'R7', 'A']) expect(colors[a]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('9 호버 문구는 툴팁과 상태줄이 같은 함수를 쓴다 (액션 빈도 + EV)', () => {
    const reach = parseRange('AA');
    const [fold, jam] = strategyFromRanges('AA');
    const evJam = new Float32Array(1326).fill(1.42);
    const evFold = new Float32Array(1326);
    const cells = buildChartCells(
      { actions: ['F', 'A'], strategy: [fold, jam], ev: [evFold, evJam], reach },
      actionColors(['F', 'A']),
    );
    expect(formatChartCellSummary(cells[parseHandClass('AA')] as (typeof cells)[number], ['F', 'A'])).toBe(
      'AA · F 0% +0.00bb · A 100% +1.42bb',
    );
    expect(formatChartCellSummary(cells[parseHandClass('72o')] as (typeof cells)[number], ['F', 'A'])).toBe(
      '72o · not in range',
    );
  });

  it('9 퍼센트/EV 표기', () => {
    expect(formatPct(1)).toBe('100%');
    expect(formatPct(0)).toBe('0%');
    expect(formatPct(0.315153)).toBe('31.5%');
    expect(formatEv(-0.5)).toBe('-0.50bb');
    expect(formatEv(1.42)).toBe('+1.42bb');
  });
});
