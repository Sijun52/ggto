/**
 * 차트 뷰어 테스트. P2.md 9.
 *
 * 응답 본문은 **7.1 생성기 출력**(web/test/fixtures/hu-pushfold-10bb.json, 실제 `npm run seed`
 * 산출물)을 core 로 1326 전개해 만든다. 손으로 쓴 1326 배열은 쓰지 않는다.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HAND_CLASS_COUNT, comboCards, formatCard, handClassCombos, handClassName, parseHandClass } from '@ggto/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsPage, breadcrumbSeqs } from '../src/pages/ChartsPage';
import { useUiStore } from '../src/store/ui';

interface FixtureNode {
  seq: string;
  actions: string[];
  strategy: Record<string, number[]>;
  ev: Record<string, number[]>;
}
interface Fixture {
  name: string;
  config: { positions: string[]; blinds: { pos: string; amount: number }[]; ante: { mode: string }; stack: number };
  resolution: '169';
  source: { kind: string; name: string };
  nodes: FixtureNode[];
}

const CHART = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'fixtures/hu-pushfold-10bb.json'), 'utf8'),
) as Fixture;

/** 169 키 → 1326 행 (임포터와 같은 규칙: 클래스의 모든 콤보에 같은 행) */
function expand(rows: Record<string, number[]>, action: number): number[] {
  const out = new Array<number>(1326).fill(0);
  for (let h = 0; h < HAND_CLASS_COUNT; h++) {
    const row = rows[handClassName(h)] as number[];
    for (const c of handClassCombos(h)) out[c] = row[action] as number;
  }
  return out;
}

const NODE_META = CHART.nodes.map((n) => ({
  seq: n.seq,
  heroPos: n.seq === '' ? 'SB' : 'BB',
  potBb: n.seq === '' ? 1.5 : 11,
  actions: n.actions,
  hasEv: true,
}));

function nodeResponse(seq: string): unknown {
  const node = CHART.nodes.find((n) => n.seq === seq);
  if (node === undefined) return null;
  const meta = NODE_META.find((n) => n.seq === seq);
  return {
    ...meta,
    strategy: node.actions.map((_a, i) => expand(node.strategy, i)),
    ev: node.actions.map((_a, i) => expand(node.ev, i)),
    // HU 푸시/폴드에서는 두 노드 모두 히어로의 도달 레인지가 100% 다 (3.4).
    reach: new Array<number>(1326).fill(1),
  };
}

const SET = {
  id: 1,
  name: CHART.name,
  gameType: 'cash',
  config: CHART.config,
  rake: { mode: 'none' },
  resolution: '169',
  hasEv: true,
  evBasis: 'stack_delta_from_node',
  source: CHART.source,
  formatVersion: 1,
  contentHash: 'a'.repeat(64),
  importedAt: 0,
};

const urls: string[] = [];

function mockFetch(): void {
  vi.stubGlobal('fetch', (input: string) => {
    urls.push(input);
    const url = new URL(input, 'http://localhost');
    const path = url.pathname;
    const seq = decodeURIComponent((url.search.match(/[?&]seq=([^&]*)/) ?? ['', ''])[1] as string);
    let body: unknown = null;
    let status = 200;
    if (path === '/api/charts') body = { sets: [SET] };
    else if (path === '/api/charts/1') body = { ...SET, nodes: NODE_META };
    else if (path === '/api/charts/1/node') {
      body = nodeResponse(seq);
      if (body === null) {
        status = 404;
        body = { error: { code: 'MissingNode', message: `no chart node for ${seq}` } };
      }
    } else if (path === '/api/charts/1/range') {
      body = { pos: url.searchParams.get('pos'), seq, weights: new Array<number>(1326).fill(1) };
    } else {
      status = 404;
      body = { error: { code: 'NotFound', message: path } };
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    );
  });
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ChartsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  urls.length = 0;
  window.history.replaceState(null, '', '/charts');
  useUiStore.setState({
    chartSetId: null,
    seq: '',
    viewMode: 'strategy',
    selectedPos: null,
    selectedClass: null,
    hoveredClass: null,
  });
  mockFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('9 브레드크럼 경로 분해', () => {
  it('9 seq 를 접두들로 쪼갠다', () => {
    expect(breadcrumbSeqs('')).toEqual(['']);
    expect(breadcrumbSeqs('A')).toEqual(['', 'A']);
    expect(breadcrumbSeqs('A-C')).toEqual(['', 'A', 'A-C']);
    expect(breadcrumbSeqs('R2.5-C-R9')).toEqual(['', 'R2.5', 'R2.5-C', 'R2.5-C-R9']);
  });
});

describe('9 차트 뷰어', () => {
  it('9 루트 노드를 그리고 SB 탭이 히어로로 표시된다', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('grid')).toBeTruthy();
    });
    expect(screen.getByTestId('pos-tab-SB').textContent).toContain('•');
    expect(screen.getByTestId('pos-tab-BB').textContent).not.toContain('•');
    expect(screen.getByTestId('chart-source').textContent).toContain('generated');
    // 범례에 노드의 액션이 전부 있다
    expect(screen.getByTestId('legend').textContent).toContain('F');
    expect(screen.getByTestId('legend').textContent).toContain('A');
  });

  it('9 호버 상태줄은 생성기 값 그대로 보여준다 (AA 는 잼 100%)', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('grid')).toBeTruthy();
    });
    const canvas = screen.getByRole('grid');
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 520, 520);
    fireEvent.mouseMove(canvas, { clientX: 5, clientY: 5 }); // AA
    const evAA = (CHART.nodes[0]?.ev['AA'] as number[])[1] as number;
    expect(screen.getByTestId('chart-hover-readout').textContent).toBe(
      `선택: AA · F 0% +0.00bb · A 100% ${evAA >= 0 ? '+' : ''}${evAA.toFixed(2)}bb`,
    );
  });

  it('9 셀 클릭 → 우측 패널에 클래스 액션표·콤보표·169 안내문', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('grid')).toBeTruthy();
    });
    const canvas = screen.getByRole('grid');
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 520, 520);
    fireEvent.click(canvas, { clientX: 5, clientY: 5 }); // AA

    // 콤보 패널은 접힘이 기본이다 (D20 / P3M 3절) — 헤더를 눌러야 열린다.
    expect(screen.queryByTestId('chart-combo-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('combo-toggle'));

    expect(screen.getByTestId('chart-combo-panel').textContent).toContain('AA (6 combos)');
    expect(screen.getByTestId('chart-action-A').textContent).toContain('100%');
    expect(screen.getByTestId('chart-resolution-note')).toBeTruthy();
    // 콤보 6개가 전부 나온다 (이름은 core 가 만든다)
    const panel = screen.getByTestId('chart-combo-panel').textContent ?? '';
    for (const c of handClassCombos(parseHandClass('AA'))) {
      const [hi, lo] = comboCards(c);
      expect(panel).toContain(formatCard(hi) + formatCard(lo));
    }
  });

  it('9 액션 버튼 A 를 누르면 seq=A 노드를 가져오고 BB 탭이 히어로가 된다', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('grid')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('action-A'));
    await waitFor(() => {
      expect(screen.getByTestId('pos-tab-BB').textContent).toContain('•');
    });
    expect(urls.some((u) => u === '/api/charts/1/node?seq=A')).toBe(true);
    // 브레드크럼에 root › A 가 생기고 root 는 클릭 가능하다
    expect(screen.getByTestId('crumb-root')).toBeTruthy();
    expect(screen.getByTestId('crumb-A')).toBeTruthy();
    // URL 도 따라간다
    expect(window.location.search).toBe('?set=1&seq=A');
  });

  it('9 존재하지 않는 자식 노드의 액션 버튼은 비활성이다 (터미널)', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('grid')).toBeTruthy();
    });
    // 루트의 F 는 터미널 → 노드가 없다
    expect((screen.getByTestId('action-F') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('action-A') as HTMLButtonElement).disabled).toBe(false);
  });

  it('9 브레드크럼은 존재하는 노드만 링크한다', async () => {
    useUiStore.setState({ seq: 'A-C' });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('crumb-A')).toBeTruthy();
    });
    // "A-C" 는 터미널이라 노드가 없다 → 링크가 아니다
    expect(screen.queryByTestId('crumb-A-C')).toBeNull();
    expect(screen.getByTestId('breadcrumb').textContent).toContain('C');
    // 노드 자체가 없으므로 에러가 화면에 뜬다 (조용히 빈 격자가 아니다)
    await waitFor(() => {
      expect(screen.getByTestId('node-error').textContent).toContain('MissingNode');
    });
  });

  it('9 reach 모드로 바꾸면 P1 규칙(단일 녹색 fill)으로 그린다', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('grid')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('mode-reach'));
    await waitFor(() => {
      expect(screen.getByTestId('reach-summary').textContent).toContain('100%');
    });
    // reach 가 전부 1 이므로 모든 셀이 꽉 찬다 (P1 fill = weightSum/comboCount)
    expect(screen.getByTestId('legend').textContent).toContain('reach SB');
    const canvas = screen.getByRole('grid');
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 520, 520);
    fireEvent.mouseMove(canvas, { clientX: 5, clientY: 5 });
    expect(screen.getByTestId('chart-hover-readout').textContent).toBe('선택: AA · 6.00 / 6');
  });

  it('9 (P2 R1 MINOR 3) reach 모드 우측 패널은 포지션별 도달 질량·콤보 수뿐이다', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('grid')).toBeTruthy();
    });
    // strategy 모드에서는 셀을 고르면 액션·EV 패널이 나온다
    const canvas = screen.getByRole('grid');
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 520, 520);
    fireEvent.click(canvas, { clientX: 5, clientY: 5 }); // AA
    fireEvent.click(screen.getByTestId('combo-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('chart-combo-panel')).toBeTruthy();
    });
    expect(screen.queryByTestId('reach-panel')).toBeNull();

    fireEvent.click(screen.getByTestId('mode-reach'));
    await waitFor(() => {
      expect(screen.getByTestId('reach-panel')).toBeTruthy();
    });
    // 모드가 갈렸다: 액션/EV 패널은 사라지고 포지션 행만 남는다
    expect(screen.queryByTestId('chart-combo-panel')).toBeNull();
    for (const pos of CHART.config.positions) {
      expect(screen.getByTestId(`reach-row-${pos}`)).toBeTruthy();
    }
    // 루트에서는 두 포지션 다 1326 콤보 전부가 살아 있다 (아직 아무도 폴드하지 않았다)
    expect(screen.getByTestId('reach-row-SB').textContent).toContain('1326 / 1326');
    expect(screen.getByTestId('reach-row-SB').textContent).toContain('SB •'); // 히어로 표시
    expect(screen.getByTestId('reach-row-BB').textContent).not.toContain('•');
  });

  it('9 URL 의 set/seq 를 마운트할 때 읽는다', async () => {
    window.history.replaceState(null, '', '/charts?set=1&seq=A');
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pos-tab-BB').textContent).toContain('•');
    });
    expect(urls.some((u) => u === '/api/charts/1/node?seq=A')).toBe(true);
  });
});
