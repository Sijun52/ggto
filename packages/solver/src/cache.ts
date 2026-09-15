/**
 * 솔브 결과 캐시 (P4.md 4절). `data/solves/<hash>.bin` + `index.db` (`node:sqlite`).
 *
 * **원자성**: 솔버는 `<hash>.bin.part` 에 쓰고, 완료 후 rename 하고, 그 **뒤에** 행을 넣는다.
 * 순서를 뒤집으면 크래시 한 번이 "행은 있는데 파일이 없는" 상태를 만든다. 기동 시
 * `repair()` 가 세 종류의 잔해를 치운다: `.part`, 고아 `.bin`, 고아 행.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Street } from './types.js';

export const CACHE_SCHEMA_VERSION = 1;
export const DEFAULT_CACHE_BYTES = 20 * 1024 * 1024 * 1024;

const DDL = `
CREATE TABLE solve (
  hash            TEXT PRIMARY KEY,
  config_json     TEXT NOT NULL,
  board_canonical TEXT NOT NULL,
  street          TEXT NOT NULL CHECK (street IN ('flop','turn','river')),
  pot_chips       INTEGER NOT NULL,
  stack_chips     INTEGER NOT NULL,
  sizings         TEXT NOT NULL,
  compressed      INTEGER NOT NULL CHECK (compressed IN (0,1)),
  exploitability  REAL NOT NULL,
  iterations      INTEGER NOT NULL,
  bytes           INTEGER NOT NULL,
  solver          TEXT NOT NULL,
  ev_basis        TEXT NOT NULL CHECK (ev_basis = 'stack_delta_from_node'),
  created_at      INTEGER NOT NULL,
  last_used_at    INTEGER NOT NULL,
  elapsed_ms      INTEGER NOT NULL
);
CREATE INDEX solve_lru ON solve(last_used_at);
`;

export interface SolveRow {
  hash: string;
  configJson: string;
  boardCanonical: string;
  street: Street;
  potChips: number;
  stackChips: number;
  sizings: string;
  compressed: boolean;
  exploitability: number;
  iterations: number;
  bytes: number;
  solver: string;
  evBasis: 'stack_delta_from_node';
  createdAt: number;
  lastUsedAt: number;
  elapsedMs: number;
}

interface RawRow {
  hash: string;
  config_json: string;
  board_canonical: string;
  street: Street;
  pot_chips: number;
  stack_chips: number;
  sizings: string;
  compressed: number;
  exploitability: number;
  iterations: number;
  bytes: number;
  solver: string;
  ev_basis: 'stack_delta_from_node';
  created_at: number;
  last_used_at: number;
  elapsed_ms: number;
}

function toRow(r: RawRow): SolveRow {
  return {
    hash: r.hash,
    configJson: r.config_json,
    boardCanonical: r.board_canonical,
    street: r.street,
    potChips: r.pot_chips,
    stackChips: r.stack_chips,
    sizings: r.sizings,
    compressed: r.compressed === 1,
    exploitability: r.exploitability,
    iterations: r.iterations,
    bytes: r.bytes,
    solver: r.solver,
    evBasis: r.ev_basis,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    elapsedMs: r.elapsed_ms,
  };
}

export class CacheSchemaVersionError extends Error {
  constructor(found: number) {
    super(`data/solves/index.db user_version ${String(found)} != ${String(CACHE_SCHEMA_VERSION)}`);
    this.name = 'CacheSchemaVersionError';
  }
}

export interface RepairReport {
  partsRemoved: string[];
  orphanBinsRemoved: string[];
  orphanRowsRemoved: string[];
}

export interface EvictReport {
  hashes: string[];
  bytes: number;
}

export class SolveCache {
  readonly dir: string;
  readonly capBytes: number;
  readonly #db: DatabaseSync;
  readonly #now: () => number;
  /** `last_used_at` 갱신 스로틀 (초당 1회, P4.md 4.2) */
  readonly #touchedAt = new Map<string, number>();
  /** `.bin` 이 바뀌거나 사라지기 **직전**에 부른다 (P4 R1 MAJOR 3) */
  readonly #invalidateListeners = new Set<(hash: string) => void>();

  constructor(opts: {
    dir: string;
    capBytes?: number;
    now?: () => number;
    /**
     * 파일이 바뀌거나 지워지기 직전에 호출된다 — 조회 데몬이 그 결과를 들고 있으면
     * 버리라고 알리는 훅이다 (`Solver.invalidate`). 캐시는 솔버를 모르므로(2절) 훅으로
     * 받는다. 훅이 없어도 **정답은 유지된다**: 데몬이 `load` 때 (크기, mtime) 을 비교해
     * 다시 읽는다. 훅은 메모리를 더 일찍 돌려받기 위한 것이다.
     */
    onInvalidate?: (hash: string) => void;
  }) {
    this.dir = opts.dir;
    this.capBytes = opts.capBytes ?? DEFAULT_CACHE_BYTES;
    this.#now = opts.now ?? ((): number => Date.now());
    if (opts.onInvalidate !== undefined) this.#invalidateListeners.add(opts.onInvalidate);
    mkdirSync(this.dir, { recursive: true });
    this.#db = new DatabaseSync(join(this.dir, 'index.db'));
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#migrate();
  }

  #migrate(): void {
    const row = this.#db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    const v = typeof row?.user_version === 'number' ? row.user_version : 0;
    if (v === CACHE_SCHEMA_VERSION) return;
    if (v !== 0) throw new CacheSchemaVersionError(v);
    this.#db.exec(DDL);
    this.#db.exec(`PRAGMA user_version = ${String(CACHE_SCHEMA_VERSION)}`);
  }

  /**
   * 무효화 리스너 등록. 해제 함수를 돌려준다.
   *
   * 생성자 옵션이 아니라 **등록**인 이유: 캐시를 만드는 곳(서버 main·CLI·테스트)과 솔버를
   * 아는 곳(라우트)이 다르다. 라우트가 직접 걸면 `createApp` 을 쓰는 모든 경로가 자동으로
   * 무효화를 얻는다 — 훅을 잊어서 낡은 결과를 주는 일이 구조적으로 없어진다.
   */
  onInvalidate(fn: (hash: string) => void): () => void {
    this.#invalidateListeners.add(fn);
    return (): void => {
      this.#invalidateListeners.delete(fn);
    };
  }

  #fireInvalidate(hash: string): void {
    for (const fn of this.#invalidateListeners) fn(hash);
  }

  binPath(hash: string): string {
    return join(this.dir, `${hash}.bin`);
  }

  partPath(hash: string): string {
    return join(this.dir, `${hash}.bin.part`);
  }

  get(hash: string): SolveRow | null {
    const r = this.#db.prepare('SELECT * FROM solve WHERE hash = ?').get(hash) as unknown as RawRow | undefined;
    return r === undefined ? null : toRow(r);
  }

  list(): SolveRow[] {
    const rows = this.#db.prepare('SELECT * FROM solve ORDER BY last_used_at DESC').all() as unknown as RawRow[];
    return rows.map(toRow);
  }

  totalBytes(): number {
    const r = this.#db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM solve').get() as { n: number };
    return Number(r.n);
  }

  /**
   * 히트 판정 (P4.md 4.3): 행이 있고 **달성 정확도가 요청 목표 이하**면 히트다.
   * 더 정확한 캐시는 재사용하고, 덜 정확하면 재솔브 후 REPLACE 한다.
   */
  lookup(hash: string, targetPct: number): { hit: boolean; row: SolveRow | null } {
    const row = this.get(hash);
    if (row === null) return { hit: false, row: null };
    if (!existsSync(this.binPath(hash))) return { hit: false, row };
    return { hit: row.exploitability <= targetPct, row };
  }

  touch(hash: string): void {
    const now = this.#now();
    const last = this.#touchedAt.get(hash) ?? 0;
    if (now - last < 1000) return;
    this.#touchedAt.set(hash, now);
    this.#db.prepare('UPDATE solve SET last_used_at = ? WHERE hash = ?').run(now, hash);
  }

  /**
   * 새 결과를 넣을 자리를 만든다 (P4.md 4.2). **저장 전에** 부른다.
   * `keep` 은 실행 중·로드 중인 해시 — 지우면 그 잡이 읽던 파일이 사라진다.
   */
  evictFor(incomingBytes: number, keep: ReadonlySet<string>): EvictReport {
    const report: EvictReport = { hashes: [], bytes: 0 };
    let total = this.totalBytes();
    if (total + incomingBytes <= this.capBytes) return report;
    const rows = this.#db.prepare('SELECT * FROM solve ORDER BY last_used_at ASC').all() as unknown as RawRow[];
    for (const raw of rows) {
      if (total + incomingBytes <= this.capBytes) break;
      if (keep.has(raw.hash)) continue;
      this.remove(raw.hash);
      total -= raw.bytes;
      report.hashes.push(raw.hash);
      report.bytes += raw.bytes;
    }
    return report;
  }

  /**
   * `.part` → `.bin` rename 후 행 INSERT (이 순서가 4.2 의 원자성이다).
   * 같은 해시가 이미 있으면 옛 `.bin` 을 지우고 REPLACE 한다 (4.3 재솔브 경로).
   */
  commit(row: Omit<SolveRow, 'createdAt' | 'lastUsedAt' | 'bytes'> & { bytes?: number }): SolveRow {
    const part = this.partPath(row.hash);
    if (!existsSync(part)) throw new Error(`no .part to commit for ${row.hash}`);
    const bin = this.binPath(row.hash);
    // 재솔브 REPLACE 다 — 데몬이 들고 있는 옛 결과를 먼저 버리게 한다 (P4 R1 MAJOR 3).
    if (existsSync(bin)) {
      this.#fireInvalidate(row.hash);
      rmSync(bin, { force: true });
    }
    renameSync(part, bin);
    const bytes = row.bytes ?? statSync(bin).size;
    const now = this.#now();
    const existing = this.get(row.hash);
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO solve
         (hash, config_json, board_canonical, street, pot_chips, stack_chips, sizings, compressed,
          exploitability, iterations, bytes, solver, ev_basis, created_at, last_used_at, elapsed_ms)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.hash,
        row.configJson,
        row.boardCanonical,
        row.street,
        row.potChips,
        row.stackChips,
        row.sizings,
        row.compressed ? 1 : 0,
        row.exploitability,
        row.iterations,
        bytes,
        row.solver,
        row.evBasis,
        existing?.createdAt ?? now,
        now,
        row.elapsedMs,
      );
    // commit 이 방금 last_used_at 을 now 로 썼다. 스로틀 시계도 같이 맞춰 두지 않으면
    // 직후의 `touch` 한 번이 그냥 통과해 "초당 1회" 가 깨진다.
    this.#touchedAt.set(row.hash, now);
    return this.get(row.hash) as SolveRow;
  }

  remove(hash: string): boolean {
    this.#fireInvalidate(hash);
    const info = this.#db.prepare('DELETE FROM solve WHERE hash = ?').run(hash);
    rmSync(this.binPath(hash), { force: true });
    rmSync(this.partPath(hash), { force: true });
    return Number(info.changes) > 0;
  }

  /** 기동 정리. 결과를 돌려주고 호출자가 로그로 남긴다 (P4.md 4.2). */
  repair(): RepairReport {
    const report: RepairReport = { partsRemoved: [], orphanBinsRemoved: [], orphanRowsRemoved: [] };
    const files = readdirSync(this.dir);
    const rows = new Map(this.list().map((r) => [r.hash, r]));

    for (const f of files) {
      if (f.endsWith('.bin.part')) {
        rmSync(join(this.dir, f), { force: true });
        report.partsRemoved.push(f);
        continue;
      }
      if (f.endsWith('.bin')) {
        const hash = f.slice(0, -4);
        if (!rows.has(hash)) {
          rmSync(join(this.dir, f), { force: true });
          report.orphanBinsRemoved.push(f);
        }
      }
    }
    for (const [hash] of rows) {
      if (!existsSync(this.binPath(hash))) {
        this.#db.prepare('DELETE FROM solve WHERE hash = ?').run(hash);
        report.orphanRowsRemoved.push(hash);
      }
    }
    return report;
  }

  close(): void {
    this.#db.close();
  }
}
