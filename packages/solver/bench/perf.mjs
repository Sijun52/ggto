/**
 * P4.md 9절 성능 게이트 — **순수 TS 케이스만** ("`ci` 의 벤치는 첫 행만", 9절).
 *
 * 데몬 왕복은 `bench/integration.mjs` 가 따로 잰다 (`npm run bench:solver`).
 *
 * **왜 한 프로세스에 합치면 안 되나**: 공유 하네스의 부하 보정은 "벤치는 단일 스레드" 를
 * 가정해 자기 기여 상한을 `1/ncpu` 로 잡는다. 그런데 솔버 자식은 rayon 으로 **전 코어**를
 * 쓴다 — 같이 돌리면 우리 자신의 부하가 `external` 로 잡혀 load 가 66% 로 뜨고 예산이
 * 영원히 집행되지 않는다 (실측). 프로세스를 나누면 이 케이스의 부하 판정이 정확해진다.
 */

import { buildConfig, configHash } from '../dist/index.js';
import { runCases } from '../../core/bench/harness.mjs';

const REQUEST = {
  oop: '22+,A2s+,K9s+,QTs+,ATo+,KJo+',
  ip: 'TT-22,AJs-A2s,KTs+,QJs,AQo-ATo',
  board: 'Ks7h2h',
  potBb: 20,
  stackBb: 80,
  sizings: 'simple',
};

const cases = [
  {
    name: 'buildConfig + canonicalize + configHash x1000',
    budgetMs: 500,
    run: () => {
      let acc = 0;
      for (let i = 0; i < 1000; i++) {
        acc += configHash(buildConfig({ ...REQUEST, potBb: 20 + (i % 7) })).length;
      }
      return acc;
    },
    check: (v) => (v === 64_000 ? true : `expected 1000 x 64 hex chars, got ${String(v)}`),
  },
];

await runCases(cases, {
  suite: '@ggto/solver',
  gateNote:
    'gate: 이 케이스가 곧 D5 정규화 비용이다 (canonicalize 가 24 순열 x 2 레인지 x 1326 을 훑는다). ' +
    '데몬 왕복·런아웃·콜드 스타트는 npm run bench:solver 가 잰다 (P4.md 9).',
});
