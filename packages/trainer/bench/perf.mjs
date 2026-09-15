/**
 * P3.md 9절 성능 게이트. P0 5절 / P2 10절과 같은 형식.
 *
 * vitest 밖(plain node)에서 잰다 (D12). 입력은 `test/fixtures` 의 **실제 시드 차트 6개**를
 * `:memory:` 저장소에 넣은 것이다 — 재는 대상은 풀 구성·추첨·채점·리포트이고, 합성
 * 차트로는 reach 분포와 혼합 질량이 실제와 달라져 추첨 비용이 대표성을 잃는다.
 *
 * 부하 인지 집행·runs 5·정확성/예산 분리는 공유 하네스가 한다 (P2 10절 R3).
 *
 * **스펙 9절과 다른 점 (보고서에 등재)**: "next() ×1000 < 300ms" 는 두 케이스로 나눴다.
 *   - `next() 재조회 x1000`: pending 이 있는 next (새로고침 경로). 스펙 예산 300ms 그대로.
 *   - `next()+answer() x1000`: 추첨이 실제로 도는 경로. **답하지 않으면 pending 이 유지돼
 *     추첨이 돌지 않으므로** 한 번의 추첨을 재려면 답이 사이에 들어가야 한다. 이 경로의
 *     유휴 기준값이 ~2.0s 이고 (30일 리크 집계 1.1ms + getNode 해제 + 쓰기 트랜잭션),
 *     0.3ms/문제는 SQLite 쓰기 한 번만으로도 불가능하다. 예산은 기준값의 3배다.
 *
 * 사용: npm run bench -w @ggto/trainer (dist 가 있어야 한다). 유휴 머신에서 강제하려면 --strict.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRepository } from '../../preflop/dist/index.js';
import { buildPool, grade, openTrainer, pickNode, sampleCombo } from '../dist/index.js';
import { runCases } from '../../core/bench/harness.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixtureDir = resolve(here, '../test/fixtures');

const repo = openRepository(':memory:');
for (const file of readdirSync(fixtureDir).filter((f) => f.endsWith('.json')).sort()) {
  repo.importSet(JSON.parse(readFileSync(resolve(fixtureDir, file), 'utf8')), { source: 'generated' });
}
const node = repo.getNode(repo.listSets()[0].id, '');

// 기록 1만 행을 미리 쌓는다 — 빈 DB 에서 빠른 SRS 조회·리포트 집계는 아무것도 증명하지 않는다.
let clock = Date.UTC(2026, 0, 1);
const trainer = openTrainer({ chartRepo: repo, dbPath: ':memory:', now: () => clock });
const ATTEMPTS = 10_000;
const SESSION_MAX = 500;
let filled = 0;
while (filled < ATTEMPTS) {
  const s = trainer.createSession({ count: SESSION_MAX, seed: filled });
  for (let i = 0; i < SESSION_MAX; i++) {
    const next = trainer.next(s.sessionId);
    if (next.done) break;
    clock += 1000;
    trainer.answer({ sessionId: s.sessionId, spotKey: next.spot.key, action: next.spot.actions[0], msTaken: 900 });
  }
  filled = trainer.report({ days: 365 }).totals.attempts;
}

// 재조회(pending) 경로용 세션: 출제만 해 두고 답하지 않는다.
const idle = trainer.createSession({ count: SESSION_MAX, seed: 424_242 });
trainer.next(idle.sessionId);

const pool = buildPool(repo, {});
const leaks = new Map();
const rng = makeRng(12345);

function makeRng(seed) {
  let s = seed >>> 0;
  const nextUint32 = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
  return { nextUint32, nextFloat: () => nextUint32() / 4294967296, nextInt: (b) => nextUint32() % b };
}

/** 20문제 세션을 이어 붙여 총 n 문제를 푼다 (앱이 실제로 하는 모양). */
function playCycles(n, seedBase) {
  let done = 0;
  while (done < n) {
    const s = trainer.createSession({ count: 20, seed: seedBase + done });
    for (let i = 0; i < 20 && done < n; i++) {
      const next = trainer.next(s.sessionId);
      if (next.done) break;
      clock += 1000;
      trainer.answer({ sessionId: s.sessionId, spotKey: next.spot.key, action: next.spot.actions[0], msTaken: 900 });
      done++;
    }
  }
  return done;
}

let cycleSeed = 1_000_000;

const cases = [
  {
    name: 'buildPool (6 seeds, 12 nodes: reach + mixedMass)',
    budgetMs: 200,
    run: () => buildPool(repo, {}).nodes.length,
    check: (v) => (v === 12 ? true : `expected 12 pool nodes, got ${String(v)}`),
  },
  {
    name: 'next() x1000 re-query (pending, refresh path)',
    budgetMs: 300,
    run: () => {
      let n = 0;
      for (let i = 0; i < 1000; i++) {
        const r = trainer.next(idle.sessionId);
        if (!r.done) n++;
      }
      return n;
    },
    check: (v) => (v === 1000 ? true : `expected 1000 spots, got ${String(v)}`),
  },
  {
    name: 'next()+answer() x1000 (draw path, 10k attempts on file)',
    budgetMs: 6000,
    run: () => {
      cycleSeed += 100_000;
      return playCycles(1000, cycleSeed);
    },
    check: (v) => (v === 1000 ? true : `expected 1000 cycles, got ${String(v)}`),
  },
  {
    name: 'draw x1000 (pickNode + sampleCombo only)',
    budgetMs: 100,
    run: () => {
      let acc = 0;
      for (let i = 0; i < 1000; i++) acc += sampleCombo(pickNode(pool.nodes, leaks, rng), rng);
      return acc;
    },
    check: (v) => (Number.isFinite(v) && v > 0 ? true : 'draw produced no combos'),
  },
  {
    name: 'grade() x10000',
    budgetMs: 100,
    run: () => {
      let acc = 0;
      for (let i = 0; i < 10_000; i++) {
        acc += grade({
          actions: node.actions,
          strategy: node.strategy,
          ev: node.ev,
          combo: i % 1326,
          chosen: node.actions[i % node.actions.length],
          gradedBy: 'ev',
        }).evLossBb;
      }
      return acc;
    },
    check: (v) => (Number.isFinite(v) ? true : 'grade returned no EV loss'),
  },
  {
    name: 'report({days:30}) with 10k+ attempts',
    budgetMs: 200,
    run: () => trainer.report({ days: 30 }).totals.attempts,
    check: (v) => (v >= ATTEMPTS ? true : `expected >= ${String(ATTEMPTS)} attempts in window, got ${String(v)}`),
  },
];

await runCases(cases, {
  suite: '@ggto/trainer',
  teardown: () => {
    trainer.close();
    repo.close();
  },
  // P3 9절: 첫 라운드 유휴 기준값. 예산은 기준값의 3배 이상이라 큰 회귀만 잡는다.
  gateNote:
    'gate: idle baselines buildPool 2.7 / next-requery 100 / cycle 2000 / draw 0.6 / grade 0.9 / report 28ms; ' +
    'budgets 200/300/6000/100/100/200ms (>=3x baseline, P3.md 9)',
});
