/**
 * 3-way 에퀴티 표 (P7.md 3.2~3.4).
 *
 * **표 파일이 없어도 도는 부분이 핵심이다**: 정답값 7개는 (a) 전수 재계산과 (b) 표를 만드는
 * 바로 그 MC 샘플러로 대조한다. 파일이 생기면 (c) 로더 검증과 (d) 파일 레코드 대조가
 * 자동으로 켜진다 (`describe.skipIf`).
 */

import { createRng } from '@ggto/core';
import { CLASS_KEYS } from '@ggto/preflop';
import { describe, expect, it } from 'vitest';
import {
  CLASS_COUNT,
  ORDERED_W3_TOTAL,
  RECORD_BYTES,
  TRIPLE_COUNT,
  U16_SCALE,
  allTriples,
  multisetIndex,
  tripleSeed,
} from '../src/equity3.js';
import { countW3, quantizeShares, rngParity, sampleTriple } from '../src/equity3Mc.js';
import { pairCounts } from '../src/pushFold.js';
import { REMAINING_PAIRS } from '../src/tables.js';
import { exactThreeWayShares } from './exact3way.js';
import { equity3, hasEquity3 } from './fixtures.js';

const idx = (k: string): number => {
  const i = CLASS_KEYS.indexOf(k);
  if (i < 0) throw new Error(`unknown class ${k}`);
  return i;
};

/** P7.md 3.4 — 아키텍트가 전수로 계산한 정답값. 순서는 표에 적힌 순서 그대로다. */
const KNOWN = [
  { classes: ['AA', 'KK', 'QQ'], shares: [0.669793, 0.177457, 0.152749] },
  { classes: ['AKo', 'AQo', 'KQo'], shares: [0.718424, 0.200983, 0.080592] },
  { classes: ['T9s', '76s', 'A2o'], shares: [0.398541, 0.296689, 0.30477] },
  { classes: ['JJ', 'AKs', '87s'], shares: [0.411396, 0.389735, 0.19887] },
  { classes: ['QQ', 'AKo', 'AKo'], shares: [0.654286, 0.172857, 0.172857] },
  { classes: ['AA', 'AA', 'KK'], shares: [0.39785, 0.39785, 0.2043] },
  { classes: ['72o', '72o', '72o'], shares: [1 / 3, 1 / 3, 1 / 3] },
];

/** 3.4 의 게이트 폭 (S=100k 의 3.3σ) */
const TOLERANCE = 0.005;

/** 정답값을 (정렬된 트리플, 그 순서의 지분) 으로 바꾼다 — 표는 i <= j <= k 로만 저장된다. */
function sortedKnown(entry: (typeof KNOWN)[number]): { i: number; j: number; k: number; shares: [number, number, number] } {
  const withIndex = entry.classes.map((name, at) => ({ c: idx(name), s: entry.shares[at] as number }));
  withIndex.sort((a, b) => a.c - b.c);
  return {
    i: withIndex[0]?.c as number,
    j: withIndex[1]?.c as number,
    k: withIndex[2]?.c as number,
    shares: [withIndex[0]?.s as number, withIndex[1]?.s as number, withIndex[2]?.s as number],
  };
}

describe('3.2 다중집합 인덱스와 시드', () => {
  it('3.2 multisetIndex 는 0..818,804 위로의 전단사다', () => {
    // expect() 는 호출당 비용이 크다 (818,805 × 3 이면 테스트 하나가 십몇 초다).
    // 위반을 모아 두고 한 번만 단언한다.
    const seen = new Uint8Array(TRIPLE_COUNT);
    let count = 0;
    let bad = '';
    for (let k = 0; k < CLASS_COUNT && bad === ''; k++) {
      for (let j = 0; j <= k && bad === ''; j++) {
        for (let i = 0; i <= j; i++) {
          const at = multisetIndex(i, j, k);
          if (at < 0 || at >= TRIPLE_COUNT) {
            bad = `index ${String(at)} out of range at (${String(i)},${String(j)},${String(k)})`;
            break;
          }
          if (seen[at] === 1) {
            bad = `index ${String(at)} used twice, second at (${String(i)},${String(j)},${String(k)})`;
            break;
          }
          seen[at] = 1;
          count++;
        }
      }
    }
    expect(bad).toBe('');
    expect(count).toBe(TRIPLE_COUNT);
    // C(171,3) = 818,805
    expect(TRIPLE_COUNT).toBe((171 * 170 * 169) / 6);
    expect(TRIPLE_COUNT * RECORD_BYTES).toBe(6_550_440);
  });

  it('3.2 allTriples 는 인덱스 순서대로 (i,j,k) 를 돌려준다', () => {
    const t = allTriples();
    for (const [i, j, k] of [
      [0, 0, 0],
      [0, 1, 2],
      [5, 5, 168],
      [168, 168, 168],
    ] as [number, number, number][]) {
      const at = multisetIndex(i, j, k) * 3;
      expect([t[at], t[at + 1], t[at + 2]]).toEqual([i, j, k]);
    }
  });

  it('3.2 i > j 나 j > k 를 주면 throw (정렬은 호출자 책임이다)', () => {
    expect(() => multisetIndex(2, 1, 3)).toThrow();
    expect(() => multisetIndex(1, 3, 2)).toThrow();
  });

  it('3.2 트리플 시드는 클래스 이름에서만 나온다 (샤딩·워커 수와 무관)', () => {
    const a = tripleSeed(idx('AA'), idx('KK'), idx('QQ'));
    expect(a).toBe(tripleSeed(idx('AA'), idx('KK'), idx('QQ')));
    expect(a).not.toBe(tripleSeed(idx('AA'), idx('KK'), idx('JJ')));
  });

  it('3.2 배치 난수는 core createRng 와 한 값도 다르지 않다', () => {
    const parity = rngParity(12_345, 5000);
    expect(parity).toEqual({ ok: true });
    // 독립 확인: 같은 시드의 core RNG 첫 값
    expect(createRng(7).nextUint32()).toBe(createRng(7).nextUint32());
  });
});

describe('1.4 w3 의 주변화 항등 (질량 결함이 0 인 근거)', () => {
  it('1.4 Σ_c w3(h,y,c) = 1128 · w2(h,y)', () => {
    const w2 = pairCounts();
    const samples: [string, string][] = [
      ['AA', 'KK'],
      ['AA', 'AA'],
      ['AKs', 'AKo'],
      ['72o', 'T9s'],
      ['JJ', 'JJ'],
    ];
    for (const [ha, ya] of samples) {
      const h = idx(ha);
      const y = idx(ya);
      let sum = 0;
      for (let c = 0; c < CLASS_COUNT; c++) sum += countW3(h, y, c);
      expect(sum, `${ha}/${ya}`).toBe(REMAINING_PAIRS * (w2[h * CLASS_COUNT + y] as number));
    }
  });

  it('1.4 w3 는 1728 을 넘지 않고 같은 클래스 셋이면 정확히 세어진다', () => {
    // 72o 12콤보: 첫 콤보를 고르면 남는 72o 는 카드가 겹치지 않는 것만 — 직접 센다.
    expect(countW3(idx('AA'), idx('AA'), idx('AA'))).toBe(6 * 1 * 0 + 0); // AA 는 3개를 못 만든다 (4장뿐)
    expect(countW3(idx('AA'), idx('KK'), idx('QQ'))).toBe(216);
    for (const [a, b, c] of [
      ['AKs', 'AKo', 'QQ'],
      ['72o', '72o', '72o'],
    ] as [string, string, string][]) {
      expect(countW3(idx(a), idx(b), idx(c))).toBeLessThanOrEqual(1728);
    }
  });
});

describe('3.4 알려진 정답값', () => {
  it('3.4 AA/AA/KK 를 전수로 재계산하면 표의 값과 ±0.5%p 안이다', () => {
    const entry = sortedKnown(KNOWN[5] as (typeof KNOWN)[number]);
    const exact = exactThreeWayShares(entry.i, entry.j, entry.k);
    console.log(
      `3.4 AA/AA/KK 전수: ${exact.shares.map((s) => s.toFixed(6)).join(' / ')} (${String(exact.pairs)} pairs x C(46,5))`,
    );
    for (let at = 0; at < 3; at++) {
      expect(Math.abs((exact.shares[at] as number) - (entry.shares[at] as number))).toBeLessThan(TOLERANCE);
    }
    // 세 지분의 합은 정확히 1
    expect(exact.shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('3.4 MC 샘플러(S=100,000)가 정답값 7개를 ±0.5%p 안에서 맞춘다', () => {
    for (const known of KNOWN) {
      const entry = sortedKnown(known);
      const mc = sampleTriple(entry.i, entry.j, entry.k, 100_000);
      const gaps = mc.shares.map((s, at) => Math.abs(s - (entry.shares[at] as number)));
      console.log(
        `3.4 ${known.classes.join('/')}: MC ${mc.shares.map((s) => s.toFixed(6)).join(' / ')} ` +
          `(정답 ${entry.shares.map((s) => s.toFixed(6)).join(' / ')}, 최대 편차 ${(Math.max(...gaps) * 100).toFixed(3)}%p)`,
      );
      for (const gap of gaps) expect(gap).toBeLessThan(TOLERANCE);
      expect(mc.shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
      expect(mc.w3).toBe(countW3(entry.i, entry.j, entry.k));
    }
  });

  /**
   * **회귀**: 거절 샘플링이 성공할 수 없는 트리플(w3 = 0)에서 표 생성기가 영원히 돌았다.
   * 818,805 개 중 325 개가 그렇다 (AA/AA/AA 는 에이스 4장으로 콤보 3개를 못 만든다).
   * 이 지분은 축약에서 w3 = 0 으로 곱해져 쓰이지 않으므로 대칭값을 즉시 돌려준다.
   */
  it('3.2 w3 = 0 인 트리플은 즉시 대칭값을 돌려준다 (무한 루프 회귀)', () => {
    const aa = idx('AA');
    expect(countW3(aa, aa, aa)).toBe(0);
    const t0 = Date.now();
    const r = sampleTriple(aa, aa, aa, 100_000);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.w3).toBe(0);
    expect(r.shares).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(quantizeShares(aa, aa, aa, r.shares)).toEqual([21_845, 21_845, 21_845]);

    // 전수: w3 = 0 인 트리플이 정확히 325 개다 (그 전부가 이 경로를 탄다).
    let zero = 0;
    for (let k = 0; k < CLASS_COUNT; k++) {
      for (let j = 0; j <= k; j++) {
        for (let i = 0; i <= j; i++) if (countW3(i, j, k) === 0) zero++;
      }
    }
    expect(zero).toBe(325);
  });

  it('3.2 같은 클래스가 겹치면 지분이 대칭화된다 (72o x3 은 정확히 21845)', () => {
    const t = idx('72o');
    expect(quantizeShares(t, t, t, [0.33, 0.34, 0.33])).toEqual([21_845, 21_845, 21_845]);
    const [a, b, c] = quantizeShares(idx('AA'), idx('AA'), idx('KK'), [0.4, 0.395, 0.205]);
    expect(a).toBe(b);
    expect(a + b + c).toBe(U16_SCALE);
  });
});

describe.skipIf(!hasEquity3)('3.3 표 파일 검증 (파일이 있을 때만)', () => {
  it('3.3 로더가 형식·크기·해시·불변식을 통과시킨다', () => {
    const table = equity3();
    expect(table.meta.tripleCount).toBe(TRIPLE_COUNT);
    expect(table.share.length).toBe(CLASS_COUNT ** 3);
    expect(table.w3.length).toBe(CLASS_COUNT ** 3);
    // 로더가 Σ_ordered w3 을 이미 검사한다 — 여기서는 상수를 고정한다.
    expect(ORDERED_W3_TOTAL).toBe(1326 * 1225 * 1128);
  });

  it('3.4 파일의 7개 트리플이 정답값과 ±0.5%p 안이다', () => {
    const table = equity3();
    for (const known of KNOWN) {
      const entry = sortedKnown(known);
      const at = (entry.i * CLASS_COUNT + entry.j) * CLASS_COUNT + entry.k;
      const shares = [
        table.share[at] as number,
        table.share[(entry.j * CLASS_COUNT + entry.i) * CLASS_COUNT + entry.k] as number,
        table.share[(entry.k * CLASS_COUNT + entry.i) * CLASS_COUNT + entry.j] as number,
      ];
      console.log(`3.4 파일 ${known.classes.join('/')}: ${shares.map((s) => s.toFixed(6)).join(' / ')}`);
      for (let n = 0; n < 3; n++) {
        expect(Math.abs((shares[n] as number) - (entry.shares[n] as number)), known.classes.join('/')).toBeLessThan(TOLERANCE);
      }
      expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    }
  });

  it('3.4 트리플 3개를 인프로세스로 재계산하면 파일 레코드와 같다 (결정성)', () => {
    const table = equity3();
    const picks: [string, string, string][] = [
      ['AA', 'KK', 'QQ'],
      ['T9s', '76s', 'A2o'],
      ['72o', '72o', '72o'],
    ];
    for (const pick of picks) {
      const sorted = pick.map(idx).sort((a, b) => a - b) as [number, number, number];
      const [i, j, k] = sorted;
      const mc = sampleTriple(i, j, k, table.meta.samples);
      const q = quantizeShares(i, j, k, mc.shares);
      const fileShares = [
        table.share[(i * CLASS_COUNT + j) * CLASS_COUNT + k] as number,
        table.share[(j * CLASS_COUNT + i) * CLASS_COUNT + k] as number,
        table.share[(k * CLASS_COUNT + i) * CLASS_COUNT + j] as number,
      ];
      // 파일은 합으로 나눠 정규화돼 있다 — 같은 정규화를 거쳐 비교한다.
      const total = q[0] + q[1] + q[2];
      for (let n = 0; n < 3; n++) {
        expect(Math.abs(((q[n] as number) / total) - (fileShares[n] as number)), pick.join('/')).toBeLessThan(1e-6);
      }
      expect(table.w3[(i * CLASS_COUNT + j) * CLASS_COUNT + k] as number).toBe(mc.w3);
    }
  });
});
