/**
 * 스키마와 마이그레이션. P2.md 4.1.
 *
 * STRICT 테이블이라 컬럼 타입이 런타임에 강제된다 (TEXT 를 BLOB 컬럼에 넣으면 거부).
 * 마이그레이션 프레임워크는 만들지 않는다 — `user_version` 정수 하나로 충분하다.
 */

import type { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE chart_set (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL UNIQUE,
  game_type     TEXT    NOT NULL CHECK (game_type IN ('cash','mtt','sng')),
  positions     TEXT    NOT NULL,
  blinds        TEXT    NOT NULL,
  ante          TEXT    NOT NULL,
  stack_bb      REAL    NOT NULL CHECK (stack_bb > 0),
  rake          TEXT    NOT NULL,
  resolution    TEXT    NOT NULL CHECK (resolution IN ('169','1326')),
  has_ev        INTEGER NOT NULL CHECK (has_ev IN (0,1)),
  ev_basis      TEXT    NOT NULL CHECK (ev_basis IN ('none','stack_delta_from_node')),
  source        TEXT    NOT NULL CHECK (json_extract(source,'$.name') <> ''),
  format_version INTEGER NOT NULL,
  content_hash  TEXT    NOT NULL UNIQUE,
  imported_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE pf_node (
  id            INTEGER PRIMARY KEY,
  chart_set_id  INTEGER NOT NULL REFERENCES chart_set(id) ON DELETE CASCADE,
  action_seq    TEXT    NOT NULL,
  hero_pos      TEXT    NOT NULL,
  pot_bb        REAL    NOT NULL,
  actions       TEXT    NOT NULL,
  strategy      BLOB    NOT NULL,
  ev            BLOB,
  UNIQUE (chart_set_id, action_seq)
) STRICT;
`;

export class SchemaVersionError extends Error {
  constructor(found: number) {
    super(
      `database schema version ${String(found)} is not supported by this build (expected ${String(SCHEMA_VERSION)})`,
    );
    this.name = 'SchemaVersionError';
  }
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  return typeof row?.user_version === 'number' ? row.user_version : 0;
}

/** 0 → DDL 실행, 현재 버전 → 통과, 그 외 → throw. */
export function migrate(db: DatabaseSync): void {
  const v = userVersion(db);
  if (v === SCHEMA_VERSION) return;
  if (v !== 0) throw new SchemaVersionError(v);
  db.exec(SCHEMA_SQL);
  db.exec(`PRAGMA user_version = ${String(SCHEMA_VERSION)}`);
}
