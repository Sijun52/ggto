/**
 * P2.md 10절 성능 게이트. P0 5절과 같은 형식.
 *
 * vitest 밖(plain node)에서 잰다 (D12). 입력 차트는 chart-gen 에 의존하지 않고
 * 여기서 169 키를 core 로 만들어 구성한다 — 재는 대상은 저장소·코덱이지 생성기가 아니다.
 *
 * (R3) 부하 인지 집행·runs 5·정확성/예산 분리는 공유 하네스 `../../core/bench/harness.mjs` 가 한다.
 *
 * 사용: npm run bench -w @ggto/preflop (dist 가 있어야 한다). 유휴 머신에서 강제하려면 --strict.
 */

import { handClassName, HAND_CLASS_COUNT } from '../../core/dist/index.js';
import { openRepository } from '../dist/index.js';
import { runCases } from '../../core/bench/harness.mjs';

function doc(stack) {
  const mk = (seq, actions, cutoff) => {
    const strategy = {};
    const ev = {};
    for (let h = 0; h < HAND_CLASS_COUNT; h++) {
      const key = handClassName(h);
      const p = h < cutoff ? 1 : 0;
      strategy[key] = [1 - p, p];
      ev[key] = [0, Number((2 - h / 100).toFixed(4))];
    }
    return { seq, actions, strategy, ev };
  };
  return {
    format: 'ggto-json',
    version: 1,
    name: `bench HU ${stack}bb`,
    gameType: 'cash',
    config: {
      positions: ['SB', 'BB'],
      blinds: [
        { pos: 'SB', amount: 0.5 },
        { pos: 'BB', amount: 1 },
      ],
      ante: { mode: 'none' },
      stack,
    },
    rake: { mode: 'none' },
    resolution: '169',
    evBasis: 'stack_delta_from_node',
    source: { kind: 'manual', name: 'bench fixture' },
    nodes: [mk('', ['F', 'A'], 60 + stack), mk('A', ['F', 'C'], 40 + stack)],
  };
}

const STACKS = [5, 8, 10, 12, 15, 20];
const docs = STACKS.map(doc);

const cases = [
  {
    name: 'importSet x6 seeds (12 nodes, 1326 expand + zstd)',
    budgetMs: 500,
    run: () => {
      const repo = openRepository(':memory:');
      let n = 0;
      for (const d of docs) n += repo.importSet(d).nodes;
      repo.close();
      return n;
    },
    check: (v) => (v === 12 ? true : `expected 12 nodes, got ${String(v)}`),
  },
];

// getNode / reach 는 채워진 저장소가 필요하다.
const repo = openRepository(':memory:');
const ids = docs.map((d) => repo.importSet(d).id);
const firstId = ids[0];

cases.push(
  {
    name: 'getNode x1000 (zstd decompress included)',
    budgetMs: 300,
    run: () => {
      let acc = 0;
      for (let i = 0; i < 1000; i++) {
        const node = repo.getNode(firstId, i % 2 === 0 ? '' : 'A');
        acc += node.strategy[1][0];
      }
      return acc;
    },
    check: (v) => (Number.isFinite(v) ? true : 'getNode returned no data'),
  },
  {
    name: 'reach depth 2 x1000',
    budgetMs: 300,
    run: () => {
      let acc = 0;
      for (let i = 0; i < 1000; i++) acc += repo.reach(firstId, 'A-C', 'SB')[0];
      return acc;
    },
    check: (v) => (Number.isFinite(v) ? true : 'reach returned no data'),
  },
);

await runCases(cases, {
  suite: '@ggto/preflop',
  teardown: () => {
    repo.close();
  },
  // P2 10절 R3-6: 예산 수치는 R1/R2 그대로다. 유휴 기준값이 getNode 137/145ms, reach 102/120ms
  // 이므로 300ms 예산은 기준 대비 약 2.2배 = **2.2배 이상의 회귀만 잡는다**. 1.5배로 조이는 것은
  // 유휴 기준값이 세 라운드 이상 안정된 뒤 P3 이후에 결정한다.
  gateNote:
    'gate: budgets 500/300/300ms vs idle baseline getNode 137-145 / reach 102-120ms ' +
    '=> catches only >=2.2x regressions (tightening to 1.5x deferred, P2 10.6)',
});
