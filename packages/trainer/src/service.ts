/**
 * 트레이너 서비스 (P3.md 5·6·7). HTTP 를 모른다 — 서버는 이 객체만 본다.
 *
 * 시계와 난수는 전부 주입/시드다: `now()` 는 테스트가 고정하고 추첨의 모든 난수는 세션
 * `seed` 의 `createRng` 에서 나온다. 같은 DB 상태 + 같은 시드 → 같은 스팟 열이다.
 */

import { createRng, type ComboIndex, type PreflopConfig, type Rng } from '@ggto/core';
import type { ChartRepository, NodeData, Resolution } from '@ggto/preflop';
import { randomInt } from 'node:crypto';
import { grade } from './grade.js';
import type { Grade } from './types.js';
import { buildPool, collectPool, findNode, setHashes, spotKeyOf, type Pool, type PoolNode } from './pool.js';
import { drawSpotKey } from './draw.js';
import { aggregate, byCategory, bySet, leaksOf } from './report.js';
import { formatCombo, parseSpotKey } from './spotKey.js';
import { applyReview, DAY_MS, LEECH_LAPSES } from './srs.js';
import { TrainerStore, type SessionRow } from './store.js';
import {
  MissingChartError,
  SessionNotFoundError,
  SpotKeyError,
  SpotMismatchError,
  TrainerInputError,
  isCategory,
  type Category,
  type Report,
  type SessionFilter,
  type SessionInfo,
  type Spot,
} from './types.js';

/** 답 소요 시간 클램프 상한 (P3.md 7). DB CHECK 과 같은 값. */
export const MAX_MS_TAKEN = 600_000;
export const MAX_SESSION_COUNT = 500;

export interface SpotView extends Spot {
  chartName: string;
  config: PreflopConfig;
  resolution: Resolution;
}

export type NextResult =
  | { done: false; index: number; count: number; spot: SpotView }
  | { done: true; report: Report };

export interface AnswerResult {
  grade: Grade;
  spot: SpotView;
  node: NodeData;
  reach: Float32Array;
}

export interface CreateSessionRequest {
  count: number;
  /** 차트셋 content_hash 목록. 생략 = 전부 */
  contentHashes?: readonly string[];
  categories?: readonly Category[];
  seed?: number;
}

export interface AnswerRequest {
  sessionId: number;
  spotKey: string;
  action: string;
  msTaken: number;
}

export interface SessionStatus extends SessionInfo {
  report: Report;
}

export interface PoolInfo {
  categories: Category[];
  nodes: number;
  hashes: string[];
}

export interface OpenTrainerOptions {
  chartRepo: ChartRepository;
  /** `data/trainer.db` 또는 ':memory:' */
  dbPath: string;
  now?: () => number;
}

/**
 * splitmix32 의 finalizer 한 스텝. 비선형(곱셈 + xorshift)이라 입력의 1비트 차이가
 * 출력 전체로 번진다.
 */
function mix32(x: number): number {
  let t = x | 0;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
  return (t ^ (t >>> 15)) >>> 0;
}

/**
 * 세션 seed 와 문항 번호를 섞어 draw 별 rng 시드를 만든다 (P3.md 5.3 R2).
 *
 * **seed 를 먼저 비선형으로 섞은 뒤** index 를 더하고 다시 섞는다. R1 의 `(seed ^ C) ^ index`
 * 는 XOR 선형이라 `drawSeed(s, i) = drawSeed(s ^ i, 0)` 이 성립했고, 그래서 인접 시드 세션이
 * 같은 스팟 집합을 뽑았다 (시드 5000/5001 의 50문항 집합 교집합 46). 덧셈은 XOR 과 다른
 * 군이라 이 항등식이 깨진다 (P3 R1 MAJOR 2).
 */
function drawSeed(seed: number, index: number): number {
  return mix32((mix32(seed) + Math.imul(index + 1, 0x9e3779b9)) | 0);
}

export class TrainerService {
  readonly #repo: ChartRepository;
  readonly #store: TrainerStore;
  readonly #now: () => number;
  /**
   * 필터 문자열 → 풀. 세션마다 다시 만들지 않는다 — 풀은 (필터, 저장소의 해시 집합) 의
   * 함수이고 12개 노드의 reach 1326 배열을 매번 다시 읽을 이유가 없다 (실측 2.7ms/회).
   */
  #pools = new Map<string, Pool>();
  /** 풀 캐시를 만든 시점의 해시 집합. 바뀌면 전부 버린다 (시드 재임포트). */
  #poolHashes: string[] = [];

  constructor(opts: OpenTrainerOptions) {
    this.#repo = opts.chartRepo;
    this.#store = new TrainerStore(opts.dbPath);
    this.#now = opts.now ?? ((): number => Date.now());
  }

  /**
   * 필터 없는 전체 풀 (세션 시작 폼이 고를 수 있는 카테고리 목록).
   * 시드 전에는 빈 목록이다 — 폼을 그리는 질의는 차트가 없다고 실패하면 안 된다.
   */
  poolInfo(): PoolInfo {
    const pool = collectPool(this.#repo, {});
    return { categories: pool.categories, nodes: pool.nodes.length, hashes: pool.hashes };
  }

  /**
   * `chart_set.id` (API 핸들) → `content_hash` (영구 식별자). 세션 필터는 해시로만 저장한다
   * — id 는 `npm run seed` 마다 달라질 수 있다 (P2 4.3).
   */
  hashesForSetIds(ids: readonly number[]): string[] {
    return ids.map((id) => {
      const set = this.#repo.getSet(id);
      if (set === null) throw new TrainerInputError(`no chart set with id ${String(id)}`);
      return set.contentHash;
    });
  }

  createSession(req: CreateSessionRequest): SessionInfo {
    if (!Number.isInteger(req.count) || req.count < 1 || req.count > MAX_SESSION_COUNT) {
      throw new TrainerInputError(`count must be an integer in [1, ${String(MAX_SESSION_COUNT)}]`);
    }
    const filter: SessionFilter = {};
    if (req.contentHashes !== undefined) filter.contentHashes = [...req.contentHashes];
    if (req.categories !== undefined) filter.categories = [...req.categories];
    // 풀이 비면 세션을 만들지 않는다 (EmptyPoolError → 400). 만들고 나서 next 가 실패하면
    // 사용자는 이유를 알 수 없다.
    const filterJson = JSON.stringify(filter);
    this.#poolFor(filterJson);
    // 재현 가능한 세션이 목적이므로 시드는 기록한다. Math.random 은 쓰지 않는다 (P3.md 1절).
    const seed = req.seed ?? randomInt(0, 2 ** 31 - 1);
    const createdAt = this.#now();
    const id = this.#store.createSession({ createdAt, seed, count: req.count, filter: filterJson });
    return { sessionId: id, seed, count: req.count, answered: 0, finished: false, createdAt };
  }

  next(sessionId: number): NextResult {
    const session = this.#requireSession(sessionId);
    const now = this.#now();
    if (session.answered >= session.count) {
      this.#store.finishSession(sessionId, now);
      return { done: true, report: this.report({ sessionId }) };
    }
    const pool = this.#poolFor(session.filter);

    if (session.pendingKey !== null) {
      const view = this.#viewFor(pool, session.pendingKey);
      // 재임포트로 그 노드가 사라졌으면 pending 을 버리고 새로 뽑는다 (P3.md 13 시나리오).
      if (view !== null) return { done: false, index: session.answered, count: session.count, spot: view };
    }

    const rng = createRng(drawSeed(session.seed, session.answered));
    const used = this.#store.sessionKeys(sessionId);
    const key = drawSpotKey({ store: this.#store, pool, rng, used, now });
    this.#store.setPending(sessionId, key, now);
    const view = this.#viewFor(pool, key);
    if (view === null) throw new MissingChartError(parseSpotKey(key).contentHash);
    return { done: false, index: session.answered, count: session.count, spot: view };
  }

  answer(req: AnswerRequest): AnswerResult {
    const session = this.#requireSession(req.sessionId);
    if (session.pendingKey !== req.spotKey) {
      throw new SpotMismatchError(session.pendingKey, req.spotKey);
    }
    const parsed = parseSpotKey(req.spotKey);
    const pool = this.#poolFor(session.filter);
    const node = findNode(pool, parsed.contentHash, parsed.seq);
    if (node === null) throw new MissingChartError(parsed.contentHash);
    const data = this.#repo.getNode(node.chartSetId, node.seq);
    if (data === null) throw new MissingChartError(parsed.contentHash);

    const g = grade({
      actions: data.actions,
      strategy: data.strategy,
      ev: data.ev,
      combo: parsed.combo,
      chosen: req.action,
      gradedBy: node.gradedBy,
    });

    const now = this.#now();
    const srs = applyReview(this.#store.getSrs(req.spotKey, now), g.verdict, now);
    const msTaken = Math.min(MAX_MS_TAKEN, Math.max(0, Math.round(req.msTaken)));
    const ok = this.#store.recordAnswer(
      {
        sessionId: req.sessionId,
        spotKey: req.spotKey,
        contentHash: parsed.contentHash,
        seq: parsed.seq,
        combo: formatCombo(parsed.combo),
        heroPos: node.heroPos,
        category: node.category,
        chosenAction: g.chosenAction,
        chosenFreq: g.chosenFreq,
        gradedBy: g.gradedBy,
        evLossBb: g.evLossBb,
        verdict: g.verdict,
        mixed: g.mixed,
        msTaken,
        createdAt: now,
      },
      srs,
      req.spotKey,
    );
    // 같은 스팟에 두 번 답한 경쟁 상태. 두 번 세지 않고 거절한다.
    if (!ok) throw new SpotMismatchError(this.#store.getSession(req.sessionId)?.pendingKey ?? null, req.spotKey);

    return { grade: g, spot: this.#spotOf(node, parsed.combo), node: data, reach: node.reachHero };
  }

  sessionStatus(sessionId: number): SessionStatus {
    const s = this.#requireSession(sessionId);
    return {
      sessionId: s.id,
      seed: s.seed,
      count: s.count,
      answered: s.answered,
      finished: s.finishedAt !== null || s.answered >= s.count,
      createdAt: s.createdAt,
      report: this.report({ sessionId }),
    };
  }

  report(scope: { days: number } | { sessionId: number }): Report {
    const now = this.#now();
    const names = new Map(this.#repo.listSets().map((s) => [s.contentHash, s.name]));
    const nameOf = (hash: string): string | null => names.get(hash) ?? null;

    if ('sessionId' in scope) {
      const s = this.#requireSession(scope.sessionId);
      const rows = this.#store.attemptsOfSession(scope.sessionId);
      const cats = byCategory(rows);
      return {
        scope: { sessionId: scope.sessionId, durationMs: Math.max(0, (s.finishedAt ?? now) - s.createdAt) },
        totals: aggregate(rows),
        byCategory: cats,
        bySet: bySet(rows, nameOf),
        leaks: leaksOf(cats),
        srs: this.#store.srsCounts(now, LEECH_LAPSES),
      };
    }
    const rows = this.#store.attemptsSince(now - scope.days * DAY_MS);
    const cats = byCategory(rows);
    return {
      scope: { days: scope.days },
      totals: aggregate(rows),
      byCategory: cats,
      bySet: bySet(rows, nameOf),
      leaks: leaksOf(cats),
      srs: this.#store.srsCounts(now, LEECH_LAPSES),
    };
  }

  close(): void {
    this.#store.close();
  }

  // --- 내부 ---------------------------------------------------------------

  #requireSession(id: number): SessionRow {
    const s = this.#store.getSession(id);
    if (s === null) throw new SessionNotFoundError(id);
    return s;
  }

  /** 필터의 풀. 저장소의 해시 집합이 바뀌었으면 (재시드) 캐시를 통째로 버린다 (P3.md 5.1). */
  #poolFor(filterJson: string): Pool {
    const hashes = setHashes(this.#repo);
    if (hashes.length !== this.#poolHashes.length || hashes.some((h, i) => h !== this.#poolHashes[i])) {
      this.#pools.clear();
      this.#poolHashes = hashes;
    }
    const cached = this.#pools.get(filterJson);
    if (cached !== undefined) return cached;
    const pool = buildPool(this.#repo, parseFilter(filterJson));
    this.#pools.set(filterJson, pool);
    return pool;
  }

  #viewFor(pool: Pool, key: string): SpotView | null {
    const parsed = parseSpotKeySafe(key);
    if (parsed === null) return null;
    const node = findNode(pool, parsed.contentHash, parsed.seq);
    return node === null ? null : this.#spotOf(node, parsed.combo);
  }

  #spotOf(node: PoolNode, combo: ComboIndex): SpotView {
    return {
      key: spotKeyOf(node, combo),
      contentHash: node.contentHash,
      chartSetId: node.chartSetId,
      seq: node.seq,
      heroPos: node.heroPos,
      potBb: node.potBb,
      actions: node.actions,
      combo,
      category: node.category,
      gradedBy: node.gradedBy,
      chartName: node.chartName,
      config: node.config,
      resolution: node.resolution,
    };
  }
}

function parseSpotKeySafe(key: string): { contentHash: string; seq: string; combo: ComboIndex } | null {
  try {
    return parseSpotKey(key);
  } catch (e) {
    // 저장된 키가 이 빌드의 문법으로 안 읽히면 그 스팟은 큐에서 빠질 뿐이다 (기록은 남는다).
    if (e instanceof SpotKeyError) return null;
    throw e;
  }
}

function parseFilter(json: string): SessionFilter {
  const raw = JSON.parse(json) as { contentHashes?: unknown; categories?: unknown };
  const out: SessionFilter = {};
  if (Array.isArray(raw.contentHashes)) out.contentHashes = raw.contentHashes.filter((h): h is string => typeof h === 'string');
  if (Array.isArray(raw.categories)) out.categories = raw.categories.filter(isCategory);
  return out;
}

export function openTrainer(opts: OpenTrainerOptions): TrainerService {
  return new TrainerService(opts);
}
