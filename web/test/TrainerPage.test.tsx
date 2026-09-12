/**
 * 트레이너 페이지 테스트. P3.md 8.3.
 *
 * 핵심은 **답하기 전에 정답이 브라우저에 없다**는 것이다: `/api/trainer/next` 응답에
 * strategy/ev/reach 가 없고 `/api/charts/*//*node` 도 부르지 않는다. 아래 테스트는
 * fetch 로 오간 URL 목록과 응답 JSON 문자열을 직접 검사해 그것을 고정한다.
 *
 * 응답 본문은 **7.1 생성기 출력**(fixtures/hu-pushfold-10bb.json = 실제 `npm run seed`
 * 산출물)을 core 로 1326 전개해 만든다. 손으로 쓴 전략/EV 배열은 쓰지 않는다.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  HAND_CLASS_COUNT,
  comboCards,
  comboIndex,
  formatCard,
  handClassCombos,
  handClassName,
  handClassOf,
  parseCards,
  parseHandClass,
} from '@ggto/core';
import type { GradeDto, ReportDto, SpotDto } from '@ggto/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartNodeView } from '../src/components/ChartNodeView';
import { actionColors, buildChartCells } from '../src/lib/chartGrid';
import { TrainerPage } from '../src/pages/TrainerPage';
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
  nodes: FixtureNode[];
}

const CHART = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'fixtures/hu-pushfold-10bb.json'), 'utf8'),
) as Fixture;

const ROOT = CHART.nodes.find((n) => n.seq === '') as FixtureNode;
const CONTENT_HASH = 'b'.repeat(64);

/** 169 키 → 1326 행 (임포터와 같은 규칙: 클래스의 모든 콤보에 같은 행) */
function expand(rows: Record<string, number[]>, action: number): number[] {
  const out = new Array<number>(1326).fill(0);
  for (let h = 0; h < HAND_CLASS_COUNT; h++) {
    const row = rows[handClassName(h)] as number[];
    for (const c of handClassCombos(h)) out[c] = row[action] as number;
  }
  return out;
}

const ROOT_NODE_RESPONSE = {
  seq: '',
  heroPos: 'SB',
  potBb: 1.5,
  actions: ROOT.actions,
  hasEv: true,
  strategy: ROOT.actions.map((_a, i) => expand(ROOT.strategy, i)),
  ev: ROOT.actions.map((_a, i) => expand(ROOT.ev, i)),
  // HU 푸시/폴드 루트에서는 히어로(SB)의 도달 레인지가 100% 다.
  reach: new Array<number>(1326).fill(1),
};

const SET = {
  id: 3,
  name: CHART.name,
  gameType: 'cash',
  config: CHART.config,
  rake: { mode: 'none' },
  resolution: '169',
  hasEv: true,
  evBasis: 'stack_delta_from_node',
  source: { kind: 'generated', name: 'ggto pushfold' },
  formatVersion: 1,
  contentHash: CONTENT_HASH,
  importedAt: 0,
};

/** 콤보 문자열 → 1326 키 규약 (P2 5.1: formatCard(hi) + formatCard(lo)) */
function comboKey(text: string): string {
  const [a, b] = parseCards(text);
  if (a === undefined || b === undefined) throw new Error(`bad combo ${text}`);
  const [hi, lo] = comboCards(comboIndex(a, b));
  return `${formatCard(hi)}${formatCard(lo)}`;
}

/** 히어로 콤보의 169 클래스 (표시 전용 변환, D4) */
function classNameOf(text: string): string {
  const [a, b] = parseCards(text);
  if (a === undefined || b === undefined) throw new Error(`bad combo ${text}`);
  return handClassName(handClassOf(comboIndex(a, b)));
}

function spotFor(combo: string): SpotDto {
  return {
    spotKey: `pf:${CONTENT_HASH}::${comboKey(combo)}`,
    chartSetId: SET.id,
    chartName: SET.name,
    contentHash: CONTENT_HASH,
    seq: '',
    heroPos: 'SB',
    potBb: 1.5,
    actions: ROOT.actions,
    combo: comboKey(combo),
    category: 'open',
    gradedBy: 'ev',
    config: SET.config as unknown as SpotDto['config'],
    resolution: '169',
  };
}

/**
 * P3.md 3.3 의 정의를 **스펙 그대로** 옮긴 채점기. 서버 응답을 만드는 데만 쓴다.
 * (구현 코드를 복사한 것이 아니라 스펙 수식이다: best = max ev, loss = best - chosen.)
 */
function gradeFromFixture(node: FixtureNode, className: string, chosen: string): GradeDto {
  const freqs = node.strategy[className] as number[];
  const evs = node.ev[className] as number[];
  const ci = node.actions.indexOf(chosen);
  let bi = 0;
  for (let i = 1; i < node.actions.length; i++) if ((evs[i] as number) > (evs[bi] as number)) bi = i;
  const loss = Math.max(0, (evs[bi] as number) - (evs[ci] as number));
  const verdict = loss < 0.05 ? 'Perfect' : loss < 0.3 ? 'Minor' : loss < 1.0 ? 'Mistake' : 'Blunder';
  return {
    gradedBy: 'ev',
    verdict,
    evLossBb: loss,
    chosenAction: chosen,
    chosenFreq: freqs[ci] as number,
    bestAction: node.actions[bi] as string,
    bestEvBb: evs[bi] as number,
    mixed: freqs.filter((f) => f >= 0.01).length >= 2,
    actions: node.actions.map((a, i) => ({ action: a, freq: freqs[i] as number, evBb: evs[i] as number })),
  };
}

const EMPTY_VERDICTS = {
  Perfect: 0,
  Minor: 0,
  Mistake: 0,
  Blunder: 0,
  InStrategy: 0,
  OffStrategy: 0,
};

function reportDto(attempts: number, meanEvLossBb: number): ReportDto {
  const agg = {
    attempts,
    evGraded: attempts,
    meanEvLossBb,
    bb100: meanEvLossBb * 100,
    byVerdict: { ...EMPTY_VERDICTS, Perfect: attempts },
    mixedShare: 0,
  };
  return {
    scope: { sessionId: 1, durationMs: 1234 },
    totals: agg,
    byCategory: [{ ...agg, category: 'open' }],
    bySet: [{ ...agg, contentHash: CONTENT_HASH, name: SET.name }],
    leaks: [],
    srs: { due: 0, leeches: 0 },
  };
}

/** 중첩 JSON 안에서 가장 긴 배열의 길이. 1326 콤보 배열이 새어 나왔는지 보는 구조 검사다. */
function longestArray(v: unknown): number {
  if (Array.isArray(v)) return Math.max(v.length, ...v.map(longestArray), 0);
  if (typeof v === 'object' && v !== null) return Math.max(0, ...Object.values(v).map(longestArray));
  return 0;
}

// --- fetch 모킹 -------------------------------------------------------------

interface Recorded {
  url: string;
  method: string;
  body: string | null;
}

let calls: Recorded[] = [];
let bodies: string[] = [];
/** next 가 낼 스팟 열. 답할 때마다 하나씩 소비한다. */
let queue: SpotDto[] = [];
let answered = 0;
let chosenClass = '';

function mockFetch(): void {
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url: input, method, body });
    const path = new URL(input, 'http://localhost').pathname;

    let payload: unknown = null;
    let status = 200;
    if (path === '/api/charts') payload = { sets: [SET] };
    else if (path === '/api/trainer/pool') payload = { categories: ['open'], nodes: 12 };
    else if (path === '/api/trainer/session') payload = { sessionId: 1, seed: 42, count: queue.length };
    else if (path === '/api/trainer/next') {
      const spot = queue[answered];
      payload =
        spot === undefined
          ? { done: true, report: reportDto(answered, 0.0) }
          : { done: false, index: answered, count: queue.length, spot };
    } else if (path === '/api/trainer/answer') {
      const req = JSON.parse(body as string) as { action: string };
      answered++;
      payload = { grade: gradeFromFixture(ROOT, chosenClass, req.action), node: ROOT_NODE_RESPONSE };
    } else if (path === '/api/trainer/report') {
      payload = reportDto(5, 0.12);
    } else {
      status = 404;
      payload = { error: { code: 'NotFound', message: path } };
    }
    const text = JSON.stringify(payload);
    bodies.push(text);
    return Promise.resolve(new Response(text, { status, headers: { 'content-type': 'application/json' } }));
  });
}

interface StubCtx {
  fillRect: number;
  reset: () => void;
}

/**
 * jsdom 에는 2D 컨텍스트가 없다. drawGrid 를 모킹하지 않고 (자기 모듈 모킹 = 동어반복)
 * 진짜로 돌린 뒤 컨텍스트에 남은 `fillRect` 수로 "레이어를 그렸는가" 를 센다.
 * 셀 배경 169 + 레이어 사각형 = fillRect 총 호출 수다 (RangeGrid.test 와 같은 규약).
 */
function installStubContext(): StubCtx {
  const state = { fillRect: 0, reset: () => (state.fillRect = 0) };
  const ctx = {
    setTransform: () => undefined,
    clearRect: () => undefined,
    fillRect: () => {
      state.fillRect++;
    },
    strokeRect: () => undefined,
    fillText: () => undefined,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  return state;
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TrainerPage />
    </QueryClientProvider>,
  );
}

async function startSession(): Promise<void> {
  renderPage();
  // 차트 목록과 풀 질의가 **둘 다** 도착해야 "세션 시작" 이 활성된다 (빈 필터를 막는다).
  // 그 전에 누르면 아무 일도 일어나지 않으므로 활성 상태를 기다린다.
  await waitFor(() => {
    expect(screen.getByTestId(`session-set-${String(SET.id)}`)).toBeTruthy();
    expect(screen.getByTestId('session-cat-open')).toBeTruthy();
    expect((screen.getByTestId('session-start') as HTMLButtonElement).disabled).toBe(false);
  });
  fireEvent.click(screen.getByTestId('session-start'));
  await waitFor(() => {
    expect(screen.getByTestId('answer-buttons')).toBeTruthy();
  });
}

beforeEach(() => {
  calls = [];
  bodies = [];
  answered = 0;
  queue = [spotFor('As7d')];
  chosenClass = 'A7o';
  useUiStore.setState({
    sessionId: null,
    spotIndex: 0,
    phase: 'idle',
    spotShownAt: 0,
    trainerTab: 'session',
    selectedClass: null,
    hoveredClass: null,
  });
  mockFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * P3.md 0.3 / D8: **화면 어디에도** "정답/오답" 이란 말이 없다. 부정문("정답/오답이 아니라
 * …")도 위반이다 — 사용자는 그 단어를 읽는다. 출제 화면과 답 후 화면 **둘 다** 본다
 * (R1 MINOR 2: 답 후에만 검사해서 출제 화면 안내문을 놓쳤다).
 */
function expectNoRightWrongWords(): void {
  const text = document.body.textContent ?? '';
  for (const word of ['정답', '오답', '맞았', '틀렸']) expect(text).not.toContain(word);
}

describe('P3 0.3 화면에 "정답/오답" 이 없다 (D8)', () => {
  it('P3 0.3 출제 화면(마스크)에 "정답/오답" 이 없다', async () => {
    installStubContext();
    await startSession();
    // 안내문이 실제로 렌더되는지부터 확인한다 (빈 화면을 통과시키지 않는다).
    expect(document.body.textContent).toContain('EV 손실로 채점');
    expectNoRightWrongWords();
  });

  it('P3 0.3 답 후 화면에도 없다', async () => {
    installStubContext();
    await startSession();
    fireEvent.click(screen.getByTestId('answer-A'));
    await waitFor(() => {
      expect(screen.getByTestId('grade-box')).toBeTruthy();
    });
    expectNoRightWrongWords();
  });
});

describe('P3 8.3 답하기 전에는 정답이 브라우저에 없다', () => {
  it('P3 8.3 출제 화면에서 /api/charts/:id/node 요청이 0건이다', async () => {
    installStubContext();
    await startSession();

    const nodeCalls = calls.filter((c) => /\/api\/charts\/\d+\/node/.test(c.url));
    expect(nodeCalls).toEqual([]);
    // 레인지(도달) 경로로도 새지 않는다
    expect(calls.filter((c) => /\/api\/charts\/\d+\/range/.test(c.url))).toEqual([]);
  });

  it('P3 8.3 답 전에 받은 응답 어디에도 strategy / ev / reach 문자열이 없다', async () => {
    installStubContext();
    await startSession();

    for (const text of bodies) {
      // `"gradedBy":"ev"` 는 **값**이므로 키 형태로 본다 (서버 테스트와 같은 규약).
      expect(text).not.toContain('strategy');
      expect(text).not.toContain('"ev":');
      expect(text).not.toContain('reach');
      // 키 이름을 바꿔서 새는 경우도 막는다: 1326 길이 배열이 어디에도 없다.
      expect(longestArray(JSON.parse(text) as unknown)).toBeLessThan(1326);
    }
  });

  it('P3 8.3 strategy 키가 없는 응답으로도 격자가 그려진다 (레이어 0, 배경만)', async () => {
    const ctx = installStubContext();
    await startSession();

    // 마스크 셀 169개, 레이어 없음 → fillRect 는 정확히 169 번 (셀 배경만)
    expect(ctx.fillRect).toBe(HAND_CLASS_COUNT);
    expect(screen.getByRole('grid')).toBeTruthy();
  });

  it('P3 8.3 강조 셀(selected)은 히어로 콤보의 클래스다', async () => {
    installStubContext();
    await startSession();

    expect(classNameOf('As7d')).toBe('A7o'); // core 가 정하는 클래스다 (손으로 적지 않는다)
    expect(screen.getByRole('grid').getAttribute('data-selected')).toBe('A7o');
    // 히어로 카드 두 장이 화면에 있다
    expect(screen.getByTestId('hero-card-As')).toBeTruthy();
    expect(screen.getByTestId('hero-card-7d')).toBeTruthy();
  });

  it('P3 8.3 답 버튼은 노드 actions 순서 그대로다', async () => {
    installStubContext();
    await startSession();
    expect(screen.getByTestId('answer-F')).toBeTruthy();
    expect(screen.getByTestId('answer-A')).toBeTruthy();
    expect(screen.queryByTestId('grade-box')).toBeNull();
  });
});

describe('P3 8.3 답하면 같은 화면에서 마스크가 벗겨진다', () => {
  it('P3 8.3 POST /api/trainer/answer 본문이 { spotKey, action, msTaken ≥ 0 } 이다', async () => {
    installStubContext();
    await startSession();
    fireEvent.click(screen.getByTestId('answer-A'));
    await waitFor(() => {
      expect(screen.getByTestId('grade-box')).toBeTruthy();
    });

    const post = calls.find((c) => c.url === '/api/trainer/answer');
    expect(post?.method).toBe('POST');
    const body = JSON.parse(post?.body as string) as {
      sessionId: number;
      spotKey: string;
      action: string;
      msTaken: number;
    };
    expect(body.sessionId).toBe(1);
    expect(body.spotKey).toBe(`pf:${CONTENT_HASH}::As7d`);
    expect(body.action).toBe('A');
    expect(body.msTaken).toBeGreaterThanOrEqual(0);
    expect(body.msTaken).toBeLessThanOrEqual(600_000);
  });

  it('P3 8.3 답 후 격자가 레이어 있는 셀로 다시 그려진다', async () => {
    const ctx = installStubContext();
    await startSession();
    expect(ctx.fillRect).toBe(HAND_CLASS_COUNT);

    ctx.reset();
    fireEvent.click(screen.getByTestId('answer-A'));
    await waitFor(() => {
      expect(screen.getByTestId('grade-box')).toBeTruthy();
    });

    // 기대 레이어 수는 시드 데이터에서 직접 센다 (화면이 몇 개 그렸는지와 독립)
    const cells = buildChartCells(
      {
        actions: ROOT_NODE_RESPONSE.actions,
        strategy: ROOT_NODE_RESPONSE.strategy.map((r) => Float32Array.from(r)),
        ev: ROOT_NODE_RESPONSE.ev.map((r) => Float32Array.from(r)),
        reach: Float32Array.from(ROOT_NODE_RESPONSE.reach),
      },
      actionColors(ROOT_NODE_RESPONSE.actions),
    );
    const layers = cells.reduce((acc, c) => acc + c.layers.filter((l) => l.fraction > 0).length, 0);
    expect(layers).toBeGreaterThan(0);
    expect(ctx.fillRect).toBe(HAND_CLASS_COUNT + layers);
  });

  it('P3 8.3 채점 박스에 verdict 와 EV loss 가 시드 EV 에서 나온 값으로 찍힌다', async () => {
    installStubContext();
    await startSession();
    fireEvent.click(screen.getByTestId('answer-A'));
    await waitFor(() => {
      expect(screen.getByTestId('grade-box')).toBeTruthy();
    });

    const expected = gradeFromFixture(ROOT, 'A7o', 'A');
    expect(screen.getByTestId('grade-verdict').textContent).toBe(expected.verdict);
    expect(screen.getByTestId('grade-evloss').textContent).toBe(
      `EV loss ${(expected.evLossBb as number).toFixed(2)}bb`,
    );
    // 액션표에 노드의 액션 전부가 있다
    for (const a of ROOT.actions) expect(screen.getByTestId(`grade-action-${a}`)).toBeTruthy();
    // A7o 는 10bb 에서 순수 잼이므로 A 가 최선이다 (시드가 그렇게 말한다)
    expect(expected.bestAction).toBe('A');
    expect(screen.getByTestId('grade-summary').textContent).toContain('최선: A');
  });

  it('P3 8.3 답 후 액션 버튼은 비활성이다 (두 번 답할 수 없다)', async () => {
    installStubContext();
    await startSession();
    fireEvent.click(screen.getByTestId('answer-A'));
    await waitFor(() => {
      expect(screen.getByTestId('grade-box')).toBeTruthy();
    });
    expect((screen.getByTestId('answer-F') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('answer-A') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('P3 8.3 혼합 스팟에서 저빈도 액션도 Perfect 다 (D8 을 UI 까지)', () => {
  it('P3 8.3 43s 의 29% 쪽 F 를 골라도 Perfect 이고 화면에 "오답" 이 없다', async () => {
    installStubContext();
    // 43s 는 10bb 루트의 유일한 혼합 클래스다: F 29.19% / A 70.81%, EV 차이 ~0.
    const freqs = ROOT.strategy['43s'] as number[];
    expect(freqs.filter((f) => f >= 0.01).length).toBe(2);
    const fIndex = ROOT.actions.indexOf('F');
    expect(freqs[fIndex] as number).toBeLessThan(0.5); // 저빈도 쪽이다

    queue = [spotFor('4s3s')];
    chosenClass = '43s';
    useUiStore.setState({ sessionId: null, spotIndex: 0, phase: 'idle', spotShownAt: 0 });
    await startSession();
    expect(screen.getByRole('grid').getAttribute('data-selected')).toBe('43s');
    // 출제 화면에서도 검사한다 (답 후에만 보면 안내문을 놓친다 — R1 MINOR 2).
    expectNoRightWrongWords();

    fireEvent.click(screen.getByTestId('answer-F'));
    await waitFor(() => {
      expect(screen.getByTestId('grade-box')).toBeTruthy();
    });

    expect(screen.getByTestId('grade-verdict').textContent).toBe('Perfect');
    expect(screen.getByTestId('grade-mixed').textContent).toContain('혼합');
    expectNoRightWrongWords();
  });
});

describe('P3 8.1 뷰어와 트레이너가 같은 컴포넌트를 쓴다 (DESIGN 6.5)', () => {
  it('P3 8.1 ChartsPage 와 TrainerPage 가 같은 ChartNodeView export 를 참조한다', async () => {
    const fromCharts = await import('../src/pages/ChartsPage');
    const fromTrainer = await import('../src/pages/TrainerPage');
    const shared = await import('../src/components/ChartNodeView');
    // 두 페이지 모듈이 같은 모듈 인스턴스를 본다 (복사본이 아니다)
    expect(shared.ChartNodeView).toBe(ChartNodeView);
    expect(typeof fromCharts.ChartsPage).toBe('function');
    expect(typeof fromTrainer.TrainerPage).toBe('function');
    // 소스에 컴포넌트가 하나만 정의돼 있다 — 페이지가 자기 격자를 따로 그리면 여기서 잡힌다
    const chartsSrc = readFileSync(resolve(import.meta.dirname, '../src/pages/ChartsPage.tsx'), 'utf8');
    const trainerSrc = readFileSync(resolve(import.meta.dirname, '../src/pages/TrainerPage.tsx'), 'utf8');
    for (const src of [chartsSrc, trainerSrc]) {
      expect(src).toContain("import { ChartNodeView } from '../components/ChartNodeView'");
      expect(src).not.toContain('<RangeGrid');
    }
  });

  it('P3 8.1 masked 격자의 셀은 169개이고 전부 레이어가 없다', () => {
    const ctx = installStubContext();
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
        hidePanel
      />,
    );
    expect(ctx.fillRect).toBe(HAND_CLASS_COUNT); // 배경만, 레이어 0
    expect(screen.getByRole('grid').getAttribute('data-selected')).toBe('A7o');
  });
});

describe('P3 8.2 리포트 탭', () => {
  it('P3 8.2 리포트 30d 탭이 /api/trainer/report?days=30 을 부르고 표를 그린다', async () => {
    installStubContext();
    await startSession();
    fireEvent.click(screen.getByTestId('tab-report'));
    await waitFor(() => {
      expect(screen.getByTestId('report-panel')).toBeTruthy();
    });
    expect(calls.some((c) => c.url === '/api/trainer/report?days=30')).toBe(true);
  });
});
