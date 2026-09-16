/**
 * 은퇴한 차트의 기록 이전 (P7.md 7.2, D35).
 *
 * 픽스처는 **손으로 만든 v1 DB** 다 (옛 해시 3개, attempt 10행, srs 6행 중 1행이 새 해시와
 * 충돌, 세션 필터 1건). v1 파일을 만드는 것이 핵심이다 — `migrate()` 의 1→2 경로가
 * 실제 사용자 파일에서 도는지 보는 것이 목적이기 때문이다.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChartAlias } from '@ggto/preflop';
import { applyAliases, backupPathFor } from '../src/migrate.js';
import { TRAINER_SCHEMA_VERSION, migrate } from '../src/schema.js';
import { TrainerStore } from '../src/store.js';
import { T0 } from './helpers.js';

const OLD = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
const NEW = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)];

const ALIASES: ChartAlias[] = OLD.map((from, i) => ({
  from,
  to: NEW[i] as string,
  reason: 'P7: same model and stack, regenerated as mtt 2-max',
}));

/** P3 v1 스키마 (hash_alias 가 없던 판). 이 DDL 이 곧 "옛 사용자 파일" 이다. */
const V1_SQL = `
CREATE TABLE trainer_session (
  id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL, seed INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count BETWEEN 1 AND 500), answered INTEGER NOT NULL DEFAULT 0,
  filter TEXT NOT NULL, pending_key TEXT, pending_at INTEGER, finished_at INTEGER) STRICT;
CREATE TABLE attempt (
  id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES trainer_session(id),
  spot_key TEXT NOT NULL, content_hash TEXT NOT NULL, seq TEXT NOT NULL, combo TEXT NOT NULL,
  hero_pos TEXT NOT NULL, category TEXT NOT NULL CHECK (category IN ('open','vs_jam')),
  chosen_action TEXT NOT NULL, chosen_freq REAL NOT NULL,
  graded_by TEXT NOT NULL CHECK (graded_by IN ('ev','frequency')), ev_loss_bb REAL,
  verdict TEXT NOT NULL CHECK (verdict IN ('Perfect','Minor','Mistake','Blunder','InStrategy','OutOfStrategy')),
  mixed INTEGER NOT NULL CHECK (mixed IN (0,1)),
  ms_taken INTEGER NOT NULL CHECK (ms_taken BETWEEN 0 AND 600000), created_at INTEGER NOT NULL,
  CHECK ((graded_by = 'ev') = (ev_loss_bb IS NOT NULL))) STRICT;
CREATE TABLE srs_state (
  spot_key TEXT PRIMARY KEY, ease REAL NOT NULL, interval_days REAL NOT NULL,
  reps INTEGER NOT NULL, lapses INTEGER NOT NULL, due_at INTEGER NOT NULL,
  last_verdict TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT;
`;

const key = (hash: string, seq: string, combo: string): string => `pf:${hash}:${seq}:${combo}`;

let dir: string;
let dbPath: string;

function makeV1(): void {
  const db = new DatabaseSync(dbPath);
  db.exec(V1_SQL);
  db.exec('PRAGMA user_version = 1');
  db.prepare(
    'INSERT INTO trainer_session (id, created_at, seed, count, filter, pending_key) VALUES (?,?,?,?,?,?)',
  ).run(1, T0, 7, 20, JSON.stringify({ contentHashes: [OLD[0], OLD[1], 'd'.repeat(64)], categories: ['open'] }), key(OLD[0] as string, 'A', 'AsKh'));
  // attempt 10행: 옛 해시 3개에 4/3/2, 그리고 별칭이 없는 해시에 1
  const rows: [string, string, string][] = [
    [OLD[0] as string, '', 'AsKh'],
    [OLD[0] as string, '', 'AdKd'],
    [OLD[0] as string, 'A', 'QsQh'],
    [OLD[0] as string, 'A', '7s2h'],
    [OLD[1] as string, '', 'AsAh'],
    [OLD[1] as string, '', 'KsKh'],
    [OLD[1] as string, 'A', 'JsTs'],
    [OLD[2] as string, '', '9s9h'],
    [OLD[2] as string, 'A', '5s4s'],
    ['d'.repeat(64), '', 'AsKh'],
  ];
  const insert = db.prepare(
    'INSERT INTO attempt (session_id, spot_key, content_hash, seq, combo, hero_pos, category, chosen_action, ' +
      'chosen_freq, graded_by, ev_loss_bb, verdict, mixed, ms_taken, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  for (const [hash, seq, combo] of rows) {
    insert.run(1, key(hash, seq, combo), hash, seq, combo, 'SB', seq === '' ? 'open' : 'vs_jam', 'A', 1, 'ev', 0, 'Perfect', 0, 1000, T0);
  }
  // srs 6행: 옛 해시 5행 + **새** 해시로 이미 푼 1행 (그 중 하나와 PK 충돌한다)
  const srs = db.prepare(
    'INSERT INTO srs_state (spot_key, ease, interval_days, reps, lapses, due_at, last_verdict, updated_at) VALUES (?,?,?,?,?,?,?,?)',
  );
  srs.run(key(OLD[0] as string, '', 'AsKh'), 2.5, 1, 1, 0, T0, 'Perfect', T0);
  srs.run(key(OLD[0] as string, '', 'AdKd'), 2.5, 1, 1, 0, T0, 'Perfect', T0);
  srs.run(key(OLD[0] as string, 'A', 'QsQh'), 2.5, 1, 1, 0, T0, 'Perfect', T0);
  srs.run(key(OLD[1] as string, '', 'AsAh'), 2.5, 1, 1, 0, T0, 'Perfect', T0);
  srs.run(key(OLD[2] as string, '', '9s9h'), 2.5, 1, 1, 0, T0, 'Perfect', T0);
  // 충돌: 사용자가 마이그레이션 **전에** 새 차트로 같은 스팟을 이미 풀었다.
  // updated_at 이 더 늦으므로 이 행이 살아남고 옛 행은 지워져야 한다.
  srs.run(key(NEW[0] as string, '', 'AsKh'), 1.9, 9, 4, 1, T0 + 5000, 'Mistake', T0 + 5000);
  db.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ggto-migrate-'));
  dbPath = join(dir, 'trainer.db');
  makeV1();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('7.2 trainer:migrate', () => {
  it('7.2-2 migrate() 가 v1 파일을 v2 로 올린다 (기존 행은 그대로)', () => {
    const db = new DatabaseSync(dbPath);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
    migrate(db);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(TRAINER_SCHEMA_VERSION);
    expect(TRAINER_SCHEMA_VERSION).toBe(2);
    expect((db.prepare('SELECT COUNT(*) AS n FROM attempt').get() as { n: number }).n).toBe(10);
    expect((db.prepare('SELECT COUNT(*) AS n FROM hash_alias').get() as { n: number }).n).toBe(0);
    db.close();
  });

  it('7.2-1 백업 파일을 남긴다', () => {
    const report = applyAliases({ dbPath, aliases: ALIASES, now: T0 + 1000 });
    expect(report.backupPath).toBe(backupPathFor(dbPath, T0 + 1000));
    expect(existsSync(report.backupPath as string)).toBe(true);
    // 백업 이름에 Windows 가 금지하는 ':' 가 없다
    expect((report.backupPath as string).includes(':')).toBe(dbPath.includes(':'));
  });

  it('7.2-3 attempt · srs · session 이 새 해시로 옮겨진다', () => {
    const report = applyAliases({ dbPath, aliases: ALIASES, now: T0 + 1000 });
    expect(report.results.map((r) => r.attempts)).toEqual([4, 3, 2]);
    // srs: OLD[0] 은 3행 중 1행이 충돌해 2행만 이름이 바뀐다
    expect(report.results.map((r) => r.srs)).toEqual([2, 1, 1]);
    expect(report.results.map((r) => r.srsConflicts)).toEqual([1, 0, 0]);
    // 세션: 필터 1행 + pending_key 1행 (둘 다 OLD[0])
    expect(report.results[0]?.sessions).toBe(2);
    expect(report.results[1]?.sessions).toBe(1);

    const db = new DatabaseSync(dbPath);
    // 옛 해시는 한 행도 남지 않는다
    for (const old of OLD) {
      expect((db.prepare('SELECT COUNT(*) AS n FROM attempt WHERE content_hash = ?').get(old) as { n: number }).n).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS n FROM attempt WHERE spot_key LIKE 'pf:' || ? || ':%'").get(old) as { n: number }).n).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS n FROM srs_state WHERE spot_key LIKE 'pf:' || ? || ':%'").get(old) as { n: number }).n).toBe(0);
    }
    // 새 해시로 옮겨진 attempt 수
    expect((db.prepare('SELECT COUNT(*) AS n FROM attempt WHERE content_hash = ?').get(NEW[0] as string) as { n: number }).n).toBe(4);
    // spot_key 도 같이 치환됐다 (문자열 앞 67자만 바뀌고 뒤는 그대로)
    const row = db.prepare('SELECT spot_key FROM attempt WHERE content_hash = ? AND combo = ?').get(NEW[0] as string, 'QsQh') as { spot_key: string };
    expect(row.spot_key).toBe(key(NEW[0] as string, 'A', 'QsQh'));
    // 충돌 해결: 더 최신인 새 행(ease 1.9)이 살아남았다
    const kept = db.prepare('SELECT ease, reps FROM srs_state WHERE spot_key = ?').get(key(NEW[0] as string, '', 'AsKh')) as { ease: number; reps: number };
    expect(kept.ease).toBeCloseTo(1.9, 10);
    expect(kept.reps).toBe(4);
    expect((db.prepare('SELECT COUNT(*) AS n FROM srs_state').get() as { n: number }).n).toBe(5);
    // 세션 필터의 해시가 바뀌고 별칭이 없는 해시는 그대로다
    const session = db.prepare('SELECT filter, pending_key FROM trainer_session WHERE id = 1').get() as {
      filter: string;
      pending_key: string;
    };
    const filter = JSON.parse(session.filter) as { contentHashes: string[] };
    expect(filter.contentHashes).toEqual([NEW[0], NEW[1], 'd'.repeat(64)]);
    expect(session.pending_key).toBe(key(NEW[0] as string, 'A', 'AsKh'));
    // 별칭이 없는 해시의 attempt 는 그대로 남는다
    expect((db.prepare('SELECT COUNT(*) AS n FROM attempt WHERE content_hash = ?').get('d'.repeat(64)) as { n: number }).n).toBe(1);
    db.close();
  });

  it('7.2-4 두 번 돌리면 전부 0 행이다 (hash_alias 가 근거)', () => {
    applyAliases({ dbPath, aliases: ALIASES, now: T0 + 1000 });
    const second = applyAliases({ dbPath, aliases: ALIASES, now: T0 + 2000 });
    for (const r of second.results) {
      expect(r.alreadyApplied).toBe(true);
      expect(r.attempts + r.srs + r.sessions + r.srsConflicts).toBe(0);
    }
    const store = new TrainerStore(dbPath);
    expect(store.listAliases().map((a) => a.from)).toEqual([...OLD].sort());
    expect(store.attemptHashCounts().get(NEW[0] as string)).toBe(4);
    store.close();
  });

  it('7.2-3 실패하면 아무것도 쓰이지 않는다 (단일 트랜잭션)', () => {
    const store = new TrainerStore(dbPath);
    const before = store.attemptHashCounts();
    // 두 번째 별칭의 to 가 PK 제약을 깨도록 같은 from 을 두 번 넣는다.
    expect(() =>
      store.applyAliases(
        [
          { from: OLD[0] as string, to: NEW[0] as string },
          { from: OLD[0] as string, to: NEW[1] as string },
        ],
        T0,
      ),
    ).toThrow();
    expect([...store.attemptHashCounts().entries()].sort()).toEqual([...before.entries()].sort());
    expect(store.listAliases()).toEqual([]);
    store.close();
  });
});
