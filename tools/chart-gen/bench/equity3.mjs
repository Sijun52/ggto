/**
 * P7.md 3.5 — 3-way MC 샘플러 처리량. 예산 >= 1.5M 샘플/s (단일 워커).
 *
 * 미달이면 S 를 줄이기 전에 최적화한다. 최적화 뒤에도 미달일 때만 S = 50,000 폴백이고
 * 그때는 3.1 의 EV 잡음 한계가 0.02bb -> 0.03bb 로 오른다.
 *
 * 부하 인지 집행·runs·정확성 분리는 공유 하네스가 한다 (P2 10절 R3).
 */

import { CLASS_KEYS } from '../../../packages/preflop/dist/index.js';
import { sampleTriple } from '../dist/equity3Mc.js';
import { runCases } from '../../../packages/core/bench/harness.mjs';

const SAMPLES = 1_000_000;
const TARGET_PER_SEC = 1_500_000;
const idx = (k) => CLASS_KEYS.indexOf(k);
// AA/KK/QQ — 3.4 의 정답값이 있는 트리플이라 처리량과 정확도를 한 번에 본다.
const sorted = [idx('AA'), idx('KK'), idx('QQ')].sort((a, b) => a - b);
const [i, j, k] = sorted;
const EXACT = { AA: 0.669793, KK: 0.177457, QQ: 0.152749 };

const cases = [
  {
    name: `sampleTriple AA/KK/QQ x${String(SAMPLES)} (budget = ${String(TARGET_PER_SEC)} samples/s)`,
    budgetMs: (SAMPLES / TARGET_PER_SEC) * 1000,
    warmup: 1,
    runs: 3,
    run: () => sampleTriple(i, j, k, SAMPLES),
    check: (v) => {
      // CLASS_KEYS 순서가 AA<KK<QQ 라는 보장이 없으므로 클래스 이름으로 되짚는다.
      const byName = new Map([
        [CLASS_KEYS[i], v.shares[0]],
        [CLASS_KEYS[j], v.shares[1]],
        [CLASS_KEYS[k], v.shares[2]],
      ]);
      for (const [name, exact] of Object.entries(EXACT)) {
        const got = byName.get(name);
        if (!(Math.abs(got - exact) < 0.005)) return `${name}: ${got} vs exact ${exact} (|d| >= 0.005)`;
      }
      if (v.w3 !== 216) return `w3 = ${v.w3}, expected 216 (6x6x6)`;
      return true;
    },
  },
];

await runCases(cases, {
  suite: 'chart-gen/equity3',
  gateNote: `gate: >= ${String(TARGET_PER_SEC)} samples/s single worker (P7 3.5); shares within 0.5%p of the exact 3-way values (P7 3.4)`,
});
