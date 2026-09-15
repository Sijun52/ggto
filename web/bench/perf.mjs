/**
 * P5.md 9절 — 프론트 핫 경로. **vitest 밖, plain node** (D12).
 *
 * 노드를 하나 옮길 때마다 브라우저가 하는 일이 정확히 이 둘이다:
 *   1. base64 ~150KB → `Float32Array` 뷰 (D7)
 *   2. 1326 → 169 집계 (D14 — 격자는 서버의 169 을 쓰지 않는다)
 * 둘 다 메인 스레드에서 돌므로 합이 한 프레임(16ms)을 크게 넘으면 탭이 끊긴다.
 *
 * `web/src/*.ts` 를 **그대로** import 한다 (Node 24 의 타입 스트리핑). 벤치용으로 로직을
 * 베껴 오면 측정 대상이 실물이 아니게 된다.
 */

import { runCases } from '../../packages/core/bench/harness.mjs';
import { COMBO_COUNT } from '@ggto/core';
import { decodeF32Rows } from '../src/lib/f32.ts';
import { buildChartCells } from '../src/lib/chartGrid.ts';

const ACTIONS = ['X', 'B6.6', 'A'];

/** 실제 노드와 같은 모양: 3 액션 × 1326 (전략·EV) + 1326 두 개 (도달) */
function makeRows(n) {
  const rows = [];
  for (let a = 0; a < n; a++) {
    const r = new Float32Array(COMBO_COUNT);
    for (let c = 0; c < COMBO_COUNT; c++) r[c] = ((c * 7 + a * 13) % 97) / 97;
    rows.push(r);
  }
  return rows;
}

function toB64(rows) {
  const flat = new Float32Array(rows.length * COMBO_COUNT);
  rows.forEach((r, i) => flat.set(r, i * COMBO_COUNT));
  return Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength).toString('base64');
}

const STRATEGY = makeRows(3);
const EV = makeRows(3);
const REACH = (() => {
  const r = new Float32Array(COMBO_COUNT);
  // 1/4 은 레인지 밖 (0) — 분모 0 클래스 경로도 지난다.
  for (let c = 0; c < COMBO_COUNT; c++) r[c] = c % 4 === 0 ? 0 : ((c % 13) + 1) / 13;
  return r;
})();
const B64 = toB64(STRATEGY);
const COLORS = { X: '#38bdf8', 'B6.6': '#f59e0b', A: '#dc2626' };

const cases = [
  {
    name: 'decodeF32Rows 3x1326 x1000',
    budgetMs: 50,
    run: () => {
      let acc = 0;
      for (let i = 0; i < 1000; i++) acc += decodeF32Rows(B64, 3)[2][1325];
      return acc;
    },
    check: (v) => (Number.isFinite(v) ? true : `expected a finite sum, got ${String(v)}`),
  },
  {
    name: 'aggregate 1326 -> 169 x1000',
    budgetMs: 200,
    run: () => {
      let acc = 0;
      for (let i = 0; i < 1000; i++) {
        const cells = buildChartCells({ actions: ACTIONS, strategy: STRATEGY, ev: EV, reach: REACH }, COLORS);
        acc += cells[0].freq[0];
      }
      return acc;
    },
    check: (v) => (v > 0 ? true : `expected a positive frequency sum, got ${String(v)}`),
  },
];

await runCases(cases, {
  suite: '@ggto/web',
  gateNote:
    'gate: 노드 이동 한 번에 드는 브라우저 비용이다 (디코드 + 169 집계). ' +
    '예산 50/200ms 는 1000회 기준이므로 한 번은 0.05/0.2ms 다 — 프레임 예산(16ms)의 2% 미만.',
});
