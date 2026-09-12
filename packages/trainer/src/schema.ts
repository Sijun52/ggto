/**
 * 기록 DB 스키마 (P3.md 4절, DECISIONS D16).
 *
 * **`ggto.db` 와 별도 파일(`data/trainer.db`)이다.** `ggto.db` 는 `npm run seed` /
 * `--replace` 로 재생성되는 **산출물**이고 기록은 지워지면 안 되는 **사용자 데이터**라
 * 수명이 다르다. 기록은 차트를 `content_hash` 로만 참조하므로 파일 간 FK 가 필요 없다
 * (P2 4.3: 영구 식별자는 content_hash, `chart_set.id` 는 API 핸들일 뿐이다).
 */

import type { DatabaseSync } from 'node:sqlite';
import { CATEGORIES, VERDICTS } from './types.js';

export const TRAINER_SCHEMA_VERSION = 1;

const CATEGORY_LIST = CATEGORIES.map((c) => `'${c}'`).join(',');
const VERDICT_LIST = VERDICTS.map((v) => `'${v}'`).join(',');

// CHECK 목록은 타입 union 에서 만든다 — 두 곳에 적으면 갈라진다.
export const TRAINER_SCHEMA_SQL = `
CREATE TABLE trainer_session (
  id            INTEGER PRIMARY KEY,
  created_at    INTEGER NOT NULL,
  seed          INTEGER NOT NULL,
  count         INTEGER NOT NULL CHECK (count BETWEEN 1 AND 500),
  answered      INTEGER NOT NULL DEFAULT 0,
  filter        TEXT    NOT NULL,
  pending_key   TEXT,
  pending_at    INTEGER,
  finished_at   INTEGER
) STRICT;

CREATE TABLE attempt (
  id            INTEGER PRIMARY KEY,
  session_id    INTEGER NOT NULL REFERENCES trainer_session(id),
  spot_key      TEXT    NOT NULL,
  content_hash  TEXT    NOT NULL,
  seq           TEXT    NOT NULL,
  combo         TEXT    NOT NULL,
  hero_pos      TEXT    NOT NULL,
  category      TEXT    NOT NULL CHECK (category IN (${CATEGORY_LIST})),
  chosen_action TEXT    NOT NULL,
  chosen_freq   REAL    NOT NULL,
  graded_by     TEXT    NOT NULL CHECK (graded_by IN ('ev','frequency')),
  ev_loss_bb    REAL,
  verdict       TEXT    NOT NULL CHECK (verdict IN (${VERDICT_LIST})),
  mixed         INTEGER NOT NULL CHECK (mixed IN (0,1)),
  ms_taken      INTEGER NOT NULL CHECK (ms_taken BETWEEN 0 AND 600000),
  created_at    INTEGER NOT NULL,
  CHECK ((graded_by = 'ev') = (ev_loss_bb IS NOT NULL))
) STRICT;
-- P3.md 4절의 (category, created_at) 에 graded_by·ev_loss_bb 를 덧붙여 **커버링 인덱스**로
-- 만든다. 샘플러의 리크보정(w4)이 추첨마다 "카테고리별 30일 평균 EV loss" 를 묻는데,
-- 두 컬럼이 인덱스 밖에 있으면 행마다 테이블을 찾아가 1만 행에서 6ms 가 든다 (실측).
-- 접두는 스펙 그대로라 (category, created_at) 질의는 동일하게 쓰인다.
CREATE INDEX idx_attempt_cat  ON attempt(category, created_at, graded_by, ev_loss_bb);
CREATE INDEX idx_attempt_hash ON attempt(content_hash, created_at);
CREATE INDEX idx_attempt_spot ON attempt(spot_key, created_at);
-- 스펙 4절에 없던 인덱스. next() 가 매번 "이 세션에서 이미 낸 키" 를 묻는데 (5.3-3)
-- session_id 인덱스가 없으면 attempt 전체를 훑는다 (1만 행에서 2.6ms, 실측).
CREATE INDEX idx_attempt_session ON attempt(session_id);

CREATE TABLE srs_state (
  spot_key      TEXT    PRIMARY KEY,
  ease          REAL    NOT NULL,
  interval_days REAL    NOT NULL,
  reps          INTEGER NOT NULL,
  lapses        INTEGER NOT NULL,
  due_at        INTEGER NOT NULL,
  last_verdict  TEXT    NOT NULL,
  updated_at    INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_srs_due ON srs_state(due_at);
`;

export class SchemaVersionError extends Error {
  constructor(found: number) {
    super(
      `trainer database schema version ${String(found)} is not supported by this build (expected ${String(TRAINER_SCHEMA_VERSION)})`,
    );
    this.name = 'SchemaVersionError';
  }
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  return typeof row?.user_version === 'number' ? row.user_version : 0;
}

/** 0 → DDL, 현재 버전 → 통과, 그 외 → throw (P2 4.1 과 같은 규칙). */
export function migrate(db: DatabaseSync): void {
  const v = userVersion(db);
  if (v === TRAINER_SCHEMA_VERSION) return;
  if (v !== 0) throw new SchemaVersionError(v);
  db.exec(TRAINER_SCHEMA_SQL);
  db.exec(`PRAGMA user_version = ${String(TRAINER_SCHEMA_VERSION)}`);
}
