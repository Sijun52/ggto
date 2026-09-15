/**
 * P3.md 4절 기록 DB. **답 하나 = 트랜잭션 하나**와 스키마 버전 규칙.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SchemaVersionError, TRAINER_SCHEMA_VERSION, migrate } from '../src/schema.js';
import { DAY_MS, MAX_INTERVAL_DAYS, applyReview } from '../src/srs.js';
import { TrainerStore, type AttemptInsert } from '../src/store.js';
import { T0 } from './helpers.js';

const KEY = `pf:${'a'.repeat(64)}::AsKh`;

function attempt(over: Partial<AttemptInsert> = {}): AttemptInsert {
  return {
    sessionId: 1,
    spotKey: KEY,
    contentHash: 'a'.repeat(64),
    seq: '',
    combo: 'AsKh',
    heroPos: 'SB',
    category: 'open',
    chosenAction: 'A',
    chosenFreq: 1,
    gradedBy: 'ev',
    evLossBb: 0,
    verdict: 'Perfect',
    mixed: false,
    msTaken: 1000,
    createdAt: T0,
    ...over,
  };
}

describe('P3 4 스키마', () => {
  it('user_version 0 → DDL, 현재 버전 → 통과, 그 외 → SchemaVersionError', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(
      TRAINER_SCHEMA_VERSION,
    );
    expect(() => {
      migrate(db);
    }).not.toThrow();
    db.exec('PRAGMA user_version = 99');
    expect(() => {
      migrate(db);
    }).toThrow(SchemaVersionError);
    db.close();
  });

  it('graded_by 와 ev_loss_bb 의 일관성을 DB 가 강제한다', () => {
    const store = new TrainerStore(':memory:');
    const id = store.createSession({ createdAt: T0, seed: 1, count: 5, filter: '{}' });
    store.setPending(id, KEY, T0);
    const srs = applyReview(null, 'Perfect', T0);
    // ev 채점인데 손실이 null 이면 CHECK 위반이다.
    expect(() => store.recordAnswer(attempt({ sessionId: id, evLossBb: null }), srs, KEY)).toThrow();
    // 빈도 채점인데 손실이 있어도 위반이다.
    expect(() =>
      store.recordAnswer(
        attempt({ sessionId: id, gradedBy: 'frequency', evLossBb: 0.5, verdict: 'InStrategy' }),
        srs,
        KEY,
      ),
    ).toThrow();
    store.close();
  });

  it('ms_taken 범위를 DB 가 강제한다 (클램프가 빠지면 여기서 터진다)', () => {
    const store = new TrainerStore(':memory:');
    const id = store.createSession({ createdAt: T0, seed: 1, count: 5, filter: '{}' });
    store.setPending(id, KEY, T0);
    expect(() => store.recordAnswer(attempt({ sessionId: id, msTaken: 600_001 }), applyReview(null, 'Perfect', T0), KEY)).toThrow();
    store.close();
  });
});

describe('P3 4 답 1건 = 트랜잭션 1개', () => {
  it('attempt / srs_state / answered 가 함께 커밋된다', () => {
    const store = new TrainerStore(':memory:');
    const id = store.createSession({ createdAt: T0, seed: 1, count: 5, filter: '{}' });
    store.setPending(id, KEY, T0);
    const ok = store.recordAnswer(attempt({ sessionId: id }), applyReview(null, 'Perfect', T0), KEY);
    expect(ok).toBe(true);
    const s = store.getSession(id);
    expect(s?.answered).toBe(1);
    expect(s?.pendingKey).toBeNull();
    expect(store.getSrs(KEY, T0)?.reps).toBe(1);
    expect(store.sessionKeys(id).has(KEY)).toBe(true);
    store.close();
  });

  it('INSERT 가 실패하면 answered 도 srs 도 움직이지 않는다 (롤백)', () => {
    const store = new TrainerStore(':memory:');
    const id = store.createSession({ createdAt: T0, seed: 1, count: 5, filter: '{}' });
    store.setPending(id, KEY, T0);
    expect(() =>
      // CHECK 위반으로 트랜잭션 중간에 던진다.
      store.recordAnswer(attempt({ sessionId: id, msTaken: -1 }), applyReview(null, 'Blunder', T0), KEY),
    ).toThrow();
    const s = store.getSession(id);
    expect(s?.answered).toBe(0);
    expect(s?.pendingKey).toBe(KEY);
    expect(store.getSrs(KEY, T0)).toBeNull();
    store.close();
  });

  it('pending 이 다르면 아무것도 쓰지 않고 false 를 준다', () => {
    const store = new TrainerStore(':memory:');
    const id = store.createSession({ createdAt: T0, seed: 1, count: 5, filter: '{}' });
    store.setPending(id, KEY, T0);
    const ok = store.recordAnswer(attempt({ sessionId: id }), applyReview(null, 'Perfect', T0), 'pf:other');
    expect(ok).toBe(false);
    expect(store.getSession(id)?.answered).toBe(0);
    expect(store.getSrs(KEY, T0)).toBeNull();
    store.close();
  });
});

describe('P3 5.3 due / leech 질의', () => {
  it('due 는 오래된 순, leech 는 lapses ≥ 3 만', () => {
    const store = new TrainerStore(':memory:');
    const id = store.createSession({ createdAt: T0, seed: 1, count: 10, filter: '{}' });
    const keys = ['AsKh', 'AsQh', 'AsJh'].map((c) => `pf:${'a'.repeat(64)}::${c}`);
    keys.forEach((key, i) => {
      store.setPending(id, key, T0);
      let srs = applyReview(null, 'Blunder', T0 - (3 - i) * 1000);
      // 첫 키만 3회 lapse 시킨다.
      if (i === 0) {
        srs = applyReview(srs, 'Blunder', T0 - 3000);
        srs = applyReview(srs, 'Blunder', T0 - 3000);
      }
      store.recordAnswer(
        attempt({ sessionId: id, spotKey: key, combo: key.slice(-4), verdict: 'Blunder', evLossBb: 3 }),
        srs,
        key,
      );
    });
    const later = T0 + 10 * 86_400_000;
    const due = store.dueSpots(later, 10);
    expect(due).toHaveLength(3);
    expect(due[0]?.dueAt).toBeLessThanOrEqual(due[1]?.dueAt as number);
    const leeches = store.leechSpots(later, 3, 10);
    expect(leeches).toHaveLength(1);
    expect(leeches[0]?.spotKey).toBe(keys[0]);
    expect(store.srsCounts(later, 3)).toEqual({ due: 3, leeches: 1 });
    store.close();
  });
});

describe('P3 5.3 due_at 폭주 방어 (R2 / P3 R1 MAJOR 1)', () => {
  it('Perfect ×100 을 파일 DB 에 왕복시켜도 읽기가 던지지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ggto-srs-'));
    try {
      const store = new TrainerStore(join(dir, 'trainer.db'));
      const id = store.createSession({ createdAt: T0, seed: 1, count: 200, filter: '{}' });
      let srs = applyReview(null, 'Perfect', T0);
      for (let i = 0; i < 100; i++) {
        store.setPending(id, KEY, T0);
        // 저장 → 다시 읽기 → 그 값으로 다음 복습. 실제 answer() 경로와 같은 순환이다.
        expect(store.recordAnswer(attempt({ sessionId: id, createdAt: T0 + i }), srs, KEY)).toBe(true);
        const read = store.getSrs(KEY, T0);
        expect(read).not.toBeNull();
        expect(read?.reps).toBe(i + 1);
        expect(read?.intervalDays).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
        expect(Number.isSafeInteger(read?.dueAt ?? NaN)).toBe(true);
        srs = applyReview(read, 'Perfect', T0);
      }
      expect(store.getSession(id)?.answered).toBe(100);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('2^53 을 넘는 due_at 이 이미 저장돼 있어도 세 질의가 전부 살아 있다', () => {
    // 상한 없던 판(Perfect ×16)이 실제로 남긴 값. node:sqlite 는 이런 정수를 읽을 때 던진다.
    const BROKEN_DUE_AT = 10_444_497_534_716_632n;
    const dir = mkdtempSync(join(tmpdir(), 'ggto-srs-legacy-'));
    try {
      const path = join(dir, 'trainer.db');
      const store = new TrainerStore(path);
      const id = store.createSession({ createdAt: T0, seed: 1, count: 5, filter: '{}' });
      store.setPending(id, KEY, T0);
      store.recordAnswer(attempt({ sessionId: id }), applyReview(null, 'Perfect', T0), KEY);
      store.close();

      // 저장소를 거치지 않고 직접 망가뜨린다 (구버전이 써 놓은 상태의 재현).
      const raw = new DatabaseSync(path);
      raw.prepare('UPDATE srs_state SET due_at = ?, lapses = 3 WHERE spot_key = ?').run(BROKEN_DUE_AT, KEY);
      // 진짜로 읽을 수 없는 값인지 확인한다 — 그렇지 않으면 이 테스트는 아무것도 증명하지 않는다.
      expect(() => raw.prepare('SELECT due_at FROM srs_state WHERE spot_key = ?').get(KEY)).toThrow();
      raw.close();

      const reopened = new TrainerStore(path);
      const later = T0 + 10 * DAY_MS;
      const read = reopened.getSrs(KEY, later);
      expect(read?.dueAt).toBe(later + MAX_INTERVAL_DAYS * DAY_MS);
      expect(() => reopened.dueSpots(later, 10)).not.toThrow();
      expect(() => reopened.leechSpots(later, 3, 10)).not.toThrow();
      expect(reopened.srsCounts(later, 3)).toEqual({ due: 0, leeches: 1 });
      // 다음 답 한 번으로 행이 정상 범위로 복구된다.
      reopened.setPending(id, KEY, later);
      reopened.recordAnswer(
        attempt({ sessionId: id, createdAt: later }),
        applyReview(read, 'Perfect', later),
        KEY,
      );
      const healed = reopened.getSrs(KEY, later);
      expect(healed?.intervalDays).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
      expect(reopened.dueSpots(later + 400 * DAY_MS, 10)).toHaveLength(1);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('P4 12 (P3 R2 MINOR 3) 상한 전에 저장된 폭주 interval_days 를 열 때 보정한다', () => {
    // 상한 없던 판이 남긴 값: Perfect 16회면 interval 이 1.2e8 일까지 자란다.
    const RUNAWAY_DAYS = 120_000_000;
    const dir = mkdtempSync(join(tmpdir(), 'ggto-srs-clamp-'));
    try {
      const path = join(dir, 'trainer.db');
      const store = new TrainerStore(path);
      const id = store.createSession({ createdAt: T0, seed: 1, count: 5, filter: '{}' });
      store.setPending(id, KEY, T0);
      store.recordAnswer(attempt({ sessionId: id }), applyReview(null, 'Perfect', T0), KEY);
      store.close();

      const raw = new DatabaseSync(path);
      raw
        .prepare('UPDATE srs_state SET interval_days = ?, due_at = ?, updated_at = ? WHERE spot_key = ?')
        .run(RUNAWAY_DAYS, 10_444_497_534_716_632n, T0, KEY);
      const before = raw.prepare('PRAGMA user_version').get() as { user_version: number };
      raw.close();

      const reopened = new TrainerStore(path);
      const state = reopened.getSrs(KEY, T0);
      expect(state?.intervalDays).toBe(MAX_INTERVAL_DAYS);
      // due_at 도 읽을 수 있는 범위로 내려온다 (updated_at + 365일).
      expect(state?.dueAt).toBe(T0 + MAX_INTERVAL_DAYS * DAY_MS);
      reopened.close();
      // 멱등: 다시 열어도 값이 더 변하지 않는다.
      const again = new TrainerStore(path);
      expect(again.getSrs(KEY, T0)?.intervalDays).toBe(MAX_INTERVAL_DAYS);
      expect(again.getSrs(KEY, T0)?.dueAt).toBe(T0 + MAX_INTERVAL_DAYS * DAY_MS);
      again.close();
      // 스키마 변경이 아니다 — user_version 은 그대로여야 한다.
      const check = new DatabaseSync(path);
      expect((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(
        before.user_version,
      );
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
