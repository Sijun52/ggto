import { parseRange } from '@ggto/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RangeGrid } from '../src/components/RangeGrid';
import { buildCells, cellAt } from '../src/lib/grid';

const SIZE = 520;

interface StubCtx {
  calls: { setTransform: number; fillRect: number; fillText: number; clearRect: number };
}

/**
 * jsdom 에는 2D 컨텍스트가 없다. drawGrid 를 모킹하지 않고 진짜로 돌린 뒤
 * 컨텍스트에 남은 호출 흔적으로 "몇 번 그렸는지" 를 센다 (자기 모듈 모킹 = 동어반복).
 */
function installStubContext(): StubCtx {
  const calls = { setTransform: 0, fillRect: 0, fillText: 0, clearRect: 0 };
  const ctx = {
    setTransform: () => {
      calls.setTransform++;
    },
    clearRect: () => {
      calls.clearRect++;
    },
    fillRect: () => {
      calls.fillRect++;
    },
    strokeRect: () => undefined,
    fillText: () => {
      calls.fillText++;
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  return { calls };
}

const CELLS = buildCells(parseRange('22+,A2s+,KTo+'));

describe('4.5 RangeGrid', () => {
  it('4.5 마운트하면 169 셀을 한 번 그린다', () => {
    const stub = installStubContext();
    render(<RangeGrid cells={CELLS} size={SIZE} />);
    expect(stub.calls.setTransform).toBe(1);
    expect(stub.calls.clearRect).toBe(1);
    expect(stub.calls.fillText).toBe(169);
    // 셀 배경 169 + 레이어 사각형 (P2.md 9: 셀은 레이어 스택으로 그린다).
    // P1 weight 모드는 셀당 레이어가 최대 1개라 "가중치 > 0 인 클래스 수" 와 같다.
    const layers = CELLS.reduce((acc, c) => acc + c.layers.filter((l) => l.fraction > 0).length, 0);
    expect(layers).toBe(CELLS.filter((c) => c.fill > 0).length);
    expect(stub.calls.fillRect).toBe(169 + layers);
  });

  it('4.5 cells 참조가 같으면 다시 그리지 않고, 새 참조면 한 번 더 그린다', () => {
    const stub = installStubContext();
    const { rerender } = render(<RangeGrid cells={CELLS} size={SIZE} />);
    expect(stub.calls.setTransform).toBe(1);

    rerender(<RangeGrid cells={CELLS} size={SIZE} />);
    expect(stub.calls.setTransform).toBe(1);

    rerender(<RangeGrid cells={buildCells(parseRange('QQ:0.5'))} size={SIZE} />);
    expect(stub.calls.setTransform).toBe(2);
  });

  it('4.5 호버는 격자를 다시 그리지 않고 onHover 로 인덱스만 올려보낸다 (P1 R2 MINOR 5: 툴팁 제거)', () => {
    const stub = installStubContext();
    const hovered: (number | null)[] = [];
    render(<RangeGrid cells={CELLS} size={SIZE} onHover={(h) => hovered.push(h)} />);
    const canvas = screen.getByRole('grid');
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, SIZE, SIZE);

    fireEvent.mouseMove(canvas, { clientX: 5, clientY: 5 });
    expect(hovered).toEqual([0]);
    expect(stub.calls.setTransform).toBe(1);
    // 격자는 더 이상 문구를 그리지 않는다. 같은 문자열은 페이지의 상태줄이 보여준다
    // (RangePage.test 4.4 / ChartsPage.test 9 가 그 문구를 고정한다).
    expect(screen.queryByTestId('grid-tooltip')).toBeNull();

    fireEvent.mouseLeave(canvas);
    expect(hovered).toEqual([0, null]);
  });

  it('4.5 (MINOR 5) devicePixelRatio 가 바뀌면 새 배율로 다시 그린다', () => {
    const stub = installStubContext();
    const listeners: (() => void)[] = [];
    const queries: string[] = [];
    vi.stubGlobal('matchMedia', (query: string) => {
      queries.push(query);
      return {
        media: query,
        matches: true,
        addEventListener: (_type: string, fn: () => void) => {
          listeners.push(fn);
        },
        removeEventListener: () => undefined,
      };
    });

    render(<RangeGrid cells={CELLS} size={SIZE} />);
    const canvas = screen.getByRole('grid') as HTMLCanvasElement;
    expect(canvas.width).toBe(SIZE); // dpr 1
    expect(stub.calls.setTransform).toBe(1);
    expect(listeners.length).toBe(1);
    expect(queries).toEqual(['(resolution: 1dppx)']);

    vi.stubGlobal('devicePixelRatio', 2);
    act(() => {
      for (const fn of [...listeners]) fn();
    });

    expect(canvas.width).toBe(SIZE * 2);
    expect(stub.calls.setTransform).toBe(2);
    // 재구독은 **새 배율**로 걸려야 한다 (P1 R2 MINOR 3). 1dppx 에 계속 붙어 있으면
    // 2 → 1.5 같은 다음 변경을 놓친다.
    expect(queries).toEqual(['(resolution: 1dppx)', '(resolution: 2dppx)']);
    vi.unstubAllGlobals();
  });

  it('4.5 클릭 좌표 → onSelect 가 cellAt 과 같은 인덱스를 준다', () => {
    installStubContext();
    const picked: number[] = [];
    render(<RangeGrid cells={CELLS} size={SIZE} onSelect={(h) => picked.push(h)} />);
    const canvas = screen.getByRole('grid');
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, SIZE, SIZE);

    const points: [number, number][] = [
      [5, 5],
      [SIZE - 1, 5],
      [5, SIZE - 1],
      [SIZE - 1, SIZE - 1],
      [260, 260],
      [123, 45],
    ];
    for (const [x, y] of points) fireEvent.click(canvas, { clientX: x, clientY: y });
    expect(picked).toEqual(points.map(([x, y]) => cellAt(x, y, SIZE)));
  });

  it('9 액션 레이어는 셀당 레이어 수만큼 fillRect 를 부른다 (누적 색)', () => {
    const stub = installStubContext();
    // 셀 하나에 레이어 2개(F 50% / A 50%) 를 준다 — 배경 169 + 레이어 2 = 171
    const cells = CELLS.map((c, i) =>
      i === 0
        ? {
            ...c,
            inRange: true,
            fill: 1,
            layers: [
              { key: 'F', color: '#64748b', fraction: 0.5 },
              { key: 'A', color: '#dc2626', fraction: 0.5 },
            ],
          }
        : { ...c, inRange: false, fill: 0, layers: [] },
    );
    render(<RangeGrid cells={cells} size={SIZE} />);
    expect(stub.calls.fillRect).toBe(169 + 2);
  });

  it('4.5 접근성 훅: role=grid, aria-label, data-selected 가 라벨', () => {
    installStubContext();
    render(<RangeGrid cells={CELLS} size={SIZE} selected={1} />);
    const canvas = screen.getByRole('grid');
    expect(canvas.getAttribute('aria-label')).toBe('range grid');
    expect(canvas.getAttribute('data-selected')).toBe('AKs');
  });

  it('4.5 축 라벨 13개가 A..2 순서로 두 방향 모두 그려진다', () => {
    installStubContext();
    const { container } = render(<RangeGrid cells={CELLS} size={SIZE} />);
    const cols = [...container.querySelectorAll('[class*="text-[11px]"]')].map((e) => e.textContent);
    expect(cols.join('')).toBe('AKQJT98765432AKQJT98765432');
  });
});
