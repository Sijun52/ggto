/**
 * 모바일 렌더 계약 (P3M 3·4·6.4 / 8.1). jsdom 은 레이아웃을 못 재지만 **무엇을 그리는가**
 * 는 잴 수 있다: 좁은 셀의 라벨, 호버 없는 장치의 상태줄, `< md` 의 리포트 카드.
 */

import type { ReportDto } from '@ggto/protocol';
import { parseHandClass, parseRange } from '@ggto/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartNodeView } from '../src/components/ChartNodeView';
import { RangeGrid } from '../src/components/RangeGrid';
import { ReportPanel } from '../src/components/ReportPanel';
import { buildCells } from '../src/lib/grid';

const CELLS = buildCells(parseRange('22+,A2s+,KTo+'));

interface Stub {
  labels: string[];
  fonts: string[];
}

/** drawGrid 를 모킹하지 않고 진짜로 돌린 뒤 컨텍스트에 남은 fillText 인자를 본다. */
function installStubContext(): Stub {
  const stub: Stub = { labels: [], fonts: [] };
  const ctx = {
    setTransform: () => undefined,
    clearRect: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    fillText: (text: string) => {
      stub.labels.push(text);
      stub.fonts.push(ctx.font);
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  return stub;
}

/** matchMedia 를 원하는 쿼리 집합만 참으로 돌려주도록 세운다 */
function stubMatchMedia(truthy: (query: string) => boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: truthy(query),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('P3M 3 좁은 셀의 라벨', () => {
  it('P3M 3 step 25 (size 325) 면 랭크 두 글자만 그린다', () => {
    const stub = installStubContext();
    render(<RangeGrid cells={CELLS} size={325} />);
    expect(stub.labels).toHaveLength(169);
    expect(stub.labels).toContain('A7');
    expect(stub.labels).not.toContain('A7o');
    expect(stub.labels).not.toContain('A7s');
    // 같은 두 글자가 수티드/오프수트 양쪽에서 나오므로 중복이 생긴다 (대각선으로 구분)
    expect(new Set(stub.labels).size).toBeLessThan(169);
  });

  it('P3M 3 step 40 (size 520) 이면 전체 라벨이다', () => {
    const stub = installStubContext();
    render(<RangeGrid cells={CELLS} size={520} />);
    expect(stub.labels).toContain('A7o');
    expect(stub.labels).toContain('A7s');
    expect(new Set(stub.labels).size).toBe(169);
  });

  it('P3M 5 셀 라벨 폰트는 9px 밑으로 내려가지 않는다', () => {
    const stub = installStubContext();
    render(<RangeGrid cells={CELLS} size={195} />); // 셀 15px → 0.34 x 15 = 5px 이었을 것
    const px = Number.parseFloat(stub.fonts[0] as string);
    expect(px).toBeGreaterThanOrEqual(9);
  });

  it('P3M 3 좁을 때만 수티드/오프수트 범례가 붙는다', () => {
    installStubContext();
    const { unmount } = render(<RangeGrid cells={CELLS} size={325} />);
    unmount();
    // 범례는 ChartNodeView 가 그린다 — size 를 직접 주고 확인한다
    installStubContext();
    render(
      <ChartNodeView
        node={null}
        masked
        highlightClass={parseHandClass('A7o')}
        viewMode="strategy"
        colors={{}}
        resolution="169"
        reachWeights={null}
        reachPos="SB"
        positionReach={[]}
        selectedClass={parseHandClass('A7o')}
        hoveredClass={null}
        onSelectClass={() => undefined}
        onHoverClass={() => undefined}
        panel="none"
        size={325}
      />,
    );
    expect(screen.getByTestId('grid-compact-legend').textContent).toContain('수티드');
  });
});

describe('P3M 4 상태줄은 호버가 없으면 선택을 말한다', () => {
  function renderView(): { hovered: (number | null)[] } {
    const hovered: (number | null)[] = [];
    render(
      <ChartNodeView
        node={null}
        masked
        highlightClass={parseHandClass('A7o')}
        viewMode="strategy"
        colors={{}}
        resolution="169"
        reachWeights={null}
        reachPos="SB"
        positionReach={[]}
        selectedClass={parseHandClass('A7o')}
        hoveredClass={parseHandClass('AA')}
        onSelectClass={() => undefined}
        onHoverClass={(h) => hovered.push(h)}
        panel="none"
      />,
    );
    return { hovered };
  }

  it('P3M 4 접두는 언제나 "선택:" 이다 ("hover:" 는 없어졌다)', () => {
    installStubContext();
    stubMatchMedia(() => true); // 호버 가능 장치
    renderView();
    const text = screen.getByTestId('chart-hover-readout').textContent ?? '';
    expect(text.startsWith('선택: ')).toBe(true);
    expect(text).not.toContain('hover');
    // 호버 가능하면 호버 중인 셀(AA)을 말한다
    expect(text).toBe('선택: AA');
  });

  it('P3M 4 (pointer: coarse) 면 호버를 무시하고 선택 셀을 말한다', () => {
    installStubContext();
    stubMatchMedia((q) => !q.includes('hover: hover'));
    renderView();
    expect(screen.getByTestId('chart-hover-readout').textContent).toBe('선택: A7o');
  });

  it('P3M 4 호버가 없는 장치에서는 onMouseMove 자체가 붙지 않는다', () => {
    installStubContext();
    stubMatchMedia((q) => !q.includes('hover: hover'));
    const { hovered } = renderView();
    const canvas = screen.getByRole('grid');
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 520, 520);
    fireEvent.mouseMove(canvas, { clientX: 5, clientY: 5 });
    fireEvent.mouseLeave(canvas);
    expect(hovered).toEqual([]);
  });
});

const EMPTY_VERDICTS = { Perfect: 2, Minor: 0, Mistake: 0, Blunder: 1, InStrategy: 0, OffStrategy: 0 };
const AGG = {
  attempts: 3,
  evGraded: 3,
  meanEvLossBb: 0.062,
  bb100: 6.2,
  byVerdict: EMPTY_VERDICTS,
  mixedShare: 0,
};
const REPORT: ReportDto = {
  scope: { sessionId: 1, durationMs: 1000 },
  totals: AGG,
  byCategory: [{ ...AGG, category: 'open' }],
  bySet: [{ ...AGG, contentHash: 'a'.repeat(64), name: 'HU push/fold 10bb' }],
  leaks: [],
  srs: { due: 0, leeches: 0 },
};

describe('P3M 6.4 리포트는 < md 에서 카드다', () => {
  it('P3M 6.4 좁은 화면: 카드 3장, 표 없음', () => {
    stubMatchMedia((q) => !q.includes('min-width: 768px'));
    render(<ReportPanel report={REPORT} title="세션 리포트" />);
    expect(screen.getByTestId('report-card-totals')).toBeTruthy();
    expect(screen.getByTestId('report-card-cat-open')).toBeTruthy();
    expect(screen.queryByTestId('report-totals')).toBeNull();
    expect(document.querySelectorAll('[data-testid="report-panel"] table')).toHaveLength(0);
    // 표에서 붙어 읽히던 수치들이 카드에서는 라벨과 함께 나온다
    const card = screen.getByTestId('report-card-totals').textContent ?? '';
    expect(card).toContain('attempts 3');
    expect(card).toContain('mean 0.062bb');
    expect(card).toContain('bb/100 6.2');
    expect(card).toContain('Perfect 2');
  });

  it('P3M 6.4 넓은 화면: 지금과 같은 7열 표', () => {
    stubMatchMedia(() => true);
    render(<ReportPanel report={REPORT} title="세션 리포트" />);
    expect(screen.getByTestId('report-totals')).toBeTruthy();
    expect(screen.queryByTestId('report-card-totals')).toBeNull();
    expect(document.querySelectorAll('[data-testid="report-panel"] thead th')).toHaveLength(7);
  });
});
