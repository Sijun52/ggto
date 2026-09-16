/**
 * 3-way 클래스 지분의 **전수** 계산 (P7.md 3.4 의 정답값을 독립적으로 재계산한다).
 *
 * 표 자체는 MC 다 (D32: 전수는 818,805 트리플 × 3~8초 = 1,100 코어시간). 그러나 트리플
 * **하나**의 전수는 초 단위라, 표의 값을 "알려진 정답" 과 대조하는 데 쓸 수 있다.
 *
 * 줄이는 근거는 `exactEquity.ts` 와 같다: 슈트 순열은 프리플랍 게임의 자기동형이고 임의의
 * a 를 대표 a₀ 로 보내는 순열이 "a 와 안 겹치는 (b,c) 쌍" 을 "a₀ 와 안 겹치는 (b,c) 쌍"
 * 위로 전단사시킨다. 따라서 **클래스 i 의 콤보 하나를 고정**하고 (b,c) 전부 × C(46,5)
 * 보드 전부를 도는 것이 전체 평균과 같다 (근사가 아니라 등식).
 *
 * 보드 루프는 스칼라만 쓴다 (객체를 만들면 1.37M × 5 할당이 계산보다 비싸다).
 */

import { comboCards, handClassCombos } from '@ggto/core';
import { evaluateMasks } from '@ggto/core/internal';

export interface ExactShares {
  shares: [number, number, number];
  /** (b,c) 쌍 수 × C(46,5) */
  samples: number;
  pairs: number;
}

/** C(46,5) */
export const BOARDS_46_5 = 1_370_754;

/** 클래스 i,j,k 의 정확한 팟 지분 (동률은 1/t 씩). 트리플당 수 초. */
export function exactThreeWayShares(i: number, j: number, k: number): ExactShares {
  const hero = handClassCombos(i)[0];
  if (hero === undefined) throw new Error(`hand class ${String(i)} has no combos`);
  const [a1, a2] = comboCards(hero);
  let sa = 0;
  let sb = 0;
  let sc = 0;
  let pairs = 0;

  for (const bCombo of handClassCombos(j)) {
    const [b1, b2] = comboCards(bCombo);
    if (b1 === a1 || b1 === a2 || b2 === a1 || b2 === a2) continue;
    for (const cCombo of handClassCombos(k)) {
      const [c1, c2] = comboCards(cCombo);
      if (c1 === a1 || c1 === a2 || c1 === b1 || c1 === b2) continue;
      if (c2 === a1 || c2 === a2 || c2 === b1 || c2 === b2) continue;
      pairs++;
      const used = [a1, a2, b1, b2, c1, c2];
      const deck: number[] = [];
      for (let card = 0; card < 52; card++) if (!used.includes(card)) deck.push(card);
      if (deck.length !== 46) throw new Error(`deck has ${String(deck.length)} cards, expected 46`);

      // 랭크 카운트 마스크 m1..m4 와 슈트 마스크 s0..s3 를 단계마다 이어 붙인다.
      const rank = new Int32Array(46);
      const suit = new Int32Array(46);
      for (let x = 0; x < 46; x++) {
        rank[x] = 1 << ((deck[x] as number) >> 2);
        suit[x] = (deck[x] as number) & 3;
      }
      const bump = (m: Int32Array, r: number, s: number): void => {
        m[3] = (m[3] as number) | ((m[2] as number) & r);
        m[2] = (m[2] as number) | ((m[1] as number) & r);
        m[1] = (m[1] as number) | ((m[0] as number) & r);
        m[0] = (m[0] as number) | r;
        m[4 + s] = (m[4 + s] as number) | r;
      };
      const stack = [new Int32Array(8), new Int32Array(8), new Int32Array(8), new Int32Array(8), new Int32Array(8)];

      for (let x0 = 0; x0 < 42; x0++) {
        const l0 = stack[0] as Int32Array;
        l0.fill(0);
        bump(l0, rank[x0] as number, suit[x0] as number);
        for (let x1 = x0 + 1; x1 < 43; x1++) {
          const l1 = stack[1] as Int32Array;
          l1.set(l0);
          bump(l1, rank[x1] as number, suit[x1] as number);
          for (let x2 = x1 + 1; x2 < 44; x2++) {
            const l2 = stack[2] as Int32Array;
            l2.set(l1);
            bump(l2, rank[x2] as number, suit[x2] as number);
            for (let x3 = x2 + 1; x3 < 45; x3++) {
              const l3 = stack[3] as Int32Array;
              l3.set(l2);
              bump(l3, rank[x3] as number, suit[x3] as number);
              for (let x4 = x3 + 1; x4 < 46; x4++) {
                const l4 = stack[4] as Int32Array;
                l4.set(l3);
                bump(l4, rank[x4] as number, suit[x4] as number);
                const va = evalHole(l4, a1, a2);
                const vb = evalHole(l4, b1, b2);
                const vc = evalHole(l4, c1, c2);
                const best = va > vb ? (va > vc ? va : vc) : vb > vc ? vb : vc;
                let ties = 0;
                if (va === best) ties++;
                if (vb === best) ties++;
                if (vc === best) ties++;
                const gain = 1 / ties;
                if (va === best) sa += gain;
                if (vb === best) sb += gain;
                if (vc === best) sc += gain;
              }
            }
          }
        }
      }
    }
  }
  if (pairs === 0) throw new Error(`classes ${String(i)},${String(j)},${String(k)} have no disjoint combo triple`);
  const total = pairs * BOARDS_46_5;
  return { shares: [sa / total, sb / total, sc / total], samples: total, pairs };
}

/** 보드 마스크(m1..m4, s0..s3)에 홀 카드 2장을 더해 평가한다. */
function evalHole(board: Int32Array, c1: number, c2: number): number {
  let m1 = board[0] as number;
  let m2 = board[1] as number;
  let m3 = board[2] as number;
  let m4 = board[3] as number;
  let s0 = board[4] as number;
  let s1 = board[5] as number;
  let s2 = board[6] as number;
  let s3 = board[7] as number;
  for (const card of [c1, c2]) {
    const b = 1 << (card >> 2);
    m4 |= m3 & b;
    m3 |= m2 & b;
    m2 |= m1 & b;
    m1 |= b;
    const su = card & 3;
    if (su === 0) s0 |= b;
    else if (su === 1) s1 |= b;
    else if (su === 2) s2 |= b;
    else s3 |= b;
  }
  return evaluateMasks(m1, m2, m3, m4, s0, s1, s2, s3);
}
