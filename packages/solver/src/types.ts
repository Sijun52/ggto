/**
 * `@ggto/solver` 의 도메인 타입과 에러 (P4.md 3 · 5.3 · 6).
 *
 * 이 패키지는 **HTTP 도 React 도 모른다**. 서버는 `Solver`·`JobQueue`·`SolveCache`
 * 인터페이스만 본다 (P4.md 2절). `child_process` 는 `daemon/` 안에서만 쓴다.
 */

import type { Card, Range, SuitPerm } from '@ggto/core';

/** bb → 칩 환산. 고정값이다 — 바뀌면 캐시 해시가 전부 갈라진다. */
export const CHIPS_PER_BB = 100;

export type SizingPresetName = 'simple' | 'standard' | 'river-heavy';

/** 한 스트리트의 bet/raise 사이즈 문자열 (솔버 데몬의 `BetSizeOptions` 문법 그대로) */
export interface StreetSizing {
  bet: string;
  raise: string;
}

export interface Sizings {
  flop: StreetSizing;
  turn: StreetSizing;
  river: StreetSizing;
}

export type RakeConfig = { mode: 'none' } | { mode: 'pot'; pct: number; capBb: number };

/** 와이어 요청 (P4.md 3.1). `@ggto/protocol` 이 그대로 재수출한다. */
export interface SolveRequest {
  oop: string;
  ip: string;
  board: string;
  potBb: number;
  stackBb: number;
  sizings: SizingPresetName | Sizings;
  rake?: RakeConfig;
  targetExploitabilityPct?: number;
  maxIterations?: number;
  compressed?: boolean;
}

/**
 * 정규화된 설정. 여기서부터는 문자열 파싱이 없다.
 *
 * `ranges` 는 **정규 보드 기준**이다 (`perm` 적용 후). 원본 슈트로 돌아가는 것은
 * 응답을 만들 때 `@ggto/solver` 가 한다 — 서버·웹은 정규 보드를 모른다 (P4.md 2절).
 */
export interface CanonicalConfig {
  /** 정규 보드 (오름차순 카드 id) */
  board: Card[];
  /** 사용자가 보낸 원본 보드 */
  boardOriginal: Card[];
  /** 원본 → 정규 슈트 순열. 응답에는 역순열이 쓰인다 */
  perm: SuitPerm;
  /** 정규 보드 기준 1326 가중치 (카드 제거·정규화 완료) */
  ranges: [Range, Range];
  potChips: number;
  stackChips: number;
  chipsPerBb: number;
  sizings: Sizings;
  rake: RakeConfig;
  compressed: boolean;
  /** 해시에 들어가지 않는다 (P4.md 3.3-2) */
  targetExploitabilityPct: number;
  maxIterations: number;
}

export interface SolveTicket {
  hash: string;
  perm: SuitPerm;
  canonical: CanonicalConfig;
  /** 해시의 입력이 된 정규 JSON — 캐시 행의 `config_json` */
  canonicalJson: string;
}

export type SolveConfigErrorCode =
  | 'RangeSyntax'
  | 'BoardSyntax'
  | 'BoardRangeConflict'
  | 'OutOfRange'
  | 'EmptyRange';

export class SolveConfigError extends Error {
  readonly code: SolveConfigErrorCode;
  constructor(code: SolveConfigErrorCode, message: string) {
    super(message);
    this.name = 'SolveConfigError';
    this.code = code;
  }
}

/** 데몬·큐·캐시 공용 에러 코드 (P4.md 5.3 표 아래) */
export type SolverErrorCode =
  | 'BadRequest'
  | 'NoSuchLine'
  | 'NotChanceNode'
  | 'NotLoaded'
  | 'TooLarge'
  | 'Cancelled'
  | 'Stalled'
  | 'DaemonExited'
  | 'ProtocolMismatch'
  | 'SolverUnavailable'
  | 'NoSolve';

export class SolverError extends Error {
  readonly code: SolverErrorCode;
  /** `DaemonExited` 에만 있다 */
  readonly detail: Readonly<Record<string, unknown>>;
  constructor(code: SolverErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'SolverError';
    this.code = code;
    this.detail = detail;
  }
}

export interface Estimate {
  nodes: number;
  memoryBytes: number;
  memoryBytesCompressed: number;
  estSeconds: number;
}

export interface SolveOptions {
  targetExploitabilityPct: number;
  maxIterations: number;
  /** `.part` 경로. 완료 후 rename 은 호출자(캐시)가 한다 */
  outPath: string;
}

export interface ProgressEvent {
  iter: number;
  exploitabilityPct: number;
  pct: number;
}

export type ProgressSink = (p: ProgressEvent) => void;

export interface SolveSummary {
  iterations: number;
  exploitabilityPct: number;
  elapsedMs: number;
  bytes: number;
}

export type Street = 'flop' | 'turn' | 'river';

/** 정규 보드 기준 노드 (역순열 전). 데몬이 주는 모양 그대로 */
export interface CanonicalNode {
  street: Street;
  line: string;
  board: string;
  player: 'oop' | 'ip';
  potChips: number;
  stacksChips: [number, number];
  actions: string[];
  /** [actions][1326] */
  strategy: Float32Array[];
  /** [actions][1326], bb, stack_delta_from_node */
  ev: Float32Array[];
  reach: [Float32Array, Float32Array];
  equity: [Float32Array, Float32Array];
  /**
   * 두 플레이어의 레인지 가중 평균 EV (bb). **합 = 그 노드의 팟** 이다 (P4.md 3.5).
   * 1326 배열만으로는 이 항등식을 검증할 수 없어서 (상대의 EV 가 없다) 스칼라로 같이 보낸다.
   */
  evAvgBb: [number, number];
  evBasis: 'stack_delta_from_node';
}

export interface RunoutCard {
  card: string;
  evOop: number;
  evIp: number;
  equityOop: number;
  strategyRoot: number[];
}

export interface CanonicalRunouts {
  line: string;
  /**
   * 그 chance 노드의 보드 (정규 슈트, 아직 카드가 깔리기 전).
   * 라인이 턴 카드를 지났으면 4장이다 — 시작 보드로 되돌리면 딜된 카드가 사라진다
   * (P4 R1 MAJOR 1).
   */
  board: string;
  cards: RunoutCard[];
}

export interface ResultHandle {
  node(line: string): Promise<CanonicalNode>;
  runouts(line: string): Promise<CanonicalRunouts>;
  close(): Promise<void>;
}

/** DESIGN 9절의 "trait Solver". 구현 둘: `PostflopSolverCli`, `FakeSolver` */
export interface Solver {
  readonly id: string;
  estimate(cfg: CanonicalConfig): Promise<Estimate>;
  solve(
    cfg: CanonicalConfig,
    opts: SolveOptions,
    sink: ProgressSink,
    signal: AbortSignal,
  ): Promise<SolveSummary>;
  open(hash: string, path: string): Promise<ResultHandle>;
  /**
   * 그 해시의 `.bin` 이 곧 바뀌거나 사라진다 — 들고 있는 결과를 버려라.
   *
   * 재솔브(REPLACE)·삭제 뒤에도 조회 데몬이 낡은 결과를 답하던 버그의 수정이다
   * (P4 R1 MAJOR 3). 데몬 쪽 `(크기, mtime)` 검사가 **실제 보증**이고 (프로세스가
   * 죽었다 살아나도, CLI 경로로 파일이 바뀌어도 성립한다), 이 호출은 메모리를 더 일찍
   * 돌려받기 위한 것이다. 둘 다 있어야 하는 이유: 훅은 잊힐 수 있고, 데몬 검사는
   * 다음 `load` 까지 메모리를 붙잡는다.
   */
  invalidate(hash: string): Promise<void>;
}
