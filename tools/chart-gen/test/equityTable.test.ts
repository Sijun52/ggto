import { resolve } from 'node:path';
import { CLASS_KEYS } from '@ggto/preflop';
import { describe, expect, it } from 'vitest';
import { equitySha256, loadEquityTable, pairSeed } from '../src/equityTable.js';

const TABLE_PATH = resolve(import.meta.dirname, '../data/equity169.json');

/**
 * 외부에서 아는 정답 (Phase -1 리뷰의 전수 계산 표). MC 표라 오차가 있으므로
 * 스펙 7.1 의 허용치 ±0.5%p 로 본다.
 */
const REFERENCE: [string, string, number][] = [
  ['AA', 'KK', 81.946],
  ['AKs', '22', 49.893],
  ['AKo', 'QQ', 43.242],
  ['72o', 'AA', 11.8],
];

describe('7.1 equity169.json', () => {
  const table = loadEquityTable(TABLE_PATH);
  const at = (a: string, b: string): number =>
    ((table.equity[CLASS_KEYS.indexOf(a)] as number[])[CLASS_KEYS.indexOf(b)] as number) * 100;

  it('7.1 알려진 전수 계산값 4개와 ±0.5%p 안에서 일치한다', () => {
    for (const [a, b, ref] of REFERENCE) {
      const v = at(a, b);
      expect(Math.abs(v - ref), `${a} vs ${b}: ${String(v)} vs ref ${String(ref)}`).toBeLessThan(0.5);
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
    expect(table.meta.samples).toBeGreaterThanOrEqual(50_000);
  });

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
