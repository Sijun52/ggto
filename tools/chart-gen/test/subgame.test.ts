/**
 * 서브게임 일관성 (P7.md 5.3) 과 외부 sanity (5.6).
 *
 * `none`·`bba1` 에서는 앞선 폴드가 팟을 바꾸지 않으므로 "k 명이 폴드하고 남은 (n−k) 명"
 * 서브게임은 (n−k)-max 루트와 **동형**이다. `pp0.125` 는 폴더의 앤티가 팟에 남아 동형이
 * 아니다 — 아래 (c) 가 그 차이를 실측해 동형 판정이 공허하지 않음을 보인다.
 *
 * (a) 는 hard 게이트다 (2인 제로섬 서브게임 — 값이 유일하다). n ≥ 3 서브게임 비교는
 * 균형 비유일성 때문에 **보고 항목**이다 (D34).
 */

import { describe, expect, it } from 'vitest';
import { childSeq } from '@ggto/preflop';
import { aggregatePct, solveGame } from '../src/nmax.js';
import { huEvaluate } from '../src/pushFold.js';
import type { AntePreset } from '../src/payoff.js';
import { equity, hasEquity3, tables2, tablesFull } from './fixtures.js';

/**
 * n-max 해의 SB/BB 서브게임 전략을 **HU 게임 안에서** 채점한 ε 의 상한.
 *
 * n-max 게이트는 게임 전체에서 `max_i gain_i < 1e-5` 인데, 그 이득은 "전원 폴드" 노드의
 * 도달 확률로 가중돼 있다 (n=9 의 `none` 에서 0.02 급). 조건부 이득 = 이득 / 도달확률
 * 이므로 HU 기준으로 재면 1e-5 보다 커진다. 1e-3 은 P3 Perfect 임계(0.05bb)의 1/50 이고
 * 게이트(0.005)의 1/5 다 — "같은 균형" 을 말하기에 충분히 좁다.
 */
const SUBGAME_EPSILON_BB = 1e-3;
/** 집계 %p 차이 상한. 5.2 (c) 의 0.2%p 보다 느슨한 이유는 위와 같다 (조건부 수렴). */
const SUBGAME_PCT = 0.5;

const SIZES = [3, 4, 5, 6];
const ANTES: AntePreset[] = ['none', 'bba1'];
const STACKS = [5, 10, 20];

/** `F^{n-2}` (전원 폴드 뒤 SB 노드) 의 seq */
function allFoldSeq(n: number): string {
  let seq = '';
  for (let i = 0; i < n - 2; i++) seq = childSeq(seq, 'F');
  return seq;
}

interface Pair {
  sb: Float64Array;
  bb: Float64Array;
}

/** n-max 해에서 SB·BB 서브게임 전략을 꺼낸다. */
function subgamePair(game: ReturnType<typeof solveGame>): Pair {
  const seq = allFoldSeq(game.tree.n);
  const sbIndex = game.tree.bySeq.get(seq);
  const bbIndex = game.tree.bySeq.get(childSeq(seq, 'A'));
  if (sbIndex === undefined || bbIndex === undefined) throw new Error(`no SB/BB subgame node for n=${String(game.tree.n)}`);
  const sb = game.solve.nodes[sbIndex]?.strategy;
  const bb = game.solve.nodes[bbIndex]?.strategy;
  if (sb === undefined || bb === undefined) throw new Error('missing subgame strategy');
  return { sb, bb };
}

describe.skipIf(!hasEquity3)('5.3 서브게임 일관성 (3-way 표 필요)', () => {
  const cache = new Map<string, ReturnType<typeof solveGame>>();
  const solve = (n: number, ante: AntePreset, stack: number): ReturnType<typeof solveGame> => {
    const key = `${String(n)}|${ante}|${String(stack)}`;
    let hit = cache.get(key);
    if (hit === undefined) {
      hit = solveGame(n, ante, stack, n === 2 ? tables2() : tablesFull());
      cache.set(key, hit);
    }
    return hit;
  };

  for (const ante of ANTES) {
    for (const stack of STACKS) {
      it(`5.3 (a) ${ante} ${String(stack)}bb: n=3..6 의 전원 폴드 뒤 SB/BB 가 2-max 와 같은 균형이다`, () => {
        const two = solve(2, ante, stack);
        const twoPair = subgamePair(two);
        const jamRef = aggregatePct(twoPair.sb, tables2());
        const callRef = aggregatePct(twoPair.bb, tables2());
        for (const n of SIZES) {
          const pair = subgamePair(solve(n, ante, stack));
          // (1) 그 전략쌍을 **HU 게임 안에서** 채점한 ε — 2인 제로섬이라 값이 유일하다.
          const cross = huEvaluate(equity().equity, stack, pair.sb, pair.bb);
          const jam = aggregatePct(pair.sb, tables2());
          const call = aggregatePct(pair.bb, tables2());
          const at = `${ante} ${String(stack)}bb n=${String(n)}`;
          console.log(
            `5.3 (a) ${at}: eps(HU)=${cross.epsilonBb.toExponential(2)} jam ${jam.toFixed(2)}% (2-max ${jamRef.toFixed(2)}%) ` +
              `call ${call.toFixed(2)}% (2-max ${callRef.toFixed(2)}%)`,
          );
          expect(cross.epsilonBb, at).toBeLessThan(SUBGAME_EPSILON_BB);
          expect(Math.abs(jam - jamRef), at).toBeLessThan(SUBGAME_PCT);
          expect(Math.abs(call - callRef), at).toBeLessThan(SUBGAME_PCT);
        }
      });
    }
  }

  it('5.3 (b) F^k 노드의 잼% 와 (n−k)-max 루트의 잼% (보고 항목)', () => {
    const rows: string[] = [];
    let worst = 0;
    for (const ante of ANTES) {
      for (const n of [4, 5, 6]) {
        const game = solve(n, ante, 10);
        for (let k = 1; k <= n - 3; k++) {
          let seq = '';
          for (let i = 0; i < k; i++) seq = childSeq(seq, 'F');
          const index = game.tree.bySeq.get(seq);
          if (index === undefined) throw new Error(`no node ${JSON.stringify(seq)}`);
          const here = aggregatePct(game.solve.nodes[index]?.strategy as Float64Array, tablesFull());
          const root = solve(n - k, ante, 10);
          const there = aggregatePct(root.solve.nodes[0]?.strategy as Float64Array, tablesFull());
          worst = Math.max(worst, Math.abs(here - there));
          rows.push(`  ${ante} 10bb n=${String(n)} F^${String(k)}: ${here.toFixed(2)}% vs ${String(n - k)}-max root ${there.toFixed(2)}% (Δ ${(here - there).toFixed(2)}%p)`);
        }
      }
    }
    console.log(`5.3 (b) 서브게임 잼% 대조 (게이트 아님, Δ > 1%p 면 리뷰 UNCERTAIN)\n${rows.join('\n')}`);
    // 게이트가 아니다 — 값을 남기기만 한다.
    expect(worst).toBeGreaterThanOrEqual(0);
  });

  it('5.3 (c) pp0.125 는 동형이 아니다 (폴더의 앤티가 팟에 남는다)', () => {
    const six = subgamePair(solve(6, 'pp0.125', 10));
    const two = subgamePair(solve(2, 'pp0.125', 10));
    const jamSix = aggregatePct(six.sb, tables2());
    const jamTwo = aggregatePct(two.sb, tables2());
    console.log(`5.3 (c) pp0.125 10bb: 6-max 서브게임 잼 ${jamSix.toFixed(2)}% vs 2-max ${jamTwo.toFixed(2)}%`);
    // 6-max 는 앤티 0.75 가 팟에 남아 (2-max 는 0.25) 잼이 더 넓어야 한다.
    expect(jamSix).toBeGreaterThan(jamTwo + SUBGAME_PCT);
  });
});

/**
 * 5.6 외부 sanity — **게이트가 아니다** (D15: 출처·모델 불명이라 데이터로 쓰지 않는다).
 * pokercoaching.com 의 "9-handed 10bb no ante Nash" 순수전략 차트를 1326 가중으로 센 값.
 */
const POKERCOACHING = [
  { seats: 5, label: 'HJ (뒤 4명)', pct: 20.06 },
  { seats: 3, label: 'BTN (뒤 2명)', pct: 33.03 },
  { seats: 2, label: 'SB (뒤 1명)', pct: 60.48 },
];

describe.skipIf(!hasEquity3)('5.6 외부 sanity (보고 항목)', () => {
  it('5.6 none 10bb 루트 잼% 를 pokercoaching 순수전략 차트와 대조', () => {
    const rows: string[] = [];
    for (const ref of POKERCOACHING) {
      const game = solveGame(ref.seats, 'none', 10, ref.seats === 2 ? tables2() : tablesFull());
      const ours = aggregatePct(game.solve.nodes[0]?.strategy as Float64Array, tables2());
      rows.push(`  ${String(ref.seats)}-max 루트 ${ours.toFixed(2)}% vs ${ref.label} ${String(ref.pct)}% (Δ ${(ours - ref.pct).toFixed(2)}%p)`);
    }
    console.log(`5.6 외부 sanity (게이트 아님)\n${rows.join('\n')}`);
    expect(rows.length).toBe(POKERCOACHING.length);
  });
});
