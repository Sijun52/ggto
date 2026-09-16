/**
 * 모델 게이트 (P7.md 5.1 (a)~(c), 1.2·1.3·1.4).
 *
 * (a) 지불의 제로섬 성질은 **에퀴티 표가 없어도** 성립해야 한다 (share 의 합이 1 이기만
 * 하면 된다) — 그래서 임의의 정규화된 지분 벡터로 검사한다. 표에서 읽은 값으로만 검사하면
 * 표가 우연히 1 로 정규화된 덕인지 지불 식이 맞는 덕인지 구분할 수 없다.
 */

import { createRng } from '@ggto/core';
import { describe, expect, it } from 'vitest';
import { ANTE_PRESETS, BB_BLIND, SB_BLIND, anteOf, foldNowValue, gameSpec, potOf, terminalPayoffs } from '../src/payoff.js';
import { CAP_CALLERS, buildTree } from '../src/tree.js';
import { solveNmax } from '../src/solveNmax.js';
import { hasEquity3, tablesFull } from './fixtures.js';

describe('1.2 앤티 프리셋 (D36)', () => {
  it('1.2 none / bba1 / pp0.125 의 앤티 팟', () => {
    expect(anteOf('none')).toEqual({ mode: 'none' });
    expect(anteOf('bba1')).toEqual({ mode: 'bb_ante', amount: 1 });
    expect(anteOf('pp0.125')).toEqual({ mode: 'per_player', amount: 0.125 });
    expect(gameSpec(9, 'none', 10).antePot).toBe(0);
    // bba1 은 테이블 사이즈와 무관하게 1bb
    expect(gameSpec(9, 'bba1', 10).antePot).toBe(1);
    expect(gameSpec(3, 'bba1', 10).antePot).toBe(1);
    // pp 는 0.125·n — 9-max 1.125, 6-max 0.75
    expect(gameSpec(9, 'pp0.125', 10).antePot).toBeCloseTo(1.125, 12);
    expect(gameSpec(6, 'pp0.125', 10).antePot).toBeCloseTo(0.75, 12);
  });

  it('1.2 블라인드는 마지막 두 자리다 (SB=n-2, BB=n-1)', () => {
    for (let n = 2; n <= 9; n++) {
      const spec = gameSpec(n, 'none', 10);
      expect(spec.positions[n - 2]).toBe('SB');
      expect(spec.positions[n - 1]).toBe('BB');
      expect(spec.blind[n - 2]).toBe(SB_BLIND);
      expect(spec.blind[n - 1]).toBe(BB_BLIND);
      expect([...spec.blind].reduce((a, b) => a + b, 0)).toBe(1.5);
    }
  });

  it('1.2 bba1 은 BB 만, pp 는 전원이 앤티를 낸다', () => {
    const bba = gameSpec(6, 'bba1', 10);
    expect([...bba.ante]).toEqual([0, 0, 0, 0, 0, 1]);
    const pp = gameSpec(6, 'pp0.125', 10);
    expect([...pp.ante]).toEqual([0.125, 0.125, 0.125, 0.125, 0.125, 0.125]);
  });
});

describe('5.1 (a) 모든 터미널에서 지불의 합이 0 이다', () => {
  it('5.1 (a) 임의의 정규화된 지분에서 |Σ u_i| < 1e-12 (n=2..9, 앤티 3종)', () => {
    const rng = createRng(0x5eed_1234);
    let checked = 0;
    let worst = 0;
    for (let n = 2; n <= 9; n++) {
      const tree = buildTree(n, CAP_CALLERS);
      for (const ante of ANTE_PRESETS) {
        const spec = gameSpec(n, ante, 12.5);
        const payoffs = terminalPayoffs(tree, spec);
        for (const [t, z] of tree.terminals.entries()) {
          const pay = payoffs[t];
          if (pay === undefined) throw new Error('missing payoff');
          expect(pay.pot).toBeCloseTo(potOf(z, spec), 12);
          // 지분은 J 안에서만 나뉜다. 임의의 난수를 합이 1 이 되게 정규화한다.
          for (let trial = 0; trial < 5; trial++) {
            const raw = z.J.map(() => rng.nextFloat() + 1e-9);
            const total = raw.reduce((a, b) => a + b, 0);
            let sum = 0;
            for (let i = 0; i < n; i++) {
              const at = z.J.indexOf(i);
              const share = at < 0 ? 0 : (raw[at] as number) / total;
              sum += share * pay.pot + (pay.absBase[i] as number);
            }
            // 전원 폴드 터미널은 BB 가 팟을 다 걷는다.
            if (z.walk) {
              sum = pay.pot + (pay.absBase[n - 1] as number);
              for (let i = 0; i < n - 1; i++) sum += pay.absBase[i] as number;
            }
            worst = Math.max(worst, Math.abs(sum));
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(1e-12);
  });

  it('1.3 노드 기준 EV 의 기준점: base = absBase − u(fold now) = −S + b_i', () => {
    for (let n = 2; n <= 9; n++) {
      const tree = buildTree(n, CAP_CALLERS);
      for (const ante of ANTE_PRESETS) {
        const spec = gameSpec(n, ante, 8);
        const payoffs = terminalPayoffs(tree, spec);
        for (const [t, z] of tree.terminals.entries()) {
          const pay = payoffs[t];
          if (pay === undefined) throw new Error('missing payoff');
          for (const i of z.J) {
            expect(pay.base[i] as number).toBeCloseTo((pay.absBase[i] as number) - foldNowValue(spec, i), 12);
            expect(pay.base[i] as number).toBeCloseTo(-spec.stack + (spec.blind[i] as number), 12);
          }
        }
      }
    }
  });

  it('1.3 전원 폴드 터미널의 팟 = A + 1.5, 2-way 팟 = A + 2S + 남은 블라인드', () => {
    const tree = buildTree(6, CAP_CALLERS);
    const spec = gameSpec(6, 'pp0.125', 10);
    const walk = tree.terminals.find((z) => z.walk);
    if (walk === undefined) throw new Error('no walk terminal');
    expect(potOf(walk, spec)).toBeCloseTo(0.75 + 1.5, 12);
    // UTG 잼 · BTN 콜 (F 는 나머지 넷): 팟 = 0.75 + 2·10 + 0.5 + 1
    const headsUp = tree.terminals.find((z) => z.J.length === 2 && z.J[0] === 0 && z.J[1] === 3);
    if (headsUp === undefined) throw new Error('no 2-way terminal for UTG vs BTN');
    expect(potOf(headsUp, spec)).toBeCloseTo(0.75 + 20 + 1.5, 12);
  });

  it('1.3 n=2 의 잼-콜 EV 는 P2 7.1 의 2S·eq − (S − 0.5) 와 같다', () => {
    const tree = buildTree(2, CAP_CALLERS);
    const stack = 10;
    const spec = gameSpec(2, 'none', stack);
    const payoffs = terminalPayoffs(tree, spec);
    const showdown = tree.terminals.findIndex((z) => z.J.length === 2);
    const pay = payoffs[showdown];
    if (pay === undefined) throw new Error('no showdown terminal');
    for (const eq of [0, 0.25, 0.5, 0.819, 1]) {
      expect(eq * pay.pot + (pay.base[0] as number)).toBeCloseTo(2 * stack * eq - (stack - 0.5), 12);
    }
  });
});

/**
 * 5.1 이 재는 것은 **축약의 구조적 성질**(질량 결함 · 게임값 합)이지 수렴 품질이 아니다.
 * 그래서 300 반복이면 충분하다. 다만 `solveNmax` 는 기본적으로 ε·혼합손실 게이트를
 * 못 넘으면 throw 하는데, 300 반복에서 혼합손실은 당연히 크다 (n=3 4.7e-2, n=4 2.5e-1).
 * 그 게이트는 5.2 가 따로 잰다 — 여기서는 꺼서 5.1 이 실제로 질량 결함을 재게 한다.
 */
const MASS_ONLY = { maxIterations: 300, allowGateFailure: true } as const;

describe.skipIf(!hasEquity3)('5.1 (b)(c) 질량 결함과 게임값 (3-way 표 필요)', () => {
  it('5.1 (b) n=3 은 massDefect < 1e-12, |sumGameValueBb| < 1e-9 (근사 없음)', () => {
    const tree = buildTree(3, CAP_CALLERS);
    const spec = gameSpec(3, 'bba1', 10);
    const res = solveNmax(tree, spec, tablesFull(), terminalPayoffs(tree, spec), MASS_ONLY);
    expect(res.massDefect).toBeLessThan(1e-12);
    expect(Math.abs(res.sumGameValueBb)).toBeLessThan(1e-9);
  });

  it('5.1 (c) n=4 의 massDefect 는 2e-3 아래다 (값을 출력한다)', () => {
    const tree = buildTree(4, CAP_CALLERS);
    const spec = gameSpec(4, 'bba1', 10);
    const res = solveNmax(tree, spec, tablesFull(), terminalPayoffs(tree, spec), MASS_ONLY);
    console.log(`5.1 (c) n=4 bba1 10bb: massDefect=${res.massDefect.toExponential(3)} sumGameValueBb=${res.sumGameValueBb.toExponential(3)}`);
    expect(res.massDefect).toBeLessThan(2e-3);
  });
});
