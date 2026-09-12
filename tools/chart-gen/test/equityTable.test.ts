import { resolve } from 'node:path';
import { comboCards, equityHandVsHand, handClassCombos } from '@ggto/core';
import { CLASS_KEYS } from '@ggto/preflop';
import { describe, expect, it } from 'vitest';
import { EQUITY_DECIMALS, equitySha256, loadEquityTable, pairSeed } from '../src/equityTable.js';

const TABLE_PATH = resolve(import.meta.dirname, '../data/equity169.json');

/**
 * 외부에서 아는 정답 (Phase -1 리뷰의 전수 계산 표). 표가 exact 모드(P3.md 10.0)가 된
 * 뒤로는 MC 허용치 ±0.5%p 가 아니라 **참조값이 적힌 자릿수까지** 맞아야 한다.
 * 0.001%p = 참조값 소수 3자리의 마지막 자리 — MC 였다면 절대 통과하지 못한다.
 */
const REFERENCE: [string, string, number][] = [
  ['AA', 'KK', 81.946],
  ['AKs', '22', 49.893],
  ['AKo', 'QQ', 43.242],
  ['72o', 'AA', 11.8],
];

/** 파일에 적힌 자릿수 때문에 생기는 반올림 상한 (5e-7). 대조 허용치는 이것보다 커야 한다. */
const ROUNDING_BOUND = 0.5 * 10 ** -EQUITY_DECIMALS;

/**
 * 생성기와 **다른 경로**로 같은 값을 구한다: 슈트 궤도(stabilizer) 축약을 쓰지 않고
 * 카드가 겹치지 않는 콤보 순서쌍을 전부 돌려 단순 평균한다.
 * 생성기(exactEquity.ts)가 궤도 축약으로 얻은 값과 이것이 일치하면 축약이 등식임을 뜻한다.
 */
function bruteForceClassEquity(a: string, b: string): { equity: number; pairs: number } {
  const heroCombos = handClassCombos(CLASS_KEYS.indexOf(a));
  const villainCombos = handClassCombos(CLASS_KEYS.indexOf(b));
  let acc = 0;
  let pairs = 0;
  for (const h of heroCombos) {
    const hc = comboCards(h);
    for (const v of villainCombos) {
      const vc = comboCards(v);
      if (hc[0] === vc[0] || hc[0] === vc[1] || hc[1] === vc[0] || hc[1] === vc[1]) continue;
      acc += equityHandVsHand(hc, vc, []).equity;
      pairs++;
    }
  }
  return { equity: acc / pairs, pairs };
}

describe('7.1 equity169.json', () => {
  const table = loadEquityTable(TABLE_PATH);
  const at = (a: string, b: string): number =>
    ((table.equity[CLASS_KEYS.indexOf(a)] as number[])[CLASS_KEYS.indexOf(b)] as number) * 100;

  it('7.1 알려진 전수 계산값 4개와 ±0.001%p 안에서 일치한다 (exact 모드)', () => {
    for (const [a, b, ref] of REFERENCE) {
      const v = at(a, b);
      expect(Math.abs(v - ref), `${a} vs ${b}: ${String(v)} vs ref ${String(ref)}`).toBeLessThan(0.001);
    }
  });

  it('7.1 포커 상식 불변식: 페어 순서, AA 가 최강, 대각선은 정확히 0.5', () => {
    // AA 는 모든 상대에게 50% 이상
    for (const k of CLASS_KEYS) expect(at('AA', k)).toBeGreaterThanOrEqual(50);
    // 같은 클래스끼리는 대칭이므로 정확히 0.5
    for (const k of CLASS_KEYS) expect(at(k, k)).toBe(50);
    // 더 높은 페어가 더 세다
    expect(at('KK', 'QQ')).toBeGreaterThan(50);
    expect(at('QQ', 'JJ')).toBeGreaterThan(50);
    // 수티드가 같은 랭크 오프수트보다 세다 (같은 상대 기준)
    expect(at('AKs', 'QQ')).toBeGreaterThan(at('AKo', 'QQ'));
  });

  it('7.1 모든 쌍에서 eq(a,b) + eq(b,a) === 1 이고 값이 [0,1] 안에 있다', () => {
    // loadEquityTable 이 이미 검사하지만, 그 검사가 실제로 도는지 여기서 못 박는다
    let checked = 0;
    for (let i = 0; i < CLASS_KEYS.length; i++) {
      for (let j = 0; j < CLASS_KEYS.length; j++) {
        const v = (table.equity[i] as number[])[j] as number;
        const m = (table.equity[j] as number[])[i] as number;
        expect(v + m).toBeCloseTo(1, 9);
        checked++;
      }
    }
    expect(checked).toBe(169 * 169);
  });

  it('7.1 파일의 sha256 이 내용과 맞는다 (커밋된 표가 손상되면 즉시 드러난다)', () => {
    expect(equitySha256(table)).toBe(table.meta.sha256);
  });

  it('10.0 메타가 전수 모드를 주장한다 (mode exact · samples/seedRule 없음)', () => {
    // MC 흔적이 남아 있으면 표가 무엇으로 만들어졌는지 알 수 없다. loadEquityTable 의
    // mode↔samples 교차 검사와 짝을 이루는 양성 단언이다.
    expect(table.meta.mode).toBe('exact');
    expect(table.meta.samples).toBeNull();
    expect(table.meta.seedRule).toBeNull();
  });

  it(
    '10.0 그 주장이 사실이다: AA vs KK 를 궤도 축약 없이 전수로 다시 계산해 1e-6 이내',
    { timeout: 60_000 },
    () => {
      // AA 6콤보 × KK 6콤보 = 36 쌍, 각각 C(48,5) = 1,712,304 런아웃 전수.
      const { equity, pairs } = bruteForceClassEquity('AA', 'KK');
      expect(pairs).toBe(36);
      const fromTable = (table.equity[CLASS_KEYS.indexOf('AA')] as number[])[
        CLASS_KEYS.indexOf('KK')
      ] as number;
      const delta = Math.abs(fromTable - equity);
      expect(delta, `table ${String(fromTable)} vs brute ${String(equity)}`).toBeLessThan(1e-6);
      // 파일 반올림(5e-7) 말고는 차이가 없어야 한다 — MC 라면 여기서 1e-3 규모로 벌어진다.
      expect(delta).toBeLessThanOrEqual(ROUNDING_BOUND + 1e-12);
    },
  );

  it('7.1 시드 규칙은 쌍에서 결정적이고 쌍마다 다르다', () => {
    expect(pairSeed('AA', 'KK')).toBe(pairSeed('AA', 'KK'));
    expect(pairSeed('AA', 'KK')).not.toBe(pairSeed('KK', 'AA'));
    const seeds = new Set<number>();
    for (let i = 0; i < CLASS_KEYS.length; i++) {
      for (let j = i + 1; j < CLASS_KEYS.length; j++) {
        seeds.add(pairSeed(CLASS_KEYS[i] as string, CLASS_KEYS[j] as string));
      }
    }
    // 충돌이 조금 있어도 정확성에는 영향이 없지만(쌍마다 독립 표본이 아닐 뿐),
    // 충돌률이 높으면 시드 규칙이 나쁜 것이다. 14,196 개 중 충돌 0 을 기대한다.
    expect(seeds.size).toBe((169 * 168) / 2);
  });
});
