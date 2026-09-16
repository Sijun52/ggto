/**
 * n-max 솔버 게이트: 5.2 HU 회귀 · 5.4 단조성·상식.
 *
 * 5.2 는 **3-way 표를 쓰지 않는다** (n=2 에는 3-way 쇼다운도 (h,y) 행렬도 없다). 그래서
 * 표가 없는 작업 트리에서도 "새 솔버 = 옛 HU 솔버" 를 실측으로 고정할 수 있다.
 */

import { handClassCombos } from '@ggto/core';
import { CLASS_KEYS } from '@ggto/preflop';
import { describe, expect, it } from 'vitest';
import { bestResponse } from '../src/bestResponse.js';
import { aggregatePct, solveGame } from '../src/nmax.js';
import { huEvaluate, solvePushFold } from '../src/pushFold.js';
import { DEFAULT_ITERATIONS } from '../src/chart.js';
import { EPSILON_GATE_BB } from '../src/solveNmax.js';
import { equity, hasEquity3, tables2, tablesFull } from './fixtures.js';

/**
 * **두 솔버를 같은 반복수에서 비교한다** (P7.md 5.2 의 (R2) 판정 = "같은 균형인가").
 *
 * 실측: 5,000 반복에서 두 구현의 전략·EV L∞ 차이는 **1e-14** 다 (부동소수 잡음). 반면
 * 출하 설정(ε < 1e-5 에서 정지, 2-max 는 350~450 반복)에서는 무차별 클래스의 평균 전략이
 * 아직 흔들려 L∞ 가 0.3 까지 가고 그 클래스의 EV 가 0.024bb 어긋난다 — **다른 균형이라서가
 * 아니라 덜 수렴해서**다 (같은 반복수에서는 1e-14 로 맞는다). 그래서 (b)(d) 의 1e-3 판정은
 * 같은 반복수에서 걸고, 출하 설정은 (a) ε 과 (c) 집계 %p 로 따로 고정한다.
 */
const EQUAL_ITERATIONS = DEFAULT_ITERATIONS;

/**
 * P7.md 5.2 의 기준값 — 옛 `HU push/fold Nbb (generated)` 파일에서 읽은 수치다.
 * 새 솔버는 **다른 코드**(n-player 트리·조건부 확률)로 같은 값을 내야 한다.
 */
const REFERENCE = [
  { stack: 5, jamPct: 71.49, callPct: 62.07, aaJamEv: 2.99379 },
  { stack: 8, jamPct: 61.86, callPct: 44.97, aaJamEv: 3.40021 },
  { stack: 10, jamPct: 58.28, callPct: 37.38, aaJamEv: 3.477902 },
  { stack: 12, jamPct: 53.24, callPct: 33.03, aaJamEv: 3.587459 },
  { stack: 15, jamPct: 45.66, callPct: 28.55, aaJamEv: 3.718465 },
  { stack: 20, jamPct: 40.22, callPct: 21.72, aaJamEv: 3.734893 },
];

const AA = CLASS_KEYS.indexOf('AA');
const t2 = tables2();

const solved = REFERENCE.map((ref) => ({
  ...ref,
  old: solvePushFold(equity().equity, ref.stack, DEFAULT_ITERATIONS),
  /** 같은 반복수 — 구현 대 구현 */
  fresh: solveGame(2, 'none', ref.stack, t2, { maxIterations: EQUAL_ITERATIONS, epsilonTarget: 0 }),
  /** 출하 설정 (ε < 1e-5 에서 정지) */
  shipped: solveGame(2, 'none', ref.stack, t2),
}));

function linf(a: Float64Array, b: Float64Array): { max: number; at: number } {
  let max = 0;
  let at = -1;
  for (let h = 0; h < a.length; h++) {
    const d = Math.abs((a[h] as number) - (b[h] as number));
    if (d > max) {
      max = d;
      at = h;
    }
  }
  return { max, at };
}

describe('5.2 HU 회귀 — 새 n-max 솔버(n=2, none) vs 기존 pushFold.ts', () => {
  for (const s of solved) {
    const label = `${String(s.stack)}bb`;

    it(`5.2 (a) ${label} 옛 해를 새 BR 로 재보면 ε < 1e-5 이고 그 역도 성립한다`, () => {
      // 옛 해 → 새 best response (완전히 다른 축약 경로). 전략만 넣으므로 솔브는 안 쓴다.
      const viaNew = crossEpsilon(s.shipped, s.old.sbJam, s.old.bbCall);
      // 새 해(출하 설정) → 옛 평가기
      const viaOld = huEvaluate(
        equity().equity,
        s.stack,
        s.shipped.solve.nodes[0]?.strategy as Float64Array,
        s.shipped.solve.nodes[1]?.strategy as Float64Array,
      );
      console.log(
        `5.2 (a) ${label}: old->newBR eps=${viaNew.toExponential(2)}  newShipped->oldEval eps=${viaOld.epsilonBb.toExponential(2)}  ` +
          `shipped eps=${s.shipped.solve.epsilonBb.toExponential(2)} (it=${String(s.shipped.solve.iterations)})`,
      );
      expect(viaNew).toBeLessThan(1e-5);
      expect(viaOld.epsilonBb).toBeLessThan(1e-5);
      expect(s.shipped.solve.epsilonBb).toBeLessThan(EPSILON_GATE_BB);
    });

    it(`5.2 (b) ${label} 두 해의 차이가 0.02 를 넘는 클래스는 전부 무차별(|EV| < 1e-3)이다`, () => {
      for (const [k, strategyOld] of [s.old.sbJam, s.old.bbCall].entries()) {
        const strategyNew = s.fresh.solve.nodes[k]?.strategy as Float64Array;
        const evNew = s.fresh.solve.nodes[k]?.ev as Float64Array;
        const evOld = k === 0 ? s.old.sbJamEv : s.old.bbCallEv;
        for (let h = 0; h < CLASS_KEYS.length; h++) {
          const d = Math.abs((strategyOld[h] as number) - (strategyNew[h] as number));
          if (d < 0.02) continue;
          const message = `${label} node ${String(k)} ${String(CLASS_KEYS[h])}: d=${d.toFixed(4)} evNew=${(evNew[h] as number).toExponential(2)} evOld=${(evOld[h] as number).toExponential(2)}`;
          expect(Math.abs(evNew[h] as number), message).toBeLessThan(1e-3);
          expect(Math.abs(evOld[h] as number), message).toBeLessThan(1e-3);
        }
      }
    });

    it(`5.2 (c) ${label} 1326 가중 집계 잼%·콜% 차이가 0.2%p 미만이고 기준값과 맞는다`, () => {
      // 여기서는 **출하 설정** 을 쓴다 — 실제로 파일에 들어가는 레인지가 기준값과 맞아야 한다.
      const jamNew = aggregatePct(s.shipped.solve.nodes[0]?.strategy as Float64Array, t2);
      const callNew = aggregatePct(s.shipped.solve.nodes[1]?.strategy as Float64Array, t2);
      const jamOld = aggregatePct(s.old.sbJam, t2);
      const callOld = aggregatePct(s.old.bbCall, t2);
      console.log(`5.2 (c) ${label}: jam ${jamNew.toFixed(2)}% (old ${jamOld.toFixed(2)}%, ref ${String(s.jamPct)}%)  call ${callNew.toFixed(2)}% (old ${callOld.toFixed(2)}%, ref ${String(s.callPct)}%)`);
      expect(Math.abs(jamNew - jamOld)).toBeLessThan(0.2);
      expect(Math.abs(callNew - callOld)).toBeLessThan(0.2);
      // 기준값(파일에서 읽은 값, 소수 둘째 자리 반올림)
      expect(Math.abs(jamNew - s.jamPct)).toBeLessThan(0.2);
      expect(Math.abs(callNew - s.callPct)).toBeLessThan(0.2);
    });

    it(`5.2 (d) ${label} 게임값(SB) 차 < 1e-4, 클래스 EV L∞ < 1e-3`, () => {
      const sbValueNew = s.fresh.solve.gameValueBb[0] as number;
      expect(Math.abs(sbValueNew - s.old.sbValueBb)).toBeLessThan(1e-4);
      // 제로섬: 두 플레이어 값의 합이 0
      expect(Math.abs(s.fresh.solve.sumGameValueBb)).toBeLessThan(1e-9);
      const jamEv = linf(s.fresh.solve.nodes[0]?.ev as Float64Array, s.old.sbJamEv);
      const callEv = linf(s.fresh.solve.nodes[1]?.ev as Float64Array, s.old.bbCallEv);
      console.log(
        `5.2 (d) ${label}: value ${sbValueNew.toFixed(6)} vs ${s.old.sbValueBb.toFixed(6)}; ` +
          `EV L∞ jam ${jamEv.max.toExponential(2)} (${String(CLASS_KEYS[jamEv.at])}) call ${callEv.max.toExponential(2)} (${String(CLASS_KEYS[callEv.at])})`,
      );
      expect(jamEv.max).toBeLessThan(1e-3);
      expect(callEv.max).toBeLessThan(1e-3);
      // AA 잼 EV 는 기준표의 값과 같다
      expect(Math.abs((s.fresh.solve.nodes[0]?.ev[AA] as number) - s.aaJamEv)).toBeLessThan(1e-3);
      // 출하 설정(ε < 1e-5 정지)의 EV 잡음: 실측 최대 2.1e-3 (8bb). P3 의 Perfect 임계
      // 0.05bb 의 1/20 이고, 차트 안에서 전략과 EV 는 **서로 일관**된다 (5.4 (f)).
      const shippedAaGap = Math.abs((s.shipped.solve.nodes[0]?.ev[AA] as number) - s.aaJamEv);
      console.log(`5.2 (d) ${label}: shipped AA jam EV gap = ${shippedAaGap.toExponential(2)}bb`);
      expect(shippedAaGap).toBeLessThan(1e-2);
    });
  }

  it('5.4 (g) 결정성: 같은 입력을 두 번 풀면 값이 같다', () => {
    const a = solveGame(2, 'bba1', 10, t2);
    const b = solveGame(2, 'bba1', 10, t2);
    expect(a.solve.iterations).toBe(b.solve.iterations);
    for (const [k, node] of a.solve.nodes.entries()) {
      expect([...node.strategy]).toEqual([...(b.solve.nodes[k]?.strategy as Float64Array)]);
      expect([...node.ev]).toEqual([...(b.solve.nodes[k]?.ev as Float64Array)]);
    }
  });

  it('2.2 3-way 표 없이 n>=3 을 풀려고 하면 조용히 0 을 쓰지 않고 throw 한다', () => {
    expect(() => solveGame(3, 'none', 10, t2, { maxIterations: 1 })).toThrow(/3-way equity table/);
  });
});

/** 주어진 전략을 새 BR 코드로 채점한다 (솔버를 돌리지 않는다). */
function crossEpsilon(game: ReturnType<typeof solveGame>, jam: Float64Array, call: Float64Array): number {
  return Math.max(...bestResponse(game.tree, game.spec, t2, game.payoffs, [jam, call]).gains);
}

describe.skipIf(!hasEquity3)('5.4 단조성·상식 (n=6, 3-way 표 필요)', () => {
  const STACKS = [5, 10, 15];
  // describe 의 본문은 skip 여부와 무관하게 수집 단계에서 돈다 — 표 로딩·솔브는 테스트
  // 안에서 처음 필요할 때 한 번만 한다.
  let cache: { stack: number; game: ReturnType<typeof solveGame> }[] | null = null;
  const games = (): { stack: number; game: ReturnType<typeof solveGame> }[] => {
    cache ??= STACKS.map((stack) => ({ stack, game: solveGame(6, 'bba1', stack, tablesFull()) }));
    return cache;
  };

  it('5.4 (a) AA 는 모든 노드에서 비폴드 100%', () => {
    for (const s of games()) {
      for (const [k, node] of s.game.solve.nodes.entries()) {
        expect(node.strategy[AA] as number, `${String(s.stack)}bb node ${String(k)}`).toBeGreaterThan(0.999);
      }
    }
  });

  it('5.4 (b) 오픈 잼% 는 포지션이 늦을수록 단조 비감소다', () => {
    for (const s of games()) {
      const opens = s.game.tree.nodes
        .map((node, k) => ({ node, k }))
        .filter((x) => x.node.kind === 'open' && x.node.priorFolders.every((f) => !f.forced) && x.node.seq.split('-').every((c) => c === 'F' || c === ''))
        .sort((a, b) => a.node.actor - b.node.actor);
      const pcts = opens.map((x) => aggregatePct(s.game.solve.nodes[x.k]?.strategy as Float64Array, tablesFull()));
      console.log(`5.4 (b) 6-max bba1 ${String(s.stack)}bb open jam%: ${pcts.map((p) => p.toFixed(1)).join(' ')}`);
      for (let i = 1; i < pcts.length; i++) {
        expect((pcts[i] as number) + 1e-9).toBeGreaterThanOrEqual(pcts[i - 1] as number);
      }
    }
  });

  it('5.4 (c) 스택이 줄수록 같은 노드의 잼% 가 비감소다', () => {
    const byStack = games().map((s) => aggregatePct(s.game.solve.nodes[0]?.strategy as Float64Array, tablesFull()));
    for (let i = 1; i < byStack.length; i++) {
      expect((byStack[i - 1] as number) + 1e-9).toBeGreaterThanOrEqual(byStack[i] as number);
    }
  });

  it('5.4 (d) 앤티가 있으면 잼% 가 넓어진다 (bba1 > none, pp > none)', () => {
    const none = solveGame(6, 'none', 10, tablesFull());
    const pp = solveGame(6, 'pp0.125', 10, tablesFull());
    const bba = games().find((s) => s.stack === 10);
    if (bba === undefined) throw new Error('missing 10bb solve');
    const pct = (g: ReturnType<typeof solveGame>): number => aggregatePct(g.solve.nodes[0]?.strategy as Float64Array, tablesFull());
    console.log(`5.4 (d) 6-max 10bb UTG jam%: none ${pct(none).toFixed(2)} bba1 ${pct(bba.game).toFixed(2)} pp ${pct(pp).toFixed(2)}`);
    expect(pct(bba.game)).toBeGreaterThan(pct(none));
    expect(pct(pp)).toBeGreaterThan(pct(none));
  });

  it('5.4 (f) EV 와 전략이 일관된다 (EV > 1e-3 → 1, EV < −1e-3 → 0)', () => {
    for (const s of games()) {
      for (const [k, node] of s.game.solve.nodes.entries()) {
        for (let h = 0; h < CLASS_KEYS.length; h++) {
          const ev = node.ev[h] as number;
          const p = node.strategy[h] as number;
          const at = `${String(s.stack)}bb node ${String(k)} ${String(CLASS_KEYS[h])} ev=${ev.toExponential(2)}`;
          if (ev > 1e-3) expect(p, at).toBeGreaterThan(0.99);
          if (ev < -1e-3) expect(p, at).toBeLessThan(0.01);
        }
      }
    }
  });

  it('5.4 (e) 20bb 6-max UTG 72o 잼 0% (9-max 는 test:slow 에 있다)', () => {
    const game = solveGame(6, 'none', 20, tablesFull());
    const h = CLASS_KEYS.indexOf('72o');
    expect(handClassCombos(h).length).toBe(12);
    expect(game.solve.nodes[0]?.strategy[h] as number).toBe(0);
  });
});
