/**
 * P5.md 8.1 — `/solve` 페이지 (목록 · 폼 · 확인 시트 · 503).
 *
 * 503 시나리오가 D24 의 화면 판이다: 솔버가 없으면 배너 한 줄 + 폼 잠금이고,
 * 다른 페이지 링크는 살아 있어야 한다 (뷰어·트레이너는 솔버가 없어도 돈다).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SolvePage } from '../src/pages/SolvePage';
import { useUiStore } from '../src/store/ui';

const HASH = 'b'.repeat(64);

const ROW = {
  hash: HASH,
  boardCanonical: '2c7cKd',
  street: 'flop',
  potBb: 20,
  stackBb: 80,
  sizings: JSON.stringify({
    flop: { bet: '33%,75%', raise: '2.5x' },
    turn: { bet: '75%', raise: '2.5x' },
    river: { bet: '75%', raise: '2.5x' },
  }),
  compressed: false,
  exploitability: 0.21,
  iterations: 200,
  bytes: 4.9 * 1024 * 1024,
  solver: 'postflop-solver@test',
  createdAt: Date.now() - 7200_000,
  lastUsedAt: Date.now() - 7200_000,
  elapsedMs: 4200,
};

interface MockOptions {
  solvesStatus?: number;
  solvesBody?: unknown;
  post?: (body: Record<string, unknown>) => { status: number; body: unknown };
}

const posts: Record<string, unknown>[] = [];

function mockFetch(opts: MockOptions = {}): void {
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    let status = 200;
    let body: unknown = null;
    if (url.pathname === '/api/solves') {
      status = opts.solvesStatus ?? 200;
      body =
        status === 200
          ? (opts.solvesBody ?? { solves: [ROW], totalBytes: ROW.bytes, capBytes: 20 * 1024 ** 3 })
          : { error: { code: 'SolverUnavailable', message: 'the solver binary is not built' } };
    } else if (url.pathname === '/api/solve' && init?.method === 'POST') {
      const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
      posts.push(parsed);
      const r = opts.post?.(parsed) ?? {
        status: 200,
        body: {
          jobId: null,
          hash: HASH,
          cached: false,
          status: 'estimated',
          estMemoryBytes: 2.1 * 1024 ** 3,
          estSeconds: 40,
          board: parsed.board,
        },
      };
      status = r.status;
      body = r.body;
    } else if (url.pathname === `/api/solve/${HASH}/node`) {
      status = 404;
      body = { error: { code: 'NoSolve', message: 'not in this test' } };
    } else {
      status = 404;
      body = { error: { code: 'NotFound', message: url.pathname } };
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
      <SolvePage />
    </QueryClientProvider>,
  );
}

function fillForm(): void {
  fireEvent.change(screen.getByTestId('form-board'), { target: { value: 'Ks7h2h' } });
  fireEvent.change(screen.getByLabelText('oop range'), { target: { value: '22+,A2s+' } });
  fireEvent.change(screen.getByLabelText('ip range'), { target: { value: 'TT-22,AJs-A2s' } });
}

beforeEach(() => {
  posts.length = 0;
  window.localStorage.clear();
  window.history.replaceState(null, '', '/solve');
  useUiStore.setState({ solvePhase: 'list', solveHash: null, solveLine: '', solveJobId: null });
  mockFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('P5 3.1 목록', () => {
  it('P5 3.1 행이 카드로 뜨고 프리셋 이름·용량·시간을 보여준다', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId(`solve-row-${HASH}`)).toBeTruthy();
    });
    const text = screen.getByTestId(`solve-row-${HASH}`).textContent ?? '';
    // sizings 는 JSON 이지만 프리셋 표에서 이름을 되찾는다 (7절).
    expect(text).toContain('simple');
    expect(text).toContain('expl 0.21%');
    expect(text).toContain('4.9MB');
    expect(text).toContain('2시간 전');
  });

  it('P5 3.1 카드를 탭하면 탐색기가 열린다 (정규 모드 — 표기가 없다)', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId(`solve-open-${HASH}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`solve-open-${HASH}`));
    await waitFor(() => {
      expect(useUiStore.getState().solvePhase).toBe('explore');
    });
    expect(useUiStore.getState().solveHash).toBe(HASH);
    expect(useUiStore.getState().solveLine).toBe('');
  });

  it('P5 3.1 삭제는 확인을 한 번 거친다', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId(`solve-delete-${HASH}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`solve-delete-${HASH}`));
    expect(screen.getByTestId(`solve-delete-confirm-${HASH}`)).toBeTruthy();
  });
});

describe('P5 0.4 솔버 없는 PC (D24)', () => {
  it('P5 0.4 503 이면 배너 + 폼 잠금이고 다른 페이지 링크는 남는다', async () => {
    mockFetch({ solvesStatus: 503 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('solver-unavailable')).toBeTruthy();
    });
    expect(screen.getByTestId('solver-unavailable').textContent).toContain('npm run build:solver');
    // 다른 페이지는 그대로 (뷰어·트레이너는 솔버가 없어도 돈다).
    expect(screen.getByText('Charts').getAttribute('href')).toBe('/charts');
    expect(screen.getByText('Trainer').getAttribute('href')).toBe('/trainer');
    // 목록이 없으니 폼으로 갈 수는 있지만 제출은 잠겨 있다.
    useUiStore.setState({ solvePhase: 'form' });
    await waitFor(() => {
      expect(screen.getByTestId('solve-form')).toBeTruthy();
    });
    fillForm();
    expect((screen.getByTestId('form-submit') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('P5 3.1 새 솔브', () => {
  it('P5 3.1 제출 → 확인 시트에 메모리·시간이 뜬다 (confirm 없이 POST 한 번)', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('new-solve')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('new-solve'));
    fillForm();
    fireEvent.click(screen.getByTestId('form-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('estimate-sheet')).toBeTruthy();
    });
    expect(screen.getByTestId('estimate-line').textContent).toContain('2.1GB');
    expect(screen.getByTestId('estimate-line').textContent).toContain('40초');
    expect(posts.length).toBe(1);
    expect(posts[0]?.confirm).toBeUndefined();
    // 표기는 POST 응답의 해시를 받는 순간 저장된다 (D26).
    expect(window.localStorage.getItem(`ggto.solve.notation.${HASH}`)).toContain('Ks7h2h');
  });

  it('P5 3.1 cached:true 면 진행 화면 없이 탐색기로 간다', async () => {
    mockFetch({
      post: (body) => ({
        status: 200,
        body: {
          jobId: null,
          hash: HASH,
          cached: true,
          status: 'done',
          estMemoryBytes: 0,
          estSeconds: 0,
          board: body.board,
        },
      }),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('new-solve')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('new-solve'));
    fillForm();
    fireEvent.click(screen.getByTestId('form-submit'));
    await waitFor(() => {
      expect(useUiStore.getState().solvePhase).toBe('explore');
    });
    expect(screen.queryByTestId('solve-progress')).toBeNull();
    expect(screen.queryByTestId('estimate-sheet')).toBeNull();
  });

  it('P5 3.1 413 TooLarge 는 시트가 아니라 폼 아래 오류다', async () => {
    mockFetch({
      post: () => ({
        status: 413,
        body: { error: { code: 'TooLarge', message: 'this spot needs 12.00GB but the cap is 8.00GB' } },
      }),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('new-solve')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('new-solve'));
    fillForm();
    fireEvent.click(screen.getByTestId('form-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toBeTruthy();
    });
    expect(screen.getByTestId('form-error').textContent).toContain('사이징을 줄이세요');
    expect(screen.queryByTestId('estimate-sheet')).toBeNull();
  });

  it('P5 3.1 폼은 잘못된 보드·레인지를 제출하지 못한다', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('new-solve')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('new-solve'));
    expect((screen.getByTestId('form-submit') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('form-board'), { target: { value: 'Ks7hXx' } });
    expect(screen.getByTestId('form-board-info').textContent).not.toBe('3장');
    fillForm();
    expect(screen.getByTestId('form-board-info').textContent).toBe('3장');
    // core 파서가 센 콤보 수 — AA-22(78) + A2s+(12*... ) 를 손으로 세지 않고 형식만 본다.
    expect(screen.getByTestId('form-oop-info').textContent).toMatch(/^\d+ combos$/);
    expect((screen.getByTestId('form-submit') as HTMLButtonElement).disabled).toBe(false);
  });
});
