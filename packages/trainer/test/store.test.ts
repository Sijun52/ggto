/**
 * P3.md 4절 기록 DB. **답 하나 = 트랜잭션 하나**와 스키마 버전 규칙.
 */

import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SchemaVersionError, TRAINER_SCHEMA_VERSION, migrate } from '../src/schema.js';
import { applyReview } from '../src/srs.js';
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
    expect(store.getSrs(KEY)?.reps).toBe(1);
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
    expect(store.getSrs(KEY)).toBeNull();
    store.close();
  });

  it('pending 이 다르면 아무것도 쓰지 않고 false 를 준다', () => {
    const store = new TrainerStore(':memory:');
    const id = store.createSession({ createdAt: T0, seed: 1, count: 5, filter: '{}' });
    store.setPending(id, KEY, T0);
    const ok = store.recordAnswer(attempt({ sessionId: id }), applyReview(null, 'Perfect', T0), 'pf:other');
    expect(ok).toBe(false);
    expect(store.getSession(id)?.answered).toBe(0);
    expect(store.getSrs(KEY)).toBeNull();
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
