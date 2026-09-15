/**
 * P4.md 8.1 — 캐시 (4절). 파일과 index.db 가 **함께** 맞아야 한다.
 *
 * `repair()` 가 치우는 세 잔해는 전부 실제로 일어난다: 솔브 중 크래시(`.part`),
 * index.db 만 지워짐(고아 `.bin`), `.bin` 만 지워짐(고아 행).
 */

import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SolveCache, type SolveRow } from '../src/cache.js';

const dirs: string[] = [];
const caches: SolveCache[] = [];

function open(opts: { capBytes?: number; now?: () => number } = {}): SolveCache {
  const dir = mkdtempSync(join(tmpdir(), 'ggto-cache-'));
  dirs.push(dir);
  const c = new SolveCache({ dir, ...opts });
  caches.push(c);
  return c;
}

afterEach(() => {
  for (const c of caches.splice(0)) c.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function put(cache: SolveCache, hash: string, bytes: number, exploitability = 0.5): SolveRow {
  writeFileSync(cache.partPath(hash), Buffer.alloc(bytes, 1));
  return cache.commit({
    hash,
    configJson: `{"v":1,"h":"${hash}"}`,
    boardCanonical: '2h7hKs',
    street: 'flop',
    potChips: 2000,
    stackChips: 8000,
    sizings: 'simple',
    compressed: false,
    exploitability,
    iterations: 100,
    solver: 'fake',
    evBasis: 'stack_delta_from_node',
    elapsedMs: 10,
  });
}

describe('P4 4.2 캐시 — 저장과 총량', () => {
  it('P4 4.2 commit 은 .part 를 rename 하고 그 뒤에 행을 넣는다', () => {
    const c = open();
    const row = put(c, 'a'.repeat(64), 2048);
    expect(existsSync(c.binPath('a'.repeat(64)))).toBe(true);
    expect(existsSync(c.partPath('a'.repeat(64)))).toBe(false);
    expect(row.bytes).toBe(2048);
    expect(c.get('a'.repeat(64))?.evBasis).toBe('stack_delta_from_node');
  });

  it('P4 4.2 .part 없이 commit 하면 던진다 (행만 남는 상태를 만들지 않는다)', () => {
    const c = open();
    expect(() =>
      c.commit({
        hash: 'b'.repeat(64),
        configJson: '{}',
        boardCanonical: '2h7hKs',
        street: 'flop',
        potChips: 1,
        stackChips: 1,
        sizings: 'simple',
        compressed: false,
        exploitability: 0.5,
        iterations: 1,
        solver: 'fake',
        evBasis: 'stack_delta_from_node',
        elapsedMs: 1,
      }),
    ).toThrow(/no \.part/);
    expect(c.get('b'.repeat(64))).toBeNull();
  });

  it('P4 4.2 총량은 실제 파일 크기 합과 같다', () => {
    const c = open();
    put(c, 'a'.repeat(64), 1000);
    put(c, 'b'.repeat(64), 2500);
    const onDisk = readdirSync(c.dir)
      .filter((f) => f.endsWith('.bin'))
      .reduce((n, f) => n + statSync(join(c.dir, f)).size, 0);
    expect(c.totalBytes()).toBe(3500);
    expect(c.totalBytes()).toBe(onDisk);
  });
});

describe('P4 4.3 히트 판정 (<=)', () => {
  it('P4 4.3 0.3% 캐시에 0.5% 요청은 히트, 0.8% 캐시에 0.5% 요청은 재솔브다', () => {
    const c = open();
    put(c, 'a'.repeat(64), 100, 0.3);
    put(c, 'b'.repeat(64), 100, 0.8);
    expect(c.lookup('a'.repeat(64), 0.5).hit).toBe(true);
    expect(c.lookup('b'.repeat(64), 0.5).hit).toBe(false);
    // 행은 있다 — 호출자가 "재솔브 후 REPLACE" 를 알 수 있어야 한다.
    expect(c.lookup('b'.repeat(64), 0.5).row?.exploitability).toBe(0.8);
    expect(c.lookup('c'.repeat(64), 0.5)).toEqual({ hit: false, row: null });
  });

  it('P4 4.3 재솔브는 옛 .bin 을 지우고 REPLACE 한다 (created_at 은 보존)', () => {
    let now = 1_000_000;
    const c = open({ now: () => now });
    const hash = 'a'.repeat(64);
    const first = put(c, hash, 100, 0.8);
    now += 60_000;
    const second = put(c, hash, 250, 0.2);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.lastUsedAt).toBeGreaterThan(first.lastUsedAt);
    expect(second.bytes).toBe(250);
    expect(c.totalBytes()).toBe(250);
    expect(statSync(c.binPath(hash)).size).toBe(250);
  });

  it('P4 4.2 lookup 은 .bin 이 사라진 행을 히트로 보지 않는다', () => {
    const c = open();
    const hash = 'a'.repeat(64);
    put(c, hash, 100, 0.1);
    rmSync(c.binPath(hash));
    expect(c.lookup(hash, 0.5).hit).toBe(false);
  });
});

describe('P4 4.2 LRU 축출', () => {
  it('P4 4.2 last_used_at 오름차순으로 지우고 실행 중 해시는 건너뛴다', () => {
    let now = 1_000_000;
    const c = open({ capBytes: 1000, now: () => now });
    const oldest = 'a'.repeat(64);
    const middle = 'b'.repeat(64);
    const newest = 'c'.repeat(64);
    put(c, oldest, 400);
    now += 10_000;
    put(c, middle, 400);
    now += 10_000;
    put(c, newest, 100);
    expect(c.totalBytes()).toBe(900);

    // 300 바이트를 더 넣으려면 200 을 비워야 한다 → 가장 오래된 것부터.
    const report = c.evictFor(300, new Set());
    expect(report.hashes).toEqual([oldest]);
    expect(c.get(oldest)).toBeNull();
    expect(existsSync(c.binPath(oldest))).toBe(false);
    expect(c.get(middle)).not.toBeNull();
  });

  it('P4 4.2 실행 중·로드 중 해시는 축출 대상에서 빠진다', () => {
    let now = 1_000_000;
    const c = open({ capBytes: 1000, now: () => now });
    const pinned = 'a'.repeat(64);
    const other = 'b'.repeat(64);
    put(c, pinned, 400);
    now += 10_000;
    put(c, other, 400);
    const report = c.evictFor(300, new Set([pinned]));
    expect(report.hashes).toEqual([other]);
    expect(c.get(pinned)).not.toBeNull();
  });

  it('P4 4.2 상한 안이면 아무것도 지우지 않는다', () => {
    const c = open({ capBytes: 10_000 });
    put(c, 'a'.repeat(64), 400);
    expect(c.evictFor(100, new Set())).toEqual({ hashes: [], bytes: 0 });
  });
});

describe('P4 4.2 repair()', () => {
  it('P4 4.2 .part · 고아 .bin · 고아 행을 각각 치운다', () => {
    const c = open();
    const good = 'a'.repeat(64);
    const orphanRow = 'b'.repeat(64);
    const orphanBin = 'c'.repeat(64);
    put(c, good, 100);
    put(c, orphanRow, 100);
    // 잔해를 만든다: .bin 만 삭제 / index 에 없는 .bin / 솔브 중 크래시한 .part
    rmSync(c.binPath(orphanRow));
    writeFileSync(c.binPath(orphanBin), Buffer.alloc(50));
    writeFileSync(c.partPath('d'.repeat(64)), Buffer.alloc(10));

    const r = c.repair();
    expect(r.partsRemoved).toEqual([`${'d'.repeat(64)}.bin.part`]);
    expect(r.orphanBinsRemoved).toEqual([`${orphanBin}.bin`]);
    expect(r.orphanRowsRemoved).toEqual([orphanRow]);
    expect(c.get(good)).not.toBeNull();
    expect(existsSync(c.binPath(good))).toBe(true);
    expect(c.list().length).toBe(1);
  });

  it('P4 4.2 깨끗한 캐시에서는 아무것도 치우지 않는다 (멱등)', () => {
    const c = open();
    put(c, 'a'.repeat(64), 100);
    expect(c.repair()).toEqual({ partsRemoved: [], orphanBinsRemoved: [], orphanRowsRemoved: [] });
    expect(c.repair()).toEqual({ partsRemoved: [], orphanBinsRemoved: [], orphanRowsRemoved: [] });
  });
});

describe('P4 4.2 last_used_at 스로틀', () => {
  it('P4 4.2 touch 는 초당 한 번만 UPDATE 한다', () => {
    let now = 1_000_000;
    const c = open({ now: () => now });
    const hash = 'a'.repeat(64);
    put(c, hash, 100);
    const t0 = c.get(hash)?.lastUsedAt as number;
    now += 100;
    c.touch(hash);
    expect(c.get(hash)?.lastUsedAt).toBe(t0); // 스로틀에 막혀 그대로
    now += 2000;
    c.touch(hash);
    expect(c.get(hash)?.lastUsedAt).toBe(now);
  });
});
