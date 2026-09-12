/**
 * P3.md 13 — **답 처리 중 프로세스 kill**. 4절의 "답 하나 = 트랜잭션 하나" 를 롤백이
 * 아니라 실제 프로세스 종료로 확인한다 (P3 R1 UNCERTAIN 1).
 *
 * `store.test.ts` 의 롤백 테스트는 CHECK 위반으로 예외를 던져 catch 안의 ROLLBACK 이
 * 도는 경로다. 프로세스가 그냥 사라지면 그 catch 는 실행되지 않는다 — 그때 일관성을
 * 지키는 것은 SQLite 의 WAL 복구뿐이고, 그것이 실제로 도는지는 자식 프로세스를 죽여야만
 * 알 수 있다. 죽이는 지점은 `test/fixtures/killRunner.mjs` 가 결정적으로 잡는다
 * (attempt INSERT 직후 · srs_state UPSERT 직전).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyReview } from '../src/srs.js';
import { TrainerStore, type AttemptInsert } from '../src/store.js';
import { T0 } from './helpers.js';

const RUNNER = fileURLToPath(new URL('./fixtures/killRunner.mjs', import.meta.url));
const HASH = 'a'.repeat(64);
const KEY_MID = `pf:${HASH}::AsKh`;
const KEY_AFTER = `pf:${HASH}::AsQh`;

function runChild(dbPath: string, sessionId: number, key: string, now: number, mode: 'mid' | 'after'): number {
  const r = spawnSync(process.execPath, [RUNNER, dbPath, String(sessionId), key, String(now), mode], {
    encoding: 'utf8',
  });
  if (r.error !== undefined && r.error !== null) throw r.error;
  // exit 3 = 덫이 안 걸렸다 (kill 이 일어나지 않았다) → 이 테스트는 아무것도 증명하지 못한다.
  expect(r.status).not.toBe(3);
  expect(r.status).not.toBe(0);
  return r.status ?? -1;
}

function counts(path: string, key: string): { attempts: number; srs: number } {
  const db = new DatabaseSync(path);
  const a = db.prepare('SELECT COUNT(*) AS n FROM attempt WHERE spot_key = ?').get(key) as { n: number };
  const s = db.prepare('SELECT COUNT(*) AS n FROM srs_state WHERE spot_key = ?').get(key) as { n: number };
  db.close();
  return { attempts: a.n, srs: s.n };
}

function attempt(over: Partial<AttemptInsert> & { sessionId: number; spotKey: string }): AttemptInsert {
  return {
    contentHash: HASH,
    seq: '',
    combo: over.spotKey.slice(-4),
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

describe('P3 13 답 처리 중 프로세스 kill', () => {
  it('트랜잭션 중간에 죽으면 attempt · srs_state · answered 가 함께 없다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ggto-kill-'));
    try {
      const path = join(dir, 'trainer.db');
      const store = new TrainerStore(path);
      const id = store.createSession({ createdAt: T0, seed: 7, count: 5, filter: '{}' });
      store.setPending(id, KEY_MID, T0);
      store.close(); // 자식이 쓸 수 있도록 닫는다 (파일 하나를 두 프로세스가 잡지 않는다).

      runChild(path, id, KEY_MID, T0, 'mid');

      // 살아남은 것이 있으면 안 된다 — 셋 중 하나라도 남으면 반쪽 상태다.
      expect(counts(path, KEY_MID)).toEqual({ attempts: 0, srs: 0 });
      const after = new TrainerStore(path);
      const s = after.getSession(id);
      expect(s?.answered).toBe(0);
      // pending 은 그대로 남는다 — 다음 next() 가 같은 스팟을 다시 낸다 (멱등).
      expect(s?.pendingKey).toBe(KEY_MID);
      expect(after.getSrs(KEY_MID, T0)).toBeNull();

      // DB 는 여전히 쓸 수 있다: 같은 스팟에 다시 답하면 정상적으로 1건이 된다.
      const ok = after.recordAnswer(
        attempt({ sessionId: id, spotKey: KEY_MID, createdAt: T0 + 5000 }),
        applyReview(null, 'Perfect', T0 + 5000),
        KEY_MID,
      );
      expect(ok).toBe(true);
      expect(after.getSession(id)?.answered).toBe(1);
      expect(counts(path, KEY_MID)).toEqual({ attempts: 1, srs: 1 });
      after.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('커밋 직후에 죽으면 셋이 함께 남는다 (kill 자체가 기록을 지우는 것이 아니다)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ggto-kill-after-'));
    try {
      const path = join(dir, 'trainer.db');
      const store = new TrainerStore(path);
      const id = store.createSession({ createdAt: T0, seed: 7, count: 5, filter: '{}' });
      store.setPending(id, KEY_AFTER, T0);
      store.close();

      runChild(path, id, KEY_AFTER, T0, 'after');

      expect(counts(path, KEY_AFTER)).toEqual({ attempts: 1, srs: 1 });
      const after = new TrainerStore(path);
      const s = after.getSession(id);
      expect(s?.answered).toBe(1);
      expect(s?.pendingKey).toBeNull();
      expect(after.getSrs(KEY_AFTER, T0)?.reps).toBe(1);
      after.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
