/**
 * 리포트 집계 (P3.md 6절).
 *
 * **두 채점 체계는 절대 합산되지 않는다** (D8). `InStrategy`/`OffStrategy` 는 개수만 세고
 * EV 평균에는 들어가지 않는다 — EV loss 가 `null` 인 시도를 0 으로 취급하면 "EV 없는 차트로
 * 연습할수록 실력이 좋아 보이는" 리포트가 된다.
 */

import type { ChartRepository } from '@ggto/preflop';
import { DAY_MS, LEECH_LAPSES } from './srs.js';
import type { AttemptAgg, SessionRow, TrainerStore } from './store.js';
import { CATEGORIES, VERDICTS, type Agg, type Category, type CategoryAgg, type Leak, type Report, type SetAgg, type Verdict } from './types.js';

/** 리크로 보기 위한 최소 ev 채점 횟수 (P3.md 6). 표본이 적으면 평균이 흔들린다. */
export const LEAK_MIN_ATTEMPTS = 20;
/** 리크 임계 평균 EV loss (bb). */
export const LEAK_MIN_MEAN_BB = 0.1;

function emptyVerdicts(): Record<Verdict, number> {
  const out = {} as Record<Verdict, number>;
  for (const v of VERDICTS) out[v] = 0;
  return out;
}

/**
 * `evGraded` 가 `meanEvLossBb`·`bb100`·`mixedShare` 의 분모다 (P3.md 6절).
 * `attempts` 와 `byVerdict` 만 두 체계를 합산한다.
 */
export function aggregate(rows: readonly AttemptAgg[]): Agg {
  const byVerdict = emptyVerdicts();
  let evGraded = 0;
  let evLossSum = 0;
  let mixedEv = 0;
  for (const r of rows) {
    byVerdict[r.verdict] += 1;
    if (r.gradedBy !== 'ev' || r.evLossBb === null) continue;
    evGraded++;
    evLossSum += r.evLossBb;
    if (r.mixed === 1) mixedEv++;
  }
  const mean = evGraded === 0 ? null : evLossSum / evGraded;
  return {
    attempts: rows.length,
    evGraded,
    meanEvLossBb: mean,
    bb100: mean === null ? null : mean * 100,
    byVerdict,
    mixedShare: evGraded === 0 ? null : mixedEv / evGraded,
  };
}

function groupBy<K>(rows: readonly AttemptAgg[], key: (r: AttemptAgg) => K): Map<K, AttemptAgg[]> {
  const out = new Map<K, AttemptAgg[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list === undefined) out.set(k, [r]);
    else list.push(r);
  }
  return out;
}

/** 카테고리 순서는 `CATEGORIES` 고정 순서 (리포트가 실행마다 뒤섞이지 않게). */
export function byCategory(rows: readonly AttemptAgg[]): CategoryAgg[] {
  const groups = groupBy(rows, (r) => r.category);
  const out: CategoryAgg[] = [];
  for (const c of CATEGORIES) {
    const list = groups.get(c);
    if (list === undefined) continue;
    out.push({ category: c, ...aggregate(list) });
  }
  return out;
}

export function bySet(rows: readonly AttemptAgg[], nameOf: (hash: string) => string | null): SetAgg[] {
  const groups = groupBy(rows, (r) => r.contentHash);
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([hash, list]) => ({ contentHash: hash, name: nameOf(hash), ...aggregate(list) }));
}

/** ev 채점 ≥ 20 이고 평균 ≥ 0.10bb 인 카테고리. 평균 내림차순. */
export function leaksOf(cats: readonly CategoryAgg[]): Leak[] {
  const out: Leak[] = [];
  for (const c of cats) {
    if (c.evGraded < LEAK_MIN_ATTEMPTS) continue;
    const mean = c.meanEvLossBb;
    if (mean === null || mean < LEAK_MIN_MEAN_BB) continue;
    out.push({ category: c.category, meanEvLossBb: mean, attempts: c.evGraded });
  }
  return out.sort((a, b) => b.meanEvLossBb - a.meanEvLossBb);
}



// --- 조립 -------------------------------------------------------------------

export interface BuildReportInput {
  repo: ChartRepository;
  store: TrainerStore;
  now: number;
  /** 세션 스코프면 그 행, 30일 스코프면 `null` */
  session: SessionRow | null;
  scope: { days: number } | { sessionId: number };
}

/**
 * 한 리포트를 만든다 (P3.md 6절). 두 스코프의 차이는 **행 집합과 scope 필드뿐**이고
 * 집계 파이프라인(aggregate → byCategory → bySet → leaksOf)은 같다 —
 * `service.ts` 에 두 벌로 적혀 있던 것을 여기로 옮겼다 (P3 R1 MINOR 3).
 */
export function buildReport(input: BuildReportInput): Report {
  const { repo, store, now, session, scope } = input;
  const names = new Map(repo.listSets().map((s) => [s.contentHash, s.name]));
  const nameOf = (hash: string): string | null => names.get(hash) ?? null;

  const rows =
    session === null || !('sessionId' in scope)
      ? store.attemptsSince(now - ('days' in scope ? scope.days : 0) * DAY_MS)
      : store.attemptsOfSession(scope.sessionId);
  const cats = byCategory(rows);
  const reportScope: Report['scope'] =
    session === null || !('sessionId' in scope)
      ? { days: 'days' in scope ? scope.days : 0 }
      : { sessionId: scope.sessionId, durationMs: Math.max(0, (session.finishedAt ?? now) - session.createdAt) };

  return {
    scope: reportScope,
    totals: aggregate(rows),
    byCategory: cats,
    bySet: bySet(rows, nameOf),
    leaks: leaksOf(cats),
    srs: store.srsCounts(now, LEECH_LAPSES),
  };
}
