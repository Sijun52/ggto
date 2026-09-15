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
import { createHash } from 'node:crypto';
import { SolveCache, type SolveRow } from '../src/cache.js';
import { buildConfig } from '../src/config.js';
import { canonicalConfigJson, configHash } from '../src/hash.js';

const dirs: string[] = [];
const caches: SolveCache[] = [];

function open(opts: { capBytes?: number; now?: () => number; onInvalidate?: (hash: string) => void } = {}): SolveCache {
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

function put(
  cache: SolveCache,
  hash: string,
  bytes: number,
  exploitability = 0.5,
  // 정규 JSON 버전. 기본은 지금 버전 — `v:1` 행은 `repair()` 가 버린다 (P4 R1 MINOR 7).
  configJson = `{"v":2,"h":"${hash}"}`,
): SolveRow {
  writeFileSync(cache.partPath(hash), Buffer.alloc(bytes, 1));
  return cache.commit({
    hash,
    configJson,
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
    expect(r.staleRowsRemoved).toEqual([]);
    expect(c.get(good)).not.toBeNull();
    expect(existsSync(c.binPath(good))).toBe(true);
    expect(c.list().length).toBe(1);
  });

  it('P5 12 repair() 는 옛 정규 JSON(v:1) 행과 그 .bin 을 버린다 (R1 MINOR 7)', () => {
    const c = open();
    const stale = 'a'.repeat(64);
    const fresh = 'b'.repeat(64);
    put(c, stale, 100, 0.5, `{"v":1,"h":"${stale}"}`);
    put(c, fresh, 100);

    const r = c.repair();
    expect(r.staleRowsRemoved).toEqual([stale]);
    // 행만 지우면 `.bin` 이 고아로 남아 20GB 를 먹는다 — 파일도 같이 사라져야 한다.
    expect(existsSync(c.binPath(stale))).toBe(false);
    expect(c.get(stale)).toBeNull();
    expect(c.get(fresh)).not.toBeNull();
  });

  it('P4 4.2 깨끗한 캐시에서는 아무것도 치우지 않는다 (멱등)', () => {
    const c = open();
    put(c, 'a'.repeat(64), 100);
    const clean = { partsRemoved: [], orphanBinsRemoved: [], orphanRowsRemoved: [], staleRowsRemoved: [] };
    expect(c.repair()).toEqual(clean);
    expect(c.repair()).toEqual(clean);
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

/** P4 R1 MAJOR 5 — `config_json` 은 **정규 JSON 전체**다 (4.1). 행만으로 게임을 재현한다. */
describe('P4 4.1 config_json', () => {
  it('P4 4.1 저장된 행의 config_json 이 정규 JSON 이고 1326 레인지 둘을 담는다', () => {
    const c = open();
    const cfg = buildConfig({
      oop: '22+,A2s+',
      ip: 'TT-22,AJs-A2s',
      board: 'Ks7h2h',
      potBb: 20,
      stackBb: 80,
      sizings: 'simple',
    });
    const hash = configHash(cfg, 'fake');
    writeFileSync(c.partPath(hash), Buffer.alloc(16, 1));
    c.commit({
      hash,
      configJson: canonicalConfigJson(cfg, 'fake'),
      boardCanonical: '2h7hKs',
      street: 'flop',
      potChips: cfg.potChips,
      stackChips: cfg.stackChips,
      sizings: JSON.stringify(cfg.sizings),
      compressed: false,
      exploitability: 0.4,
      iterations: 100,
      solver: 'fake',
      evBasis: 'stack_delta_from_node',
      elapsedMs: 10,
    });
    const row = c.get(hash) as SolveRow;
    const parsed = JSON.parse(row.configJson) as {
      v: number;
      oop: string;
      ip: string;
      board: string;
      pot: number;
      stack: number;
      sizings: { flop: { bet: string } };
    };
    // 1326 f32 = 5304 바이트 = 10608 hex 문자.
    expect(parsed.oop.length).toBe(1326 * 8);
    expect(parsed.ip.length).toBe(1326 * 8);
    expect(parsed.v).toBe(2);
    // 해시 입력에 솔버 id 가 들어간다 (P4 R1 MINOR 7) — 엔진이 바뀌면 키가 갈라진다.
    expect((parsed as unknown as { solver: string }).solver).toBe('fake');
    expect(parsed.pot).toBe(2000);
    expect(parsed.sizings.flop.bet).toBe('33%,75%');
    // 행만으로 해시를 다시 만들 수 있다 = 게임이 완전히 기술돼 있다.
    expect(createHash('sha256').update(row.configJson, 'utf8').digest('hex')).toBe(hash);
  });
});

/** P4 R1 MAJOR 3 — 파일이 바뀌거나 사라지기 **직전**에 훅이 불린다. */
describe('P4 4.2 onInvalidate 훅', () => {
  it('P4 4.2 REPLACE 커밋과 remove 가 훅을 부른다', () => {
    const seen: string[] = [];
    const c = open({ onInvalidate: (h) => seen.push(h) });
    const hash = 'c'.repeat(64);
    put(c, hash, 1024);
    // 첫 커밋에는 옛 파일이 없다 — 버릴 것이 없으므로 훅도 없다.
    expect(seen).toEqual([]);
    put(c, hash, 2048, 0.1);
    expect(seen).toEqual([hash]);
    c.remove(hash);
    expect(seen).toEqual([hash, hash]);
  });

  it('P4 4.2 LRU 축출도 훅을 부른다 (지워진 파일을 데몬이 들고 있으면 안 된다)', () => {
    const seen: string[] = [];
    const c = open({ capBytes: 4096, onInvalidate: (h) => seen.push(h) });
    put(c, 'd'.repeat(64), 3072);
    c.evictFor(3072, new Set());
    expect(seen).toEqual(['d'.repeat(64)]);
  });
});
