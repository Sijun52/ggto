/**
 * P5.md 8.1 — 탐색기. 노드 응답은 **커밋된 픽스처**(실제 `toNodeResponse` 산출물)를 쓰고,
 * chance·터미널은 서버가 실제로 주는 **오류 봉투**로 흉내낸다 (D27: 코드로만 판별).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SolveNodeResponse } from '@ggto/protocol';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SolveExplorer } from '../src/components/solve/SolveExplorer';
import { useUiStore } from '../src/store/ui';

const FIXTURE = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'fixtures/solve-node.json'), 'utf8'),
) as { response: SolveNodeResponse };

const HASH = 'a'.repeat(64);

/** chance 노드의 runouts 응답 (49장 중 몇 장만 — 개수 단언은 하지 않는다) */
function runoutsBody(): unknown {
  const cards = ['As', 'Kh', 'Qc', '5d', '9h'].map((card, i) => ({
    card,
    evOop: 12 + i,
    evIp: 8 - i,
    equityOop: 0.5,
    strategyRoot: [0.5, 0.3, 0.2],
  }));
  return { line: 'X-X', board: '2h7hKc', cards, perm: [0, 1, 2, 3] };
}

interface MockOptions {
  /** 이 라인에서 어떤 응답을 줄 것인가 */
  node?: (line: string, hasQuery: boolean) => { status: number; body: unknown };
}

const urls: string[] = [];

function mockFetch(opts: MockOptions = {}): void {
  vi.stubGlobal('fetch', (input: string) => {
    urls.push(input);
    const url = new URL(input, 'http://localhost');
    const line = decodeURIComponent((/[?&]line=([^&]*)/.exec(url.search) ?? ['', ''])[1] as string);
    const hasQuery = url.search.includes('board=');
    let status = 200;
    let body: unknown = null;
    if (url.pathname === `/api/solve/${HASH}/node`) {
      const r = opts.node?.(line, hasQuery) ?? { status: 200, body: FIXTURE.response };
      status = r.status;
      body = r.body;
    } else if (url.pathname === `/api/solve/${HASH}/runouts`) {
      body = runoutsBody();
    } else if (url.pathname === '/api/solves') {
      body = { solves: [], totalBytes: 0, capBytes: 1 };
    } else {
      status = 404;
      body = { error: { code: 'NotFound', message: url.pathname } };
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    );
  });
}

const chanceError = {
  status: 400,
  body: { error: { code: 'ChanceNode', message: '"X-X" is a chance node — use the `runouts` method' } },
};
const terminalError = {
  status: 400,
  body: { error: { code: 'NoSuchLine', message: '"X-F" is a terminal node' } },
};

function renderExplorer(props: Partial<React.ComponentProps<typeof SolveExplorer>> = {}): {
  mismatches: number;
} {
  const counters = { mismatches: 0 };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SolveExplorer
        hash={HASH}
        notation={null}
        summary={null}
        onBack={() => undefined}
        onNotationMismatch={() => {
          counters.mismatches += 1;
        }}
        onEditNotation={() => undefined}
        {...props}
      />
    </QueryClientProvider>,
  );
  return counters;
}

beforeEach(() => {
  urls.length = 0;
  useUiStore.setState({ solveHash: HASH, solveLine: '', solvePlayer: null, runoutPick: null, selectedClass: null });
  mockFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('P5 3.2 탐색기 — 행동 노드', () => {
  it('P5 3.2 액션 버튼 수 = 응답의 actions 이고 탭하면 childLine 으로 이동한다', async () => {
    renderExplorer();
    await waitFor(() => {
      expect(screen.getByTestId('solve-action-X')).toBeTruthy();
    });
    for (const a of FIXTURE.response.actions) expect(screen.getByTestId(`solve-action-${a}`)).toBeTruthy();
    expect(screen.queryAllByTestId(/^solve-action-/).length).toBe(FIXTURE.response.actions.length);

    fireEvent.click(screen.getByTestId('solve-action-B6.6'));
    await waitFor(() => {
      expect(useUiStore.getState().solveLine).toBe('B6.6');
    });
    // 요청의 line 도 같은 문자열이다 (`.` 이 쪼개지지 않는다 — D3).
    await waitFor(() => {
      expect(urls.some((u) => u.includes(`line=${encodeURIComponent('B6.6')}`))).toBe(true);
    });
  });

  it('P5 1.5 헤더 보드는 응답의 board 다 (클라이언트가 이어 붙이지 않는다)', async () => {
    renderExplorer();
    await waitFor(() => {
      expect(screen.getByTestId('board-cards')).toBeTruthy();
    });
    // 픽스처 응답은 원본 공간 `2h7hKcQh` 다 — 턴 카드 Qh 를 포함한 4장.
    expect(screen.getByTestId('board-card-2h')).toBeTruthy();
    expect(screen.getByTestId('board-card-Qh')).toBeTruthy();
    expect(screen.queryByTestId('board-card-Qc')).toBeNull();
  });

  it('P5 1.2 쿼리를 붙이지 않았을 때만 `정규 표기` 칩이 뜬다', async () => {
    renderExplorer();
    await waitFor(() => {
      expect(screen.getByTestId('notation-chip')).toBeTruthy();
    });
    expect(screen.getByTestId('notation-chip').textContent).toContain('정규 표기');
  });

  it('P5 1.5 evAvgBb 가 없는(도달 0) 노드는 숫자가 아니라 `—` 다', async () => {
    mockFetch({
      node: () => ({
        status: 200,
        body: { ...FIXTURE.response, reachable: false, evAvgBb: [0, 0] },
      }),
    });
    renderExplorer();
    await waitFor(() => {
      expect(screen.getByTestId('node-ev')).toBeTruthy();
    });
    expect(screen.getByTestId('node-ev').textContent).toContain('OOP —');
    expect(screen.getByTestId('node-ev').textContent).not.toContain('+0.00');
    expect(screen.getByTestId('node-unreachable')).toBeTruthy();
  });

  it('P5 1.5 도달 가능한 노드는 OOP + IP 합 = 팟을 보여준다', async () => {
    renderExplorer();
    await waitFor(() => {
      expect(screen.getByTestId('node-ev')).toBeTruthy();
    });
    // 픽스처: evAvgBb = [12.84, 7.16], potChips = 2000 → 20.00
    expect(screen.getByTestId('node-ev').textContent).toContain('OOP +12.84');
    expect(screen.getByTestId('node-ev').textContent).toContain('IP +7.16');
    expect(screen.getByTestId('node-ev').textContent).toContain('= 팟 20.00');
  });

  it('P5 3.2 OOP|IP 토글 — 상대 쪽에서는 전략 범례가 아니라 도달 레인지다', async () => {
    renderExplorer();
    // 행동 플레이어(OOP) 기본: 범례에 액션이 있다.
    await waitFor(() => {
      expect(screen.getByTestId('legend').textContent).toContain('B6.6');
    });
    fireEvent.click(screen.getByTestId('player-ip'));
    await waitFor(() => {
      expect(screen.getByTestId('legend').textContent).toContain('reach');
    });
    expect(screen.getByTestId('legend').textContent).not.toContain('B6.6');
    // 콤보 패널(EV 열이 사는 곳)은 상대 쪽에서 아예 없다 — 상대의 콤보별 EV 가 없기 때문이다.
    expect(screen.queryByTestId('combo-toggle')).toBeNull();
  });
});

describe('P5 1.4 chance · 터미널', () => {
  it('P5 1.4 ChanceNode 응답이면 히트맵을 그리고 하단 바가 `카드를 고르세요` 다', async () => {
    mockFetch({ node: (line) => (line === '' ? chanceError : { status: 200, body: FIXTURE.response }) });
    renderExplorer();
    await waitFor(() => {
      expect(screen.getByTestId('runouts')).toBeTruthy();
    });
    expect(screen.getByTestId('action-bar-chance').textContent).toContain('카드를 고르세요');
    // 격자는 없다 (같은 자리를 히트맵이 쓴다).
    expect(screen.queryByRole('grid')).toBeNull();
    // runouts 를 실제로 물었다.
    expect(urls.some((u) => u.includes('/runouts'))).toBe(true);
  });

  it('P5 3.3 히트맵은 2단계 탭이다 — 첫 탭은 상태줄, 두 번째 탭이 이동', async () => {
    mockFetch({ node: (line) => (line === '' ? chanceError : { status: 200, body: FIXTURE.response }) });
    renderExplorer();
    await waitFor(() => {
      expect(screen.getByTestId('runout-As')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('runout-As'));
    expect(screen.getByTestId('runout-readout').textContent).toContain('A♠');
    expect(useUiStore.getState().solveLine).toBe('');

    fireEvent.click(screen.getByTestId('runout-As'));
    await waitFor(() => {
      expect(useUiStore.getState().solveLine).toBe('As');
    });
  });

  it('P5 1.4 NoSuchLine 이면 터미널 안내이고 `←` 로 돌아간다', async () => {
    mockFetch({ node: (line) => (line === 'X-F' ? terminalError : { status: 200, body: FIXTURE.response }) });
    useUiStore.setState({ solveLine: 'X-F' });
    renderExplorer();
    await waitFor(() => {
      expect(screen.getByTestId('action-bar-terminal')).toBeTruthy();
    });
    expect(screen.getByTestId('action-bar-terminal').textContent).toContain('종료 노드');
    fireEvent.click(screen.getByTestId('line-back'));
    await waitFor(() => {
      expect(useUiStore.getState().solveLine).toBe('X');
    });
  });
});

describe('P5 4 HashMismatch', () => {
  it('P5 4 저장된 표기가 이 솔브의 것이 아니면 정규 모드로 다시 연다 (요청 2회)', async () => {
    mockFetch({
      node: (_line, hasQuery) =>
        hasQuery
          ? { status: 400, body: { error: { code: 'HashMismatch', message: 'different game' } } }
          : { status: 200, body: FIXTURE.response },
    });
    const counters = renderExplorer({
      notation: {
        board: 'Ks7h2h',
        oop: '22+',
        ip: 'TT-22',
        potBb: 20,
        stackBb: 80,
        sizings: 'simple',
        compressed: false,
        rake: { mode: 'none' },
      },
    });
    await waitFor(() => {
      expect(counters.mismatches).toBeGreaterThan(0);
    });
    // 첫 요청은 표기 쿼리를 달았다. 호출부가 표기를 지우면 두 번째는 정규 모드다.
    expect(urls[0]).toContain('board=');
  });
});
