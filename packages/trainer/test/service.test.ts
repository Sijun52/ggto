/**
 * P3.md 5.3 / 6 / 7 서비스 통합. 실데이터(시드 6개) + 인메모리 기록 DB.
 */

import { COMBO_COUNT } from '@ggto/core';
import type { ChartRepository } from '@ggto/preflop';
import { describe, expect, it } from 'vitest';
import { openTrainer, type NextResult, type TrainerService } from '../src/service.js';
import { parseSpotKey } from '../src/spotKey.js';
import { DAY_MS } from '../src/srs.js';
import { MissingChartError, SessionNotFoundError, SpotMismatchError, TrainerInputError } from '../src/types.js';
import { T0, fixedClock, fixtureDocs, seededRepo, withoutEv } from './helpers.js';

interface Harness {
  repo: ChartRepository;
  trainer: TrainerService;
  clock: ReturnType<typeof fixedClock>;
  close: () => void;
}

function harness(): Harness {
  const repo = seededRepo();
  const clock = fixedClock(T0);
  const trainer = openTrainer({ chartRepo: repo, dbPath: ':memory:', now: clock.now });
  return {
    repo,
    trainer,
    clock,
    close: () => {
      trainer.close();
      repo.close();
    },
  };
}

/** 세션 하나를 끝까지 돌면서 매번 첫 액션으로 답한다. */
function playSession(h: Harness, count: number, seed: number, pick: (actions: readonly string[]) => string): string[] {
  const s = h.trainer.createSession({ count, seed });
  const keys: string[] = [];
  for (;;) {
    const n = h.trainer.next(s.sessionId);
    if (n.done) break;
    keys.push(n.spot.key);
    h.trainer.answer({
      sessionId: s.sessionId,
      spotKey: n.spot.key,
      action: pick(n.spot.actions),
      msTaken: 1200,
    });
  }
  return keys;
}

describe('P3 7 세션 수명', () => {
  it('count 만큼 출제하고 그 다음 next 는 done + 세션 리포트다', () => {
    const h = harness();
    try {
      const keys = playSession(h, 5, 42, (a) => a[0] as string);
      expect(keys).toHaveLength(5);
      const status = h.trainer.sessionStatus(1);
      expect(status.answered).toBe(5);
      expect(status.finished).toBe(true);
      expect(status.report.totals.attempts).toBe(5);
      expect(status.report.totals.evGraded).toBe(5);
    } finally {
      h.close();
    }
  });

  it('next 는 멱등이다 — 답하기 전에는 같은 스팟이 나온다 (새로고침 안전)', () => {
    const h = harness();
    try {
      const s = h.trainer.createSession({ count: 3, seed: 1 });
      const a = h.trainer.next(s.sessionId);
      const b = h.trainer.next(s.sessionId);
      expect(a.done).toBe(false);
      expect(b.done).toBe(false);
      if (a.done || b.done) return;
      expect(b.spot.key).toBe(a.spot.key);
      expect(b.index).toBe(a.index);
    } finally {
      h.close();
    }
  });

  it('같은 시드 + 같은 상태면 키 열이 결정적이다', () => {
    const a = harness();
    const b = harness();
    try {
      const ka = playSession(a, 8, 12345, (x) => x[0] as string);
      const kb = playSession(b, 8, 12345, (x) => x[0] as string);
      expect(ka).toEqual(kb);
    } finally {
      a.close();
      b.close();
    }
  });

  it('다른 시드면 키 열이 갈린다', () => {
    const a = harness();
    const b = harness();
    try {
      const ka = playSession(a, 12, 1, (x) => x[0] as string);
      const kb = playSession(b, 12, 2, (x) => x[0] as string);
      expect(ka).not.toEqual(kb);
    } finally {
      a.close();
      b.close();
    }
  });

  it('세션 안에서 같은 스팟을 두 번 내지 않는다 (풀이 충분히 클 때)', () => {
    const h = harness();
    try {
      const keys = playSession(h, 30, 99, (x) => x[0] as string);
      expect(new Set(keys).size).toBe(keys.length);
    } finally {
      h.close();
    }
  });

  it('없는 세션은 SessionNotFoundError', () => {
    const h = harness();
    try {
      expect(() => h.trainer.next(999)).toThrow(SessionNotFoundError);
      expect(() => h.trainer.sessionStatus(999)).toThrow(SessionNotFoundError);
    } finally {
      h.close();
    }
  });

  it('count 범위를 벗어나면 TrainerInputError', () => {
    const h = harness();
    try {
      expect(() => h.trainer.createSession({ count: 0 })).toThrow(TrainerInputError);
      expect(() => h.trainer.createSession({ count: 501 })).toThrow(TrainerInputError);
      expect(() => h.trainer.createSession({ count: 1.5 })).toThrow(TrainerInputError);
    } finally {
      h.close();
    }
  });
});

describe('P3 7 답 처리', () => {
  it('pending 이 아닌 스팟에 답하면 409 SpotMismatch 이고 아무것도 기록되지 않는다', () => {
    const h = harness();
    try {
      const s = h.trainer.createSession({ count: 3, seed: 5 });
      const n = h.trainer.next(s.sessionId);
      if (n.done) throw new Error('unexpected done');
      const other = `pf:${'a'.repeat(64)}::AsKh`;
      expect(() => h.trainer.answer({ sessionId: s.sessionId, spotKey: other, action: 'F', msTaken: 0 })).toThrow(
        SpotMismatchError,
      );
      expect(h.trainer.sessionStatus(s.sessionId).answered).toBe(0);
    } finally {
      h.close();
    }
  });

  it('같은 스팟에 두 번 답하면 두 번째는 거절된다 (두 번 세지 않는다)', () => {
    const h = harness();
    try {
      const s = h.trainer.createSession({ count: 3, seed: 5 });
      const n = h.trainer.next(s.sessionId);
      if (n.done) throw new Error('unexpected done');
      h.trainer.answer({ sessionId: s.sessionId, spotKey: n.spot.key, action: n.spot.actions[0] as string, msTaken: 10 });
      expect(() =>
        h.trainer.answer({ sessionId: s.sessionId, spotKey: n.spot.key, action: n.spot.actions[0] as string, msTaken: 10 }),
      ).toThrow(SpotMismatchError);
      expect(h.trainer.sessionStatus(s.sessionId).answered).toBe(1);
    } finally {
      h.close();
    }
  });

  it('답 응답의 노드는 1326 × 액션 수이고 EV 와 reach 를 포함한다', () => {
    const h = harness();
    try {
      const s = h.trainer.createSession({ count: 1, seed: 7 });
      const n = h.trainer.next(s.sessionId);
      if (n.done) throw new Error('unexpected done');
      const r = h.trainer.answer({
        sessionId: s.sessionId,
        spotKey: n.spot.key,
        action: n.spot.actions[0] as string,
        msTaken: 500,
      });
      expect(r.node.strategy).toHaveLength(n.spot.actions.length);
      expect(r.node.strategy[0]).toHaveLength(COMBO_COUNT);
      expect(r.node.ev).not.toBeNull();
      expect(r.reach).toHaveLength(COMBO_COUNT);
      expect(r.grade.gradedBy).toBe('ev');
      expect(r.grade.actions).toHaveLength(n.spot.actions.length);
    } finally {
      h.close();
    }
  });

  it('msTaken 은 [0, 600000] 으로 클램프된다', () => {
    const h = harness();
    try {
      const s = h.trainer.createSession({ count: 2, seed: 7 });
      const n = h.trainer.next(s.sessionId);
      if (n.done) throw new Error('unexpected done');
      // DB CHECK 이 범위를 강제하므로, 클램프가 없으면 여기서 SQLite 가 던진다.
      expect(() =>
        h.trainer.answer({ sessionId: s.sessionId, spotKey: n.spot.key, action: n.spot.actions[0] as string, msTaken: 1e9 }),
      ).not.toThrow();
      const n2 = h.trainer.next(s.sessionId);
      if (n2.done) throw new Error('unexpected done');
      expect(() =>
        h.trainer.answer({ sessionId: s.sessionId, spotKey: n2.spot.key, action: n2.spot.actions[0] as string, msTaken: -5 }),
      ).not.toThrow();
    } finally {
      h.close();
    }
  });

  it('스팟 키의 노드가 사라지면 MissingChartError', () => {
    const h = harness();
    try {
      const s = h.trainer.createSession({ count: 1, seed: 7 });
      const n = h.trainer.next(s.sessionId);
      if (n.done) throw new Error('unexpected done');
      // 차트를 지우면 풀이 재구성되고 그 스팟은 더 이상 존재하지 않는다.
      for (const set of h.repo.listSets()) h.repo.deleteSet(set.id);
      h.repo.importSet(fixtureDocs()[0] as never, { source: 'generated' });
      expect(() =>
        h.trainer.answer({ sessionId: s.sessionId, spotKey: n.spot.key, action: n.spot.actions[0] as string, msTaken: 1 }),
      ).toThrow(MissingChartError);
    } finally {
      h.close();
    }
  });
});

describe('P3 5.3 SRS 삽입', () => {
  it('due 인 스팟이 다음 날 다시 나온다', () => {
    const h = harness();
    try {
      const s = h.trainer.createSession({ count: 1, seed: 3 });
      const n = h.trainer.next(s.sessionId);
      if (n.done) throw new Error('unexpected done');
      const key = n.spot.key;
      h.trainer.answer({ sessionId: s.sessionId, spotKey: key, action: n.spot.actions[0] as string, msTaken: 100 });

      // Perfect/Minor 든 무엇이든 첫 복습 간격은 1일이다 (5.3).
      h.clock.advance(DAY_MS + 1000);
      const report = h.trainer.report({ days: 30 });
      expect(report.srs.due).toBe(1);

      // 새 세션에서 같은 스팟이 (동전이 앞면이면) 다시 나온다. 200 회 안에 반드시 한 번은 나온다.
      let seen = false;
      for (let i = 0; i < 50 && !seen; i++) {
        const s2 = h.trainer.createSession({ count: 1, seed: 100 + i });
        const n2 = h.trainer.next(s2.sessionId);
        if (!n2.done && n2.spot.key === key) seen = true;
      }
      expect(seen).toBe(true);
    } finally {
      h.close();
    }
  });

  it('leech (lapses ≥ 3) 는 세션 앞에 강제 배치된다', () => {
    const h = harness();
    try {
      // 같은 스팟을 3번 Blunder 로 만든다: 최악의 액션을 고르면 된다.
      const s = h.trainer.createSession({ count: 1, seed: 4 });
      const first = h.trainer.next(s.sessionId);
      if (first.done) throw new Error('unexpected done');
      const key = first.spot.key;
      const parsed = parseSpotKey(key);

      let cur: NextResult = first;
      let sessionId = s.sessionId;
      for (let i = 0; i < 3; i++) {
        // pending 을 강제로 그 키로 만들기 위해 매번 같은 시드의 1문제 세션을 쓴다.
        if (cur.done) throw new Error('unexpected done');
        const worst = worstAction(h, cur.spot.chartSetId, cur.spot.seq, parsed.combo, cur.spot.actions);
        h.trainer.answer({ sessionId, spotKey: cur.spot.key, action: worst, msTaken: 100 });
        h.clock.advance(DAY_MS + 1000);
        const s2 = h.trainer.createSession({ count: 1, seed: 4 });
        sessionId = s2.sessionId;
        cur = h.trainer.next(sessionId);
        if (!cur.done && cur.spot.key !== key) break;
      }

      const report = h.trainer.report({ days: 30 });
      expect(report.srs.leeches).toBe(1);

      // leech 는 동전과 무관하게 항상 먼저다 (시드 여러 개로 확인).
      for (let i = 0; i < 5; i++) {
        const s3 = h.trainer.createSession({ count: 1, seed: 500 + i });
        const n3 = h.trainer.next(s3.sessionId);
        expect(n3.done).toBe(false);
        if (!n3.done) expect(n3.spot.key).toBe(key);
      }
    } finally {
      h.close();
    }
  });
});

/** 그 콤보에서 EV 가 가장 낮은 액션 (= 확실한 Blunder). */
function worstAction(h: Harness, setId: number, seq: string, combo: number, actions: readonly string[]): string {
  const node = h.repo.getNode(setId, seq);
  if (node === null || node.ev === null) throw new Error('node has no EV');
  let worst = 0;
  for (let a = 1; a < actions.length; a++) {
    if (((node.ev[a] as Float32Array)[combo] as number) < ((node.ev[worst] as Float32Array)[combo] as number)) worst = a;
  }
  return actions[worst] as string;
}

describe('P3 6 리포트 (서비스)', () => {
  it('빈도 채점 차트를 섞어도 EV 평균 분모는 ev 채점 수다', () => {
    const repo = seededRepo();
    const clock = fixedClock(T0);
    const docs = fixtureDocs();
    repo.importSet(withoutEv(docs[0] as never, 'HU push/fold 10bb (no EV)'), { source: 'generated' });
    const trainer = openTrainer({ chartRepo: repo, dbPath: ':memory:', now: clock.now });
    try {
      const noEvHash = repo.listSets().find((s) => !s.hasEv)?.contentHash;
      expect(noEvHash).toBeDefined();
      const s = trainer.createSession({ count: 4, seed: 8, contentHashes: [noEvHash as string] });
      for (;;) {
        const n = trainer.next(s.sessionId);
        if (n.done) break;
        expect(n.spot.gradedBy).toBe('frequency');
        trainer.answer({ sessionId: s.sessionId, spotKey: n.spot.key, action: n.spot.actions[0] as string, msTaken: 10 });
      }
      const report = trainer.report({ days: 30 });
      expect(report.totals.attempts).toBe(4);
      expect(report.totals.evGraded).toBe(0);
      expect(report.totals.meanEvLossBb).toBeNull();
      expect(report.totals.bb100).toBeNull();
      const verdicts = report.totals.byVerdict;
      expect(verdicts.InStrategy + verdicts.OffStrategy).toBe(4);
      expect(verdicts.Perfect).toBe(0);
    } finally {
      trainer.close();
      repo.close();
    }
  });

  it('세션 리포트의 scope 는 durationMs 를 담는다', () => {
    const h = harness();
    try {
      const s = h.trainer.createSession({ count: 1, seed: 2 });
      const n = h.trainer.next(s.sessionId);
      if (n.done) throw new Error('unexpected done');
      h.clock.advance(4000);
      h.trainer.answer({ sessionId: s.sessionId, spotKey: n.spot.key, action: n.spot.actions[0] as string, msTaken: 4000 });
      h.clock.advance(1000);
      const done = h.trainer.next(s.sessionId);
      expect(done.done).toBe(true);
      if (!done.done) return;
      expect(done.report.scope).toEqual({ sessionId: s.sessionId, durationMs: 5000 });
      expect(done.report.bySet[0]?.name).toContain('HU push/fold');
    } finally {
      h.close();
    }
  });

  it('days 창 밖의 기록은 세지 않는다', () => {
    const h = harness();
    try {
      playSession(h, 3, 21, (a) => a[0] as string);
      expect(h.trainer.report({ days: 30 }).totals.attempts).toBe(3);
      h.clock.advance(31 * DAY_MS);
      expect(h.trainer.report({ days: 30 }).totals.attempts).toBe(0);
      expect(h.trainer.report({ days: 365 }).totals.attempts).toBe(3);
    } finally {
      h.close();
    }
  });
});

describe('P3 5.1 풀 재구성', () => {
  it('세션 도중 차트가 바뀌면 다음 next 가 새 풀을 쓴다', () => {
    const h = harness();
    try {
      const s = h.trainer.createSession({ count: 5, seed: 17 });
      const n = h.trainer.next(s.sessionId);
      if (n.done) throw new Error('unexpected done');
      const oldHash = n.spot.contentHash;

      // 전부 지우고 하나만 다시 넣는다 (`seed --replace` 와 같은 모양).
      for (const set of h.repo.listSets()) h.repo.deleteSet(set.id);
      const kept = fixtureDocs()[3];
      h.repo.importSet(kept as never, { source: 'generated' });
      const keptHash = h.repo.listSets()[0]?.contentHash as string;

      const n2 = h.trainer.next(s.sessionId);
      expect(n2.done).toBe(false);
      if (n2.done) return;
      expect(n2.spot.contentHash).toBe(keptHash);
      expect(n2.spot.contentHash === oldHash).toBe(false);
    } finally {
      h.close();
    }
  });
});
