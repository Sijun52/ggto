/**
 * `@ggto/trainer` 공개 타입. P3.md 3·6.
 *
 * 이 패키지는 HTTP/React 를 모른다. 채점·샘플링·기록은 전부 **1326 콤보** 단위이고
 * 169 는 화면이 셀을 강조할 때만 쓴다 (D4).
 */

import type { ComboIndex } from '@ggto/core';

/** P3.md 3.2. DB CHECK 목록과 같은 6개. */
export const CATEGORIES = ['open', 'vs_limp', 'vs_jam', 'vs_open', 'vs_3bet', 'vs_4bet_plus'] as const;
export type Category = (typeof CATEGORIES)[number];

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}

/** EV 채점 4개 + 빈도 채점 2개. 두 체계는 리포트에서 절대 합산되지 않는다 (P3.md 3.3). */
export const VERDICTS = ['Perfect', 'Minor', 'Mistake', 'Blunder', 'InStrategy', 'OffStrategy'] as const;
export type Verdict = (typeof VERDICTS)[number];

export type GradedBy = 'ev' | 'frequency';

/** P3.md 3.1 */
export interface Spot {
  key: string;
  contentHash: string;
  /** API 핸들 (세션 중 유효). 기록에는 저장하지 않는다 — 영구 식별자는 contentHash 다 */
  chartSetId: number;
  seq: string;
  heroPos: string;
  potBb: number;
  actions: readonly string[];
  combo: ComboIndex;
  category: Category;
  gradedBy: GradedBy;
}

export interface GradeActionRow {
  action: string;
  freq: number;
  evBb: number | null;
}

/** P3.md 3.3 */
export interface Grade {
  gradedBy: GradedBy;
  verdict: Verdict;
  evLossBb: number | null;
  chosenAction: string;
  chosenFreq: number;
  /** argmax ev (ev 가 없으면 argmax strategy) */
  bestAction: string;
  bestEvBb: number | null;
  mixed: boolean;
  actions: GradeActionRow[];
}

/** P3.md 6 */
export interface Agg {
  /** 전체 (두 채점 체계 합) */
  attempts: number;
  /** graded_by='ev' 개수 — meanEvLossBb / bb100 / mixedShare 의 분모 (P3.md 6절) */
  evGraded: number;
  meanEvLossBb: number | null;
  bb100: number | null;
  byVerdict: Record<Verdict, number>;
  mixedShare: number | null;
}

export interface CategoryAgg extends Agg {
  category: Category;
}

export interface SetAgg extends Agg {
  contentHash: string;
  /** 지금 저장소에 그 해시의 차트가 없으면 null (해시 앞 8자로 표시한다) */
  name: string | null;
}

export interface Leak {
  category: Category;
  meanEvLossBb: number;
  attempts: number;
}

export type ReportScope = { days: number } | { sessionId: number; durationMs: number };

export interface Report {
  scope: ReportScope;
  totals: Agg;
  byCategory: CategoryAgg[];
  bySet: SetAgg[];
  leaks: Leak[];
  srs: { due: number; leeches: number };
}

export interface SessionFilter {
  contentHashes?: readonly string[];
  categories?: readonly Category[];
}

export interface SessionInfo {
  sessionId: number;
  seed: number;
  count: number;
  answered: number;
  finished: boolean;
  createdAt: number;
}

/** 세션/스팟/스팟 키가 없거나 어긋난 경우. 서버가 상태 코드로 옮긴다. */
export class SpotKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpotKeyError';
  }
}

export class SessionNotFoundError extends Error {
  constructor(id: number) {
    super(`no trainer session with id ${String(id)}`);
    this.name = 'SessionNotFoundError';
  }
}

/** 답하려는 스팟이 현재 출제된 스팟이 아니다 (탭 두 개, 새로고침 경쟁). */
export class SpotMismatchError extends Error {
  constructor(expected: string | null, got: string) {
    super(
      `answer is for ${JSON.stringify(got)} but the pending spot is ${expected === null ? '(none)' : JSON.stringify(expected)}`,
    );
    this.name = 'SpotMismatchError';
  }
}

/** 기록이 가리키는 content_hash 의 차트가 저장소에서 사라졌다. */
export class MissingChartError extends Error {
  readonly contentHash: string;
  constructor(contentHash: string) {
    super(`no chart set with content hash ${contentHash}`);
    this.name = 'MissingChartError';
    this.contentHash = contentHash;
  }
}

/** 필터에 맞는 비터미널 노드가 하나도 없다 — 세션을 만들 수 없다. */
export class EmptyPoolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmptyPoolError';
  }
}

/** 세션 생성 인자가 규칙을 어겼다 (count 범위 등). 서버가 400 으로 옮긴다. */
export class TrainerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrainerInputError';
  }
}
