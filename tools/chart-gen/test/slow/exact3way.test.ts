/**
 * `npm run test:slow` — P7.md 3.4 의 나머지 6개 트리플을 **전수**로 재계산한다.
 *
 * 기본 테스트는 AA/AA/KK 하나만 돈다 (2초). 여기는 (b,c) 쌍이 많은 트리플까지 전부라
 * 수십 초 걸린다. 표(MC)가 아니라 **스펙에 박힌 정답값**을 검증하는 것이 목적이다.
 */

import { CLASS_KEYS } from '@ggto/preflop';
import { describe, expect, it } from 'vitest';
import { exactThreeWayShares } from '../exact3way.js';

const idx = (k: string): number => {
  const i = CLASS_KEYS.indexOf(k);
  if (i < 0) throw new Error(`unknown class ${k}`);
  return i;
};

/** P7.md 3.4 (AA/AA/KK 는 기본 테스트에 있다) */
const KNOWN = [
  { classes: ['AA', 'KK', 'QQ'], shares: [0.669793, 0.177457, 0.152749] },
  { classes: ['AKo', 'AQo', 'KQo'], shares: [0.718424, 0.200983, 0.080592] },
  { classes: ['T9s', '76s', 'A2o'], shares: [0.398541, 0.296689, 0.30477] },
  { classes: ['JJ', 'AKs', '87s'], shares: [0.411396, 0.389735, 0.19887] },
  { classes: ['QQ', 'AKo', 'AKo'], shares: [0.654286, 0.172857, 0.172857] },
  { classes: ['72o', '72o', '72o'], shares: [1 / 3, 1 / 3, 1 / 3] },
];

describe('3.4 정답값 전수 재계산 (test:slow)', () => {
  for (const known of KNOWN) {
    it(`3.4 ${known.classes.join('/')}`, () => {
      const withIndex = known.classes.map((name, at) => ({ c: idx(name), s: known.shares[at] as number }));
      withIndex.sort((a, b) => a.c - b.c);
      const exact = exactThreeWayShares(
        withIndex[0]?.c as number,
        withIndex[1]?.c as number,
        withIndex[2]?.c as number,
      );
      console.log(
        `3.4 ${known.classes.join('/')} 전수: ${exact.shares.map((s) => s.toFixed(6)).join(' / ')} ` +
          `(${String(exact.pairs)} pairs × C(46,5) = ${String(exact.samples)} boards)`,
      );
      for (let at = 0; at < 3; at++) {
        // 전수끼리의 비교라 MC 허용오차(0.5%p)가 아니라 반올림 수준(1e-5)을 요구한다.
        expect(Math.abs((exact.shares[at] as number) - (withIndex[at]?.s as number))).toBeLessThan(1e-5);
      }
    });
  }
});
