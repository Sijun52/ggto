/**
 * 기록 저장소 (`data/trainer.db`). SQL 은 이 파일 밖으로 나가지 않는다 (P3.md 2절 grep 게이트).
 *
 * 답 하나 = 트랜잭션 하나다 (`recordAnswer`): attempt INSERT + srs_state UPSERT +
 * answered++ + pending_key=NULL 이 함께 커밋되거나 함께 사라진다. 서버가 답 처리 중에
 * 죽어도 "채점은 됐는데 SRS 는 안 밀린" 반쪽 상태가 남으면 안 된다 (P3.md 4절).
 */

import { DatabaseSync } from 'node:sqlite';
import { migrate } from './schema.js';
import { dueCapAt, DAY_MS, MAX_INTERVAL_DAYS, type SrsState } from './srs.js';
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

/** `applyAliases` 한 건의 결과 (P7.md 7.2 의 출력) */
export interface AliasApplyResult {
  from: string;
  to: string;
  attempts: number;
  srs: number;
  /** PK 충돌로 버린 `srs_state` 행 수 */
  srsConflicts: number;
  sessions: number;
  /** 이미 `hash_alias` 에 있어 건너뛴 별칭 */
  alreadyApplied: boolean;
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
    this.#clampRunawayIntervals();
  }

  /**
   * 상한(`MAX_INTERVAL_DAYS`) 도입 **전에** 저장된 폭주 행을 되돌린다 (P3 R2 MINOR 3).
   *
   * 상한이 없던 빌드에서 Perfect 를 16번 받은 스팟은 `interval_days` 가 1.2e8 까지 자랐고
   * `due_at = now + interval × 86_400_000` 이 2^53 을 넘어 `node:sqlite` 가 정수를 잃는다.
   * 새 코드는 더 이상 그런 값을 **쓰지** 않지만 이미 쓰인 행은 영원히 due 가 되지 않아
   * 그 스팟이 SRS 큐에서 사라진다. 스키마 변경이 아니라 **데이터 보정**이므로
   * `user_version` 은 건드리지 않는다 — 멱등이고 (두 번째 실행은 0행), 정상 DB 에서는
   * 조건에 걸리는 행이 없어 비용이 인덱스 없는 스캔 한 번뿐이다.
   */
  #clampRunawayIntervals(): void {
    const info = this.#db
      .prepare(
        `UPDATE srs_state
            SET interval_days = ?,
                due_at = updated_at + ?
          WHERE interval_days > ?`,
      )
      .run(MAX_INTERVAL_DAYS, MAX_INTERVAL_DAYS * DAY_MS, MAX_INTERVAL_DAYS);
    if (Number(info.changes) > 0) {
      console.error(`[ggto] srs_state 폭주 행 ${String(Number(info.changes))}개를 ${String(MAX_INTERVAL_DAYS)}일로 보정했다`);
    }
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

  /**
   * 은퇴한 차트의 기록을 새 `content_hash` 로 옮긴다 (P7.md 7.2, D35). **단일 트랜잭션**이다 —
   * attempt 만 옮기고 srs 를 놓치면 같은 스팟의 복습 이력이 둘로 갈라진다.
   *
   * 멱등: `hash_alias` 에 이미 있는 별칭은 건너뛴다. 두 번째 실행은 전부 0 행이다.
   *
   * `spot_key` = `pf:<64자 해시>:<seq>:<combo>` 이므로 `'pf:'`(3) + 64 = 67, 68번째부터가
   * `:<seq>:<combo>` 다 (P3.md 3.1 의 키 문법이 이 substr 의 근거다).
   *
   * `srs_state` 는 `spot_key` 가 PK 라서, 사용자가 마이그레이션 전에 **새** 차트로 같은
   * 스팟을 이미 풀었으면 충돌한다. 그때는 `updated_at` 이 늦은 행을 남긴다 (동점이면 새 행).
   */
  applyAliases(aliases: readonly { from: string; to: string }[], now: number): AliasApplyResult[] {
    const out: AliasApplyResult[] = [];
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const known = new Set(
        (this.#db.prepare('SELECT from_hash FROM hash_alias').all() as unknown as { from_hash: string }[]).map(
          (r) => r.from_hash,
        ),
      );
      for (const alias of aliases) {
        if (known.has(alias.from)) {
          out.push({ from: alias.from, to: alias.to, attempts: 0, srs: 0, srsConflicts: 0, sessions: 0, alreadyApplied: true });
          continue;
        }
        const attempts = Number(
          this.#db
            .prepare(
              "UPDATE attempt SET content_hash = :to, spot_key = 'pf:' || :to || substr(spot_key, 68) " +
                'WHERE content_hash = :from',
            )
            .run({ from: alias.from, to: alias.to }).changes,
        );
        // 1) 새 해시 쪽 행이 더 오래됐으면 그 행을 지운다 (옛 행이 이긴다).
        const droppedNew = Number(
          this.#db
            .prepare(
              'DELETE FROM srs_state WHERE spot_key IN (' +
                "  SELECT t.spot_key FROM srs_state t JOIN srs_state s ON t.spot_key = 'pf:' || :to || substr(s.spot_key, 68)" +
                "   WHERE s.spot_key LIKE 'pf:' || :from || ':%' AND s.updated_at > t.updated_at)",
            )
            .run({ from: alias.from, to: alias.to }).changes,
        );
        // 2) 남은 충돌(새 행이 같거나 더 최신)은 옛 행을 버린다.
        const droppedOld = Number(
          this.#db
            .prepare(
              "DELETE FROM srs_state WHERE spot_key LIKE 'pf:' || :from || ':%' AND EXISTS (" +
                "  SELECT 1 FROM srs_state t WHERE t.spot_key = 'pf:' || :to || substr(srs_state.spot_key, 68))",
            )
            .run({ from: alias.from, to: alias.to }).changes,
        );
        const srs = Number(
          this.#db
            .prepare(
              "UPDATE srs_state SET spot_key = 'pf:' || :to || substr(spot_key, 68) " +
                "WHERE spot_key LIKE 'pf:' || :from || ':%'",
            )
            .run({ from: alias.from, to: alias.to }).changes,
        );
        // 세션 필터는 JSON 문자열이다. 64자 hex 는 다른 값의 부분 문자열이 될 수 없으므로
        // 통째 치환이 안전하다 (JSON 을 파싱해 다시 쓰면 키 순서가 바뀐다).
        const sessionFilters = Number(
          this.#db
            .prepare('UPDATE trainer_session SET filter = replace(filter, :from, :to) WHERE instr(filter, :from) > 0')
            .run({ from: alias.from, to: alias.to }).changes,
        );
        const sessionPending = Number(
          this.#db
            .prepare(
              "UPDATE trainer_session SET pending_key = 'pf:' || :to || substr(pending_key, 68) " +
                "WHERE pending_key LIKE 'pf:' || :from || ':%'",
            )
            .run({ from: alias.from, to: alias.to }).changes,
        );
        this.#db
          .prepare('INSERT INTO hash_alias (from_hash, to_hash, applied_at) VALUES (?,?,?)')
          .run(alias.from, alias.to, now);
        out.push({
          from: alias.from,
          to: alias.to,
          attempts,
          srs,
          srsConflicts: droppedNew + droppedOld,
          sessions: sessionFilters + sessionPending,
          alreadyApplied: false,
        });
      }
      this.#db.exec('COMMIT');
    } catch (e) {
      this.#db.exec('ROLLBACK');
      throw e;
    }
    return out;
  }

  /**
   * WAL 을 본체에 합친다 (백업 전에 부른다 — `trainer.db` 한 파일만 복사해도 완전하도록).
   * `:memory:` 나 WAL 이 없는 DB 에서는 아무 일도 하지 않는다.
   */
  checkpoint(): void {
    this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }

  /** 적용된 별칭 목록 (진단·멱등 확인용) */
  listAliases(): { from: string; to: string; appliedAt: number }[] {
    const rows = this.#db
      .prepare('SELECT from_hash, to_hash, applied_at FROM hash_alias ORDER BY from_hash') 
      .all() as unknown as { from_hash: string; to_hash: string; applied_at: number }[];
    return rows.map((r) => ({ from: r.from_hash, to: r.to_hash, appliedAt: r.applied_at }));
  }

  /** `content_hash` 별 attempt 수 (마이그레이션 전후 확인 · 서버 기동 힌트) */
  attemptHashCounts(): Map<string, number> {
    const rows = this.#db.prepare('SELECT content_hash, COUNT(*) AS n FROM attempt GROUP BY content_hash').all() as unknown as {
      content_hash: string;
      n: number;
    }[];
    return new Map(rows.map((r) => [r.content_hash, r.n]));
  }

  close(): void {
    this.#db.close();
  }
}
