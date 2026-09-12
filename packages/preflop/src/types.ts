/**
 * `@ggto/preflop` 공개 타입. P2.md 4.2 / 5.1.
 *
 * 이 패키지는 HTTP/React 를 모른다. 저장 표현(f32 blob)과 파일 표현(ggto-json)을
 * 오가는 계층이고, 액션 문법·상태 기계·콤보 인덱스는 전부 `@ggto/core` 가 정본이다.
 */

import type { PreflopConfig } from '@ggto/core';

export type Rake =
  | { mode: 'none' }
  | { mode: 'pot'; pct: number; capBb: number; noFlopNoDrop: boolean };

export type Resolution = '169' | '1326';

/** EV 기준점. P2.md 3.3: 노드 시점 이후 히어로 스택의 기대 변화(bb), Fold = 0. */
export type EvBasis = 'none' | 'stack_delta_from_node';

export type GameType = 'cash' | 'mtt' | 'sng';

export type SourceKind = 'generated' | 'solver' | 'manual' | 'file';

export interface ChartSource {
  kind: SourceKind;
  name: string;
  version?: string;
  url?: string;
  params?: Record<string, unknown>;
  note?: string;
  license?: string;
}

export interface ChartSetMeta {
  id: number;
  name: string;
  gameType: GameType;
  config: PreflopConfig;
  rake: Rake;
  resolution: Resolution;
  hasEv: boolean;
  evBasis: EvBasis;
  source: ChartSource;
  formatVersion: number;
  contentHash: string;
  /** unix ms */
  importedAt: number;
}

export interface NodeMeta {
  /** 정규 액션 문자열. 루트는 '' */
  seq: string;
  heroPos: string;
  potBb: number;
  actions: string[];
  hasEv: boolean;
}

export interface NodeData extends NodeMeta {
  /** 인덱스 [a] → 길이 1326 의 f32. a 는 actions 의 인덱스 */
  strategy: Float32Array[];
  ev: Float32Array[] | null;
}

// --- ggto-json v1 (P2.md 5.1) -------------------------------------------------

export const GGTO_JSON_FORMAT = 'ggto-json';
export const GGTO_JSON_VERSION = 1;

export interface GgtoJsonNode {
  seq: string;
  actions: string[];
  /** 키 = handClassName(169) 또는 formatCard(hi)+formatCard(lo)(1326). 값 길이 = actions.length */
  strategy: Record<string, number[]>;
  ev?: Record<string, number[]>;
}

export interface GgtoJson {
  format: typeof GGTO_JSON_FORMAT;
  version: number;
  name: string;
  gameType: GameType;
  config: PreflopConfig;
  rake: Rake;
  resolution: Resolution;
  evBasis: EvBasis;
  source: ChartSource;
  nodes: GgtoJsonNode[];
}

/** 문서 안의 위치와 이유. CLI 가 그대로 찍는다 (P2.md 6.1). */
export interface ChartIssue {
  path: string;
  reason: string;
}

/**
 * 검증 실패. **첫 오류에서 멈추지 않는다** — 발견한 결함을 전부 모아 한 번에 던진다
 * (P2.md 4.3). 사람이 파일 한 번 고치고 다시 돌리게 하기 위한 것이다.
 */
export class ChartValidationError extends Error {
  readonly issues: readonly ChartIssue[];
  constructor(issues: readonly ChartIssue[]) {
    const head = issues[0];
    super(
      issues.length === 0
        ? 'chart validation failed'
        : `chart validation failed with ${String(issues.length)} issue(s); first: ${head?.path ?? ''}: ${head?.reason ?? ''}`,
    );
    this.name = 'ChartValidationError';
    this.issues = issues;
  }
}

/** 도달 레인지 질의 경로에 노드가 없다 (부분 트리). API 404 MissingNode. */
export class MissingNodeError extends Error {
  readonly seq: string;
  constructor(seq: string) {
    super(`no chart node for action sequence ${JSON.stringify(seq)}`);
    this.name = 'MissingNodeError';
    this.seq = seq;
  }
}

/** config.positions 에 없는 포지션을 물었다. API 400 BadRequest. */
export class UnknownPositionError extends Error {
  readonly pos: string;
  constructor(pos: string, known: readonly string[]) {
    super(`unknown position ${JSON.stringify(pos)} (known: ${known.join(', ')})`);
    this.name = 'UnknownPositionError';
    this.pos = pos;
  }
}

export interface ImportResult {
  id: number;
  nodes: number;
  /** 같은 content_hash 가 이미 있어서 아무것도 쓰지 않았다 */
  skipped: boolean;
}

export interface ChartRepository {
  listSets(): ChartSetMeta[];
  getSet(id: number): ChartSetMeta | null;
  /** 블롭 없는 트리 스켈레톤 */
  listNodes(setId: number): NodeMeta[];
  getNode(setId: number, seq: string): NodeData | null;
  /** P2.md 3.4. 경로 노드가 없으면 MissingNodeError */
  reach(setId: number, seq: string, pos: string): Float32Array;
  importSet(doc: GgtoJson, opts?: { source?: 'file' | 'generated' }): ImportResult;
  deleteSet(id: number): void;
  close(): void;
}
