/**
 * @ggto/protocol — 서버/웹이 공유하는 HTTP API 계약. P1.md 3.3.
 *
 * 런타임 코드는 상수 하나(`API_LIMITS`)뿐이고 import 가 없다.
 * `@ggto/core` 의 타입(Range, ComboIndex …)을 여기서 재선언하지 않는다:
 * 와이어 형식은 JSON 이라 이미 core 의 표현(Float32Array)과 다르고,
 * 두 곳에 같은 뜻의 타입을 두면 둘이 갈라질 때 아무도 모른다.
 */

/** 전 엔드포인트 공통 에러 봉투. `code` 는 도메인 에러 클래스 이름 그대로. */
export interface ErrorEnvelope {
  error: { code: string; message: string };
}

export interface HealthResponse {
  ok: true;
  /** packages/server 의 package.json version */
  version: string;
  /** process.version */
  node: string;
}

export interface ParseRangeRequest {
  text: string;
}

export interface ParseRangeResponse {
  /** 정규형 에코 (formatRange(parseRange(text))) */
  text: string;
  /** weight > 0 인 콤보 수 */
  comboCount: number;
  totalWeight: number;
  /**
   * 길이 1326. float32 값을 JSON number 로 보낸다.
   * f32 → f64 → 10진 문자열 → f32 는 항등이므로 클라이언트의
   * `Float32Array.from(weights)` 는 서버의 Range 와 비트 단위로 같다.
   */
  weights: number[];
}

export interface EquityRequest {
  hero: string;
  villain: string;
  /** "Ks7h2d" 붙여쓰기. "" = 프리플랍 */
  board: string;
  mode: EquityMode;
  samples?: number;
  seed?: number;
}

export type EquityMode = 'exact' | 'monte-carlo';

export interface EquityResponse {
  hero: number;
  villain: number;
  tie: number;
  heroWin: number;
  villainWin: number;
  matchups: number;
  /** 1326. core 의 NaN(레인지 밖/보드 충돌)은 JSON 에 없으므로 null */
  heroPerCombo: (number | null)[];
  villainPerCombo: (number | null)[];
  mode: EquityMode;
  /** monte-carlo 일 때만 값이 있다 */
  samples: number | null;
  /** monte-carlo 일 때 서버가 실제로 쓴 시드 (생략 시 서버가 정한다). 재현용 */
  seed: number | null;
  /** 정규형 에코 (formatCards) */
  board: string;
}

export const API_LIMITS = {
  bodyBytes: 65536,
  rangeTextChars: 4000,
  maxSamples: 1_000_000,
} as const;

export const API_ROUTES = {
  health: '/api/health',
  rangeParse: '/api/range/parse',
  rangeEquity: '/api/range/equity',
  charts: '/api/charts',
  trainer: '/api/trainer',
} as const;

// --- P2: 프리플랍 차트 (P2.md 8) ------------------------------------------

/**
 * `PreflopConfig` 의 와이어 표현. core 타입을 여기서 import 하지 않는 이유는 P1 과 같다
 * (프로토콜 패키지는 런타임 의존성이 0 이어야 한다). 대신 서버가 컴파일 타임에
 * `ChartSetMeta` → `ChartSetDto` 할당 가능성을 단언해 두 선언이 갈라지면 타입체크가 깨진다.
 */
export interface PreflopConfigDto {
  positions: readonly string[];
  blinds: readonly { pos: string; amount: number }[];
  ante: { mode: 'none' } | { mode: 'per_player'; amount: number } | { mode: 'bb_ante'; amount: number };
  stack: number;
}

export type RakeDto = { mode: 'none' } | { mode: 'pot'; pct: number; capBb: number; noFlopNoDrop: boolean };

export interface ChartSourceDto {
  kind: 'generated' | 'solver' | 'manual' | 'file';
  name: string;
  version?: string;
  url?: string;
  params?: Record<string, unknown>;
  note?: string;
  license?: string;
}

export interface ChartSetDto {
  id: number;
  name: string;
  gameType: 'cash' | 'mtt' | 'sng';
  config: PreflopConfigDto;
  rake: RakeDto;
  resolution: '169' | '1326';
  hasEv: boolean;
  evBasis: 'none' | 'stack_delta_from_node';
  source: ChartSourceDto;
  formatVersion: number;
  contentHash: string;
  importedAt: number;
}

export interface NodeMetaDto {
  /** 정규 액션 문자열. 루트는 '' */
  seq: string;
  heroPos: string;
  potBb: number;
  actions: string[];
  hasEv: boolean;
}

export interface ChartListResponse {
  sets: ChartSetDto[];
}

/** 트리 스켈레톤 (블롭 없음) */
export interface ChartDetailResponse extends ChartSetDto {
  nodes: NodeMetaDto[];
}

/**
 * 노드 하나. `strategy[a]` 는 길이 1326 이고 `reach` 는 히어로 포지션의 도달 레인지다.
 * P2 는 JSON number[][] 로 보낸다 (5×1326 ≈ 60KB, 디버깅 가능). octet-stream 은 P5 부터.
 */
export interface ChartNodeResponse extends NodeMetaDto {
  strategy: number[][];
  ev: number[][] | null;
  reach: number[];
}

export interface ChartRangeResponse {
  pos: string;
  seq: string;
  /** 1326 */
  weights: number[];
}

// --- P3: 트레이너 (P3.md 7) ------------------------------------------------

/** P3.md 3.2. 상태 기계에서 파생된다 — 화면이 문자열을 세지 않는다. */
export type Category = 'open' | 'vs_limp' | 'vs_jam' | 'vs_open' | 'vs_3bet' | 'vs_4bet_plus';

/** EV 채점 4개 + 빈도 채점 2개. 두 체계는 리포트에서 합산되지 않는다 (D8). */
export type Verdict = 'Perfect' | 'Minor' | 'Mistake' | 'Blunder' | 'InStrategy' | 'OffStrategy';

export type GradedBy = 'ev' | 'frequency';

/**
 * 출제된 스팟. **`strategy`/`ev`/`reach` 가 없다** — 답하기 전에 정답이 클라이언트로 가면
 * 트레이너가 아니다 (P3.md 7). 격자는 이 DTO 만으로 마스크 상태를 그린다.
 */
export interface SpotDto {
  spotKey: string;
  chartSetId: number;
  chartName: string;
  contentHash: string;
  seq: string;
  heroPos: string;
  potBb: number;
  actions: string[];
  /** 1326 키 규약: formatCard(hi)+formatCard(lo), 예 'AsKh' */
  combo: string;
  category: Category;
  gradedBy: GradedBy;
  config: PreflopConfigDto;
  resolution: '169' | '1326';
}

export interface GradeActionDto {
  action: string;
  freq: number;
  evBb: number | null;
}

export interface GradeDto {
  gradedBy: GradedBy;
  verdict: Verdict;
  /** frequency 채점이면 null */
  evLossBb: number | null;
  chosenAction: string;
  chosenFreq: number;
  bestAction: string;
  bestEvBb: number | null;
  mixed: boolean;
  actions: GradeActionDto[];
}

export interface AggDto {
  attempts: number;
  /** meanEvLossBb / bb100 / mixedShare 의 분모 */
  evGraded: number;
  meanEvLossBb: number | null;
  bb100: number | null;
  byVerdict: Record<Verdict, number>;
  mixedShare: number | null;
}

export interface CategoryAggDto extends AggDto {
  category: Category;
}

export interface SetAggDto extends AggDto {
  contentHash: string;
  /** 지금 저장소에 그 해시의 차트가 없으면 null */
  name: string | null;
}

export interface LeakDto {
  category: Category;
  meanEvLossBb: number;
  attempts: number;
}

export interface ReportDto {
  scope: { days: number } | { sessionId: number; durationMs: number };
  totals: AggDto;
  byCategory: CategoryAggDto[];
  bySet: SetAggDto[];
  leaks: LeakDto[];
  srs: { due: number; leeches: number };
}

export interface TrainerSessionRequest {
  count: number;
  /** chart_set.id 목록. 서버가 생성 시 content_hash 로 바꿔 저장한다 */
  sets?: number[];
  categories?: Category[];
  seed?: number;
}

export interface TrainerSessionResponse {
  sessionId: number;
  seed: number;
  count: number;
}

export type TrainerNextResponse =
  | { done: false; index: number; count: number; spot: SpotDto }
  | { done: true; report: ReportDto };

export interface TrainerAnswerRequest {
  sessionId: number;
  spotKey: string;
  action: string;
  msTaken: number;
}

/** `node` 는 뷰어의 노드 응답과 **같은 모양**이다 — 해설 화면이 뷰어 컴포넌트를 그대로 쓴다. */
export interface TrainerAnswerResponse {
  grade: GradeDto;
  node: ChartNodeResponse;
}

export interface TrainerSessionStatusResponse {
  sessionId: number;
  count: number;
  answered: number;
  finished: boolean;
  report: ReportDto;
}

/** 세션 시작 폼이 고를 수 있는 것 (풀에 실제로 있는 카테고리만 보여주기 위한 것). */
export interface TrainerPoolResponse {
  categories: Category[];
  nodes: number;
}

// --- P4 솔버 (P4.md 3.1 · 5.4 · 7) ------------------------------------------
//
// 와이어 타입만 둔다. `@ggto/protocol` 은 런타임 의존성이 0 이므로 `@ggto/solver` 의
// 도메인 타입을 import 하지 않는다 — 대신 서버 라우트가 컴파일 타임에 둘의 호환을 본다.

export type SizingPresetName = 'simple' | 'standard' | 'river-heavy';

export interface StreetSizingDto {
  bet: string;
  raise: string;
}

export interface SizingsDto {
  flop: StreetSizingDto;
  turn: StreetSizingDto;
  river: StreetSizingDto;
}

/**
 * 솔브의 레이크. 프리플랍 차트의 `RakeDto` 와 **다르다**: 포스트플랍 솔버는
 * `noFlopNoDrop` 을 모른다 (플랍이 이미 깔린 상태에서 시작한다).
 */
export type SolveRakeDto = { mode: 'none' } | { mode: 'pot'; pct: number; capBb: number };

export interface SolveRequestDto {
  oop: string;
  ip: string;
  /** "Ks7h2h" 3..5장 붙여쓰기 */
  board: string;
  potBb: number;
  stackBb: number;
  /**
   * **HTTP API 는 프리셋 이름만 받는다** (P4.md 3.2 / P5 12절 R2 MINOR 1). 커스텀 객체는
   * `npm run solve` CLI 전용이다 — 쿼리로 표현할 수 없어 탐색기가 표기 모드로 열 수 없다.
   * 타입에 유니온이 남아 있는 것은 CLI 와 요청 타입을 공유하기 때문이고, 라우트가 400 으로 막는다.
   */
  sizings: SizingPresetName | SizingsDto;
  rake?: SolveRakeDto;
  targetExploitabilityPct?: number;
  maxIterations?: number;
  compressed?: boolean;
  /** 없으면 estimate 만 하고 큐에 넣지 않는다 (P4.md 5.2 사전 확인) */
  confirm?: boolean;
}

export type SolveJobStatus =
  | 'estimated'
  | 'queued'
  | 'estimating'
  | 'running'
  | 'saving'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface SolvePostResponse {
  jobId: string | null;
  hash: string;
  cached: boolean;
  status: SolveJobStatus;
  estMemoryBytes: number;
  estSeconds: number;
  /** 사용자가 보낸 원본 슈트 (정규 보드가 아니다) */
  board: string;
}

/** 169 격자용 집계 (P2.md 3.5 규칙, 도달 가중) */
export interface SolveAggregateDto {
  strategy: number[][];
  ev: number[][];
  reach: number[][];
}

/** base64 는 전부 **f32 little-endian** 이다 (D7 — f16 금지) */
export interface SolveNodeResponse {
  street: 'flop' | 'turn' | 'river';
  line: string;
  board: string;
  player: 'oop' | 'ip';
  potChips: number;
  stacksChips: [number, number];
  actions: string[];
  /** base64 f32[actions][1326] */
  strategy: string;
  /** base64 f32[actions][1326], bb, stack_delta_from_node */
  ev: string;
  reach: [string, string];
  equity: [string, string];
  /** [oop, ip] 레인지 가중 평균 EV (bb). 합 = `potChips / 100` (P4.md 3.5) */
  evAvgBb: [number, number];
  /**
   * 도달 질량이 0 인 노드면 `false` 이고 `evAvgBb` 는 `[0, 0]` 이다 (P4 R1 MINOR 11).
   * 화면은 이때 숫자가 아니라 `—` 를 그린다 — 0 을 "EV 가 0" 으로 읽으면 거짓말이다.
   */
  reachable: boolean;
  aggregate: SolveAggregateDto;
  evBasis: 'stack_delta_from_node';
  /**
   * 이 응답에 적용된 **원본 → 정규** 슈트 순열. 항등 `[0,1,2,3]` 이면 요청이 설정 쿼리를
   * 주지 않아 응답이 **정규 보드 공간**이라는 뜻이다 (P4 R1 MAJOR 2 의 계약).
   */
  perm: [number, number, number, number];
}

export interface SolveRunoutCardDto {
  card: string;
  evOop: number;
  evIp: number;
  equityOop: number;
  strategyRoot: number[];
}

export interface SolveRunoutsResponse {
  line: string;
  /** chance 노드의 보드 — 라인이 턴 카드를 지났으면 4장이다 */
  board: string;
  cards: SolveRunoutCardDto[];
  /** `SolveNodeResponse.perm` 과 같은 의미 */
  perm: [number, number, number, number];
}

export interface SolveListItemDto {
  hash: string;
  boardCanonical: string;
  street: 'flop' | 'turn' | 'river';
  potBb: number;
  stackBb: number;
  sizings: string;
  compressed: boolean;
  exploitability: number;
  iterations: number;
  bytes: number;
  solver: string;
  createdAt: number;
  lastUsedAt: number;
  elapsedMs: number;
}

export interface SolveListResponse {
  solves: SolveListItemDto[];
  totalBytes: number;
  capBytes: number;
}
