import { describe, expect, it } from 'vitest';
import {
  CARD_COUNT,
  COMBO_COUNT,
  CardSyntaxError,
  comboCards,
  comboContainsAny,
  comboIndex,
  parseCards,
} from '../src/index.js';

describe('4.1 combo (1326)', () => {
  it('4.1 comboIndex/comboCards 가 0..1325 전단사 (1326개 전부 왕복, 중복 없음, 범위 내)', () => {
    const seen = new Uint8Array(COMBO_COUNT);
    let n = 0;
    for (let hi = 1; hi < CARD_COUNT; hi++) {
      for (let lo = 0; lo < hi; lo++) {
        const i = comboIndex(hi, lo);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(COMBO_COUNT);
        expect(seen[i]).toBe(0);
        seen[i] = 1;
        n++;
        const [a, b] = comboCards(i);
        expect(a).toBe(hi);
        expect(b).toBe(lo);
        // 인수 순서 무관
        expect(comboIndex(lo, hi)).toBe(i);
      }
    }
    expect(n).toBe(COMBO_COUNT);
    // C(52,2) = 1326
    expect((52 * 51) / 2).toBe(COMBO_COUNT);
    for (let i = 0; i < COMBO_COUNT; i++) expect(seen[i]).toBe(1);
  });

  it('4.1 comboIndex 공식은 hi*(hi-1)/2 + lo', () => {
    expect(comboIndex(1, 0)).toBe(0);
    expect(comboIndex(51, 50)).toBe(1325);
    expect(comboIndex(10, 3)).toBe((10 * 9) / 2 + 3);
  });

  it('4.1 같은 카드 두 장이면 throw', () => {
    expect(() => comboIndex(5, 5)).toThrow(CardSyntaxError);
    expect(() => comboIndex(52, 0)).toThrow(CardSyntaxError);
  });

  it('4.1 comboContainsAny', () => {
    const [as, kh] = parseCards('AsKh') as [number, number];
    const i = comboIndex(as, kh);
    expect(comboContainsAny(i, parseCards('As'))).toBe(true);
    expect(comboContainsAny(i, parseCards('Kh'))).toBe(true);
    expect(comboContainsAny(i, parseCards('2c3d4h'))).toBe(false);
    expect(comboContainsAny(i, parseCards('2c3dKh'))).toBe(true);
    expect(comboContainsAny(i, [])).toBe(false);
  });
});
