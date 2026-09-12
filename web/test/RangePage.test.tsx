import { comboCount, formatRange, parseRange, totalWeight } from '@ggto/core';
import type { ErrorEnvelope, ParseRangeResponse } from '@ggto/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RangePage } from '../src/pages/RangePage';
import { useUiStore } from '../src/store/ui';

/** 손으로 쓴 가짜 배열 대신 core 로 진짜 응답을 만든다. */
function parseResponse(text: string): ParseRangeResponse {
  const r = parseRange(text);
  return {
    text: formatRange(r),
    comboCount: comboCount(r),
    totalWeight: totalWeight(r),
    weights: Array.from(r),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface FetchCall {
  url: string;
  body: string;
}

function mockFetch(handler: (call: FetchCall) => Response): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = { url: String(input), body: String(init?.body ?? '') };
    calls.push(call);
    return Promise.resolve(handler(call));
  });
  return calls;
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RangePage />
    </QueryClientProvider>,
  );
}

function setUrl(search: string): void {
  window.history.replaceState({}, '', `/${search}`);
}

beforeEach(() => {
  // jsdom 에는 2D 컨텍스트가 없다. 명시적으로 null 을 돌려줘 "Not implemented" 잡음을 없앤다
  // (RangeGrid 는 ctx === null 이면 그리기를 건너뛴다).
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  useUiStore.setState({ rangeText: '', selectedClass: null, hoveredClass: null });
  setUrl('');
  vi.unstubAllGlobals();
});

describe('4.5 RangePage', () => {
  it('4.5 마운트하면 기본 레인지를 파싱해 요약에 162 가 나온다', async () => {
    mockFetch(() => jsonResponse(parseResponse('22+,A2s+,KTo+')));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('range-summary').textContent).toContain('162');
    });
    const summary = screen.getByTestId('range-summary').textContent ?? '';
    expect(summary).toContain('canonical: 22+,A2s+,KTo+');
    expect(summary).toContain('combos: 162 / 1326');
    expect(summary).toContain('weight: 162');
  });

  it('4.5 ?range=AA 로 마운트하면 첫 요청 본문이 {"text":"AA"}', async () => {
    setUrl('?range=AA');
    const calls = mockFetch(() => jsonResponse(parseResponse('AA')));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('range-summary').textContent).toContain('combos: 6');
    });
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe('/api/range/parse');
    expect(calls[0]?.body).toBe('{"text":"AA"}');
  });

  it('4.5 ?range=22+,A2s+ (리터럴 +, 인코딩 안 함) → 첫 요청 본문이 {"text":"22+,A2s+"}', async () => {
    setUrl('?range=22+,A2s+');
    const calls = mockFetch(() => jsonResponse(parseResponse('22+,A2s+')));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('range-summary').textContent).toContain('combos:');
    });
    // URLSearchParams 였다면 "22 ,A2s " 가 되어 조용히 22 콤보짜리 다른 레인지를 그린다 (R1 MAJOR 1).
    expect(calls[0]?.body).toBe('{"text":"22+,A2s+"}');
    expect(screen.getByTestId('range-summary').textContent).toContain('combos: 126 / 1326');
    // 입력 상자에도 + 가 그대로 남아야 한다
    expect((screen.getByLabelText('range text') as HTMLInputElement).value).toBe('22+,A2s+');
  });

  it('4.5 ?range=22%2B (퍼센트 인코딩) → 첫 요청 본문이 {"text":"22+"}', async () => {
    setUrl('?range=22%2B');
    const calls = mockFetch(() => jsonResponse(parseResponse('22+')));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('range-summary').textContent).toContain('combos: 78');
    });
    expect(calls[0]?.body).toBe('{"text":"22+"}');
  });

  it('4.5 ?range=22+,A2s+,KTo+ 리터럴 + → 162 콤보 (리뷰어가 주소창에 그대로 치는 형태)', async () => {
    setUrl('?range=22+,A2s+,KTo+');
    const calls = mockFetch((call) =>
      jsonResponse(parseResponse(JSON.parse(call.body).text as string)),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('range-summary').textContent).toContain('combos: 162 / 1326');
    });
    expect(calls[0]?.body).toBe('{"text":"22+,A2s+,KTo+"}');
  });

  it('4.5 ?range=QQ%3A0.5 → combos 6, weight 3 (DoD 5 와 같은 URL)', async () => {
    setUrl('?range=QQ%3A0.5');
    const calls = mockFetch(() => jsonResponse(parseResponse('QQ:0.5')));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('range-summary').textContent).toContain('combos: 6');
    });
    expect(calls[0]?.body).toBe('{"text":"QQ:0.5"}');
    expect(screen.getByTestId('range-summary').textContent).toContain('weight: 3');
  });

  it('4.5 에러 봉투를 받으면 RangeSyntaxError 가 뜨고 이전 요약이 남는다', async () => {
    const envelope: ErrorEnvelope = {
      error: { code: 'RangeSyntaxError', message: 'connector "+" is ambiguous across tools: "T9s+"' },
    };
    mockFetch((call) =>
      call.body.includes('T9s+') ? jsonResponse(envelope, 400) : jsonResponse(parseResponse('22+,A2s+,KTo+')),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('range-summary').textContent).toContain('162');
    });

    const input = screen.getByLabelText('range text');
    fireEvent.change(input, { target: { value: 'T9s+' } });
    fireEvent.click(screen.getByText('Parse'));

    await waitFor(() => {
      expect(screen.getByTestId('range-error').textContent).toContain('RangeSyntaxError');
    });
    expect(screen.getByTestId('range-error').textContent).toContain('connector');
    // 이전 격자/요약은 유지된다
    expect(screen.getByTestId('range-summary').textContent).toContain('162');
    expect(screen.getByRole('grid')).not.toBeNull();
  });

  it('4.5 텍스트를 바꿔 제출하면 격자와 요약이 바뀐다', async () => {
    mockFetch((call) =>
      jsonResponse(parseResponse(call.body.includes('QQ') ? 'QQ:0.5' : '22+,A2s+,KTo+')),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('range-summary').textContent).toContain('162');
    });

    fireEvent.change(screen.getByLabelText('range text'), { target: { value: 'QQ:0.5' } });
    fireEvent.click(screen.getByText('Parse'));

    await waitFor(() => {
      expect(screen.getByTestId('range-summary').textContent).toContain('combos: 6 / 1326');
    });
    expect(screen.getByTestId('range-summary').textContent).toContain('canonical: QQ:0.5');
  });

  it('4.5 셀을 클릭하면 콤보 패널이 parseRange 로 직접 계산한 값과 같다', async () => {
    mockFetch(() => jsonResponse(parseResponse('QQ:0.5')));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('range-summary').textContent).toContain('combos: 6');
    });

    const canvas = screen.getByRole('grid');
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 520, 520);
    // QQ = row 2, col 2 → 셀 중앙 (2.5 * 40 = 100)
    fireEvent.click(canvas, { clientX: 100, clientY: 100 });

    const panel = await screen.findByTestId('combo-panel');
    expect(panel.textContent).toContain('QQ (6 combos)');
    const text = panel.textContent ?? '';
    // 6개 콤보 전부 0.50
    expect([...text.matchAll(/0\.50/g)].length).toBe(6);
    expect(text).toContain('QsQh');
    expect(canvas.getAttribute('data-selected')).toBe('QQ');
  });
});

describe('4.4 RangePage 상태 (store 가 읽히는지)', () => {
  it('4.4 입력 텍스트의 소유자는 store 다 — 타이핑하면 store 가 바뀌고, store 를 바꾸면 입력 상자가 바뀐다', async () => {
    setUrl('?range=AA');
    mockFetch(() => jsonResponse(parseResponse('AA')));
    renderPage();
    const input = screen.getByLabelText('range text') as HTMLInputElement;
    await waitFor(() => {
      expect(input.value).toBe('AA');
    });
    expect(useUiStore.getState().rangeText).toBe('AA');

    fireEvent.change(input, { target: { value: 'KK' } });
    expect(useUiStore.getState().rangeText).toBe('KK');

    act(() => {
      useUiStore.getState().setRangeText('QQ:0.5');
    });
    expect(input.value).toBe('QQ:0.5');
  });

  it('4.4 hoveredClass 는 읽힌다 — 격자 호버가 상태줄에 반영된다', async () => {
    mockFetch(() => jsonResponse(parseResponse('QsQh:0.5')));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('range-summary').textContent).toContain('combos: 1');
    });
    expect(screen.getByTestId('hover-readout').textContent).toBe('hover: —');

    const canvas = screen.getByRole('grid');
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 520, 520);
    // QQ = row 2, col 2 → 셀 중앙
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100 });

    expect(useUiStore.getState().hoveredClass).toBe(2 * 13 + 2);
    // 분모는 클래스 크기 6 (활성 콤보 1 이 아니다 — R1 MAJOR 2)
    expect(screen.getByTestId('hover-readout').textContent).toBe('hover: QQ · 0.50 / 6');

    fireEvent.mouseLeave(canvas);
    expect(useUiStore.getState().hoveredClass).toBeNull();
    expect(screen.getByTestId('hover-readout').textContent).toBe('hover: —');
  });
});

describe('4.5 RangePage — 첫 파싱이 실패한 경우', () => {
  it('4.5 그릴 격자가 없으면 영원한 loading 대신 이유를 보여준다', async () => {
    setUrl('?range=T9s%2B');
    const envelope: ErrorEnvelope = {
      error: { code: 'RangeSyntaxError', message: 'connector "+" is ambiguous across tools: "T9s+"' },
    };
    const calls = mockFetch(() => jsonResponse(envelope, 400));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('range-error').textContent).toContain('RangeSyntaxError');
    });
    expect(calls[0]?.body).toBe('{"text":"T9s+"}');
    expect(screen.getByTestId('grid-placeholder').textContent).toBe('no range to draw');
    expect(screen.queryByRole('grid')).toBeNull();
  });
});
