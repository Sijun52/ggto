/**
 * 기록 저장소 (`data/trainer.db`). SQL 은 이 파일 밖으로 나가지 않는다 (P3.md 2절 grep 게이트).
 *
 * 답 하나 = 트랜잭션 하나다 (`recordAnswer`): attempt INSERT + srs_state UPSERT +
 * answered++ + pending_key=NULL 이 함께 커밋되거나 함께 사라진다. 서버가 답 처리 중에
 * 죽어도 "채점은 됐는데 SRS 는 안 밀린" 반쪽 상태가 남으면 안 된다 (P3.md 4절).
 */

import { DatabaseSync } from 'node:sqlite';
import { migrate } from './schema.js';
import { dueCapAt, type SrsState } from './srs.js';
import type { Category, GradedBy, Verdict } from './types.js';

export interface SessionRow {
  id: number;
  createdAt: number;
  seed: number;
  count: number;
  answered: number;
  filter: string;
  pendingKey: string | null;
  pendingAt: number | null;
  finishedAt: number | null;
}

export interface AttemptInsert {
  sessionId: number;
  spotKey: string;
  contentHash: string;
  seq: string;
  combo: string;
  heroPos: string;
  category: Category;
  chosenAction: string;
  chosenFreq: number;
  gradedBy: GradedBy;
  evLossBb: number | null;
  verdict: Verdict;
  mixed: boolean;
  msTaken: number;
  createdAt: number;
}

/** 리포트 집계가 읽는 최소 컬럼. 1만 행을 200ms 안에 돌아야 하므로 블롭은 건드리지 않는다. */
export interface AttemptAgg {
  contentHash: string;
  category: Category;
  gradedBy: GradedBy;
  evLossBb: number | null;
  verdict: Verdict;
  mixed: number;
}

export interface DueSpot {
  spotKey: string;
  dueAt: number;
  lapses: number;
}

interface RawSession {
  id: number;
  created_at: number;
  seed: number;
  count: number;
  answered: number;
  filter: string;
  pending_key: string | null;
  pending_at: number | null;
  finished_at: number | null;
}

function toSession(r: RawSession): SessionRow {
  return {
    id: r.id,
    createdAt: r.created_at,
    seed: r.seed,
    count: r.count,
    answered: r.answered,
    filter: r.filter,
    pendingKey: r.pending_key,
    pendingAt: r.pending_at,
    finishedAt: r.finished_at,
  };
}

const SELECT_AGG_COLUMNS = 'SELECT content_hash, category, graded_by, ev_loss_bb, verdict, mixed FROM attempt';

export class TrainerStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    // WAL 은 파일 DB 에서만 의미가 있다 (:memory: 는 무시한다).
    if (path !== ':memory:') this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA foreign_keys = ON');
    migrate(this.#db);
  }

  createSession(args: { createdAt: number; seed: number; count: number; filter: string }): number {
    const info = this.#db
      .prepare('INSERT INTO trainer_session (created_at, seed, count, filter) VALUES (?,?,?,?)')
      .run(args.createdAt, args.seed, args.count, args.filter);
    return Number(info.lastInsertRowid);
  }

  getSession(id: number): SessionRow | null {
    const r = this.#db.prepare('SELECT * FROM trainer_session WHERE id = ?').get(id) as RawSession | undefined;
    return r === undefined ? null : toSession(r);
  }

  setPending(id: number, key: string, at: number): void {
    this.#db.prepare('UPDATE trainer_session SET pending_key = ?, pending_at = ? WHERE id = ?').run(key, at, id);
  }

  finishSession(id: number, at: number): void {
    // 이미 끝난 세션의 종료 시각을 덮어쓰지 않는다 (리포트의 durationMs 가 흔들린다).
    this.#db
      .prepare(
        'UPDATE trainer_session SET finished_at = ?, pending_key = NULL WHERE id = ? AND finished_at IS NULL',
      )
      .run(at, id);
  }

  /** 이 세션에서 이미 출제된 키 (답한 것 + 미답 pending). 재출제 방지용. */
  sessionKeys(id: number): Set<string> {
    const rows = this.#db.prepare('SELECT spot_key FROM attempt WHERE session_id = ?').all(id) as unknown as {
      spot_key: string;
    }[];
    const out = new Set(rows.map((r) => r.spot_key));
    const s = this.getSession(id);
    if (s !== null && s.pendingKey !== null) out.add(s.pendingKey);
    return out;
  }

  /**
   * 답 1건을 원자적으로 반영한다. `expectPending` 과 어긋나면 아무것도 쓰지 않고 false.
   * (두 탭이 동시에 답할 때 두 번 세지 않도록 검사와 쓰기가 한 트랜잭션 안에 있다.)
   */
  recordAnswer(a: AttemptInsert, srs: SrsState, expectPending: string): boolean {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const cur = this.#db.prepare('SELECT pending_key FROM trainer_session WHERE id = ?').get(a.sessionId) as
        | { pending_key: string | null }
        | undefined;
      if (cur === undefined || cur.pending_key !== expectPending) {
        this.#db.exec('ROLLBACK');
        return false;
      }
      this.#db
        .prepare(
          'INSERT INTO attempt (session_id, spot_key, content_hash, seq, combo, hero_pos, category, ' +
            'chosen_action, chosen_freq, graded_by, ev_loss_bb, verdict, mixed, ms_taken, created_at) ' +
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          a.sessionId,
          a.spotKey,
          a.contentHash,
          a.seq,
          a.combo,
          a.heroPos,
          a.category,
          a.chosenAction,
          a.chosenFreq,
          a.gradedBy,
          a.evLossBb,
          a.verdict,
          a.mixed ? 1 : 0,
          a.msTaken,
          a.createdAt,
        );
      this.#db
        .prepare(
          'INSERT INTO srs_state (spot_key, ease, interval_days, reps, lapses, due_at, last_verdict, updated_at) ' +
            'VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(spot_key) DO UPDATE SET ' +
            'ease=excluded.ease, interval_days=excluded.interval_days, reps=excluded.reps, ' +
            'lapses=excluded.lapses, due_at=excluded.due_at, last_verdict=excluded.last_verdict, ' +
            'updated_at=excluded.updated_at',
        )
        .run(a.spotKey, srs.ease, srs.intervalDays, srs.reps, srs.lapses, srs.dueAt, srs.lastVerdict, srs.updatedAt);
      this.#db
        .prepare(
          'UPDATE trainer_session SET answered = answered + 1, pending_key = NULL, pending_at = NULL WHERE id = ?',
        )
        .run(a.sessionId);
      this.#db.exec('COMMIT');
      return true;
    } catch (e) {
      this.#db.exec('ROLLBACK');
      throw e;
    }
  }

  /**
   * `now` 는 시계가 아니라 **읽기 상한**이다 (P3.md 5.3 R2): `due_at` 을 `MIN(due_at, now+365일)`
   * 로 꺼낸다. 간격 상한이 없던 판이 써 놓은 2^53 초과 행이 사용자 DB 에 남아 있으면
   * `node:sqlite` 가 읽는 순간 ERR_OUT_OF_RANGE 로 던지고 답이 통째로 막히기 때문이다.
   * SQLite 쪽에서 MIN 을 계산하므로 JS 로는 정상 범위 값만 건너온다.
   */
  getSrs(spotKey: string, now: number): SrsState | null {
    const r = this.#db
      .prepare(
        'SELECT ease, interval_days, reps, lapses, MIN(due_at, ?) AS due_at, last_verdict, updated_at ' +
          'FROM srs_state WHERE spot_key = ?',
      )
      .get(dueCapAt(now), spotKey) as
      | {
          ease: number;
          interval_days: number;
          reps: number;
          lapses: number;
          due_at: number;
          last_verdict: string;
          updated_at: number;
        }
      | undefined;
    if (r === undefined) return null;
    return {
      ease: r.ease,
      intervalDays: r.interval_days,
      reps: r.reps,
      lapses: r.lapses,
      dueAt: r.due_at,
      lastVerdict: r.last_verdict as Verdict,
      updatedAt: r.updated_at,
    };
  }

  /** due 인 스팟을 오래된 순으로. 필터(풀 존재·카테고리)는 호출 측이 건다 — 여기는 SQL 만 안다. */
  dueSpots(now: number, limit: number): DueSpot[] {
    const rows = this.#db
      .prepare(
        'SELECT spot_key, MIN(due_at, ?) AS due_at, lapses FROM srs_state WHERE due_at <= ? ' +
          'ORDER BY due_at, spot_key LIMIT ?',
      )
      .all(dueCapAt(now), now, limit) as unknown as { spot_key: string; due_at: number; lapses: number }[];
    return rows.map((r) => ({ spotKey: r.spot_key, dueAt: r.due_at, lapses: r.lapses }));
  }

  /** leech = lapses >= threshold. 오래된 due 우선 (P3.md 5.3-1). */
  leechSpots(now: number, minLapses: number, limit: number): DueSpot[] {
    const rows = this.#db
      .prepare(
        'SELECT spot_key, MIN(due_at, ?) AS due_at, lapses FROM srs_state WHERE lapses >= ? AND due_at <= ? ' +
          'ORDER BY due_at, spot_key LIMIT ?',
      )
      .all(dueCapAt(now), minLapses, now, limit) as unknown as {
      spot_key: string;
      due_at: number;
      lapses: number;
    }[];
    return rows.map((r) => ({ spotKey: r.spot_key, dueAt: r.due_at, lapses: r.lapses }));
  }

  srsCounts(now: number, minLapses: number): { due: number; leeches: number } {
    const due = this.#db.prepare('SELECT COUNT(*) AS n FROM srs_state WHERE due_at <= ?').get(now) as { n: number };
    const leeches = this.#db.prepare('SELECT COUNT(*) AS n FROM srs_state WHERE lapses >= ?').get(minLapses) as {
      n: number;
    };
    return { due: due.n, leeches: leeches.n };
  }

  attemptsSince(since: number): AttemptAgg[] {
    return this.#rawAttempts(`${SELECT_AGG_COLUMNS} WHERE created_at >= ?`, since);
  }

  attemptsOfSession(sessionId: number): AttemptAgg[] {
    return this.#rawAttempts(`${SELECT_AGG_COLUMNS} WHERE session_id = ?`, sessionId);
  }

  /** 카테고리별 평균 EV loss (샘플러 w4). ev 채점만 센다 — 빈도 채점에는 EV 가 없다. */
  meanEvLossByCategory(since: number): Map<Category, { mean: number; attempts: number }> {
    const rows = this.#db
      .prepare(
        'SELECT category, AVG(ev_loss_bb) AS mean, COUNT(*) AS n FROM attempt ' +
          "WHERE graded_by = 'ev' AND created_at >= ? GROUP BY category",
      )
      .all(since) as unknown as { category: string; mean: number; n: number }[];
    const out = new Map<Category, { mean: number; attempts: number }>();
    for (const r of rows) out.set(r.category as Category, { mean: r.mean, attempts: r.n });
    return out;
  }

  #rawAttempts(sql: string, param: number): AttemptAgg[] {
    const rows = this.#db.prepare(sql).all(param) as unknown as {
      content_hash: string;
      category: string;
      graded_by: string;
      ev_loss_bb: number | null;
      verdict: string;
      mixed: number;
    }[];
    return rows.map((r) => ({
      contentHash: r.content_hash,
      category: r.category as Category,
      gradedBy: r.graded_by as GradedBy,
      evLossBb: r.ev_loss_bb,
      verdict: r.verdict as Verdict,
      mixed: r.mixed,
    }));
  }

  close(): void {
    this.#db.close();
  }
}
