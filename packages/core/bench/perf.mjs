/**
 * P0.md 5절 성능 게이트 (R1).
 *
 * vitest(Vite SSR 변환) 안에서는 ESM import 바인딩이 네임스페이스 프로퍼티 로드로 바뀌어
 * 같은 코드가 plain node 대비 최대 6~7배 느리게 측정된다. 실제 런타임은 dist 를 plain node 로
 * import 하는 것이므로 예산 판정은 여기서 한다. 예산 초과면 exit 1.
 *
 * (R3) 부하 인지 집행·runs 5·정확성/예산 분리는 공유 하네스 `harness.mjs` 가 한다 (P2 10절).
 *
 * 사용: npm run bench  (build 후 실행). 유휴 머신에서 예산을 강제하려면 --strict.
 */

import {
  canonicalBoard,
  equityHandVsHand,
  equityRangeVsRange,
  fullRange,
  normalize,
  parseCard,
  parseCards,
  parseRange,
  removeBoard,
  toHandClassView,
} from '../dist/index.js';
import { runCases } from './harness.mjs';

function* flops() {
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      for (let c = b + 1; c < 52; c++) yield [a, b, c];
    }
  }
}

const OPEN_RANGE = '22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,86s+,75s+,65s,A9o+,KTo+,QTo+,JTo';

const cases = [
  {
    name: 'parseRange x1000',
    budgetMs: 1000,
    run: () => {
      let acc = 0;
      for (let i = 0; i < 1000; i++) acc += parseRange(OPEN_RANGE)[0];
      return acc;
    },
  },
  {
    name: 'removeBoard+normalize+toHandClassView x1000',
    budgetMs: 200,
    run: () => {
      const r = fullRange();
      const board = parseCards('Ks7h2d');
      let acc = 0;
      for (let i = 0; i < 1000; i++) acc += toHandClassView(normalize(removeBoard(r, board))).count[0];
      return acc;
    },
  },
  {
    name: 'equityRangeVsRange exact full-vs-full on flop',
    budgetMs: 5000,
    runs: 1,
    warmup: 0,
    run: () => equityRangeVsRange(fullRange(), fullRange(), parseCards('Ks7h2d'), { mode: 'exact' }).hero,
    check: (v) => Math.abs(v - 0.5) < 1e-9 || `hero equity ${v} != 0.5`,
  },
  {
    name: 'equityHandVsHand AsAh vs KsKd preflop exhaustive',
    budgetMs: 5000,
    runs: 1,
    warmup: 0,
    run: () => equityHandVsHand([parseCard('As'), parseCard('Ah')], [parseCard('Ks'), parseCard('Kd')], []).equity,
    check: (v) => Math.abs(v - 0.81946) < 1e-4 || `AA vs KK equity ${v}`,
  },
  {
    name: 'canonicalBoard x22100 flops',
    budgetMs: 3000,
    runs: 2,
    warmup: 0,
    run: () => {
      let n = 0;
      for (const f of flops()) n += canonicalBoard(f).board[0];
      return n;
    },
  },
];

runCases(cases, {
  suite: '@ggto/core',
  // 이 스위트의 예산은 유휴 기준값 대비 3~10배로 잡혀 있다 (P0 5절). 규모 회귀 탐지용이지
  // 수 % 의 성능 변화를 보는 도구가 아니다.
  gateNote: 'gate: coarse budgets (3~10x idle baseline) — catches order-of-magnitude regressions only',
});
