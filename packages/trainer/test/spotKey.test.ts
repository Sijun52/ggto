/**
 * P3.md 3.1 스팟 키. 이 문자열이 `attempt.spot_key`·`srs_state.spot_key`·API 필드다.
 */

import { COMBO_COUNT, comboCards, comboIndex, formatCard, parseCard, type ComboIndex } from '@ggto/core';
import { describe, expect, it } from 'vitest';
import { formatCombo, formatSpotKey, parseCombo, parseSpotKey } from '../src/spotKey.js';
import { SpotKeyError } from '../src/types.js';

const HASH = 'a'.repeat(64);
const REAL_HASH = 'deb0595b69da343cd7cbee5fbeb3d1868e9a9e261deba729cebf953cdde13dfe';

describe('P3 3.1 스팟 키 왕복', () => {
  it('1326 콤보 전부가 formatCombo → parseCombo 왕복 항등이다', () => {
    for (let c = 0; c < COMBO_COUNT; c++) {
      expect(parseCombo(formatCombo(c as ComboIndex))).toBe(c);
    }
  });

  it('콤보 키는 P2 5.1 규약 그대로: formatCard(hi) + formatCard(lo)', () => {
    for (let c = 0; c < COMBO_COUNT; c += 97) {
      const [hi, lo] = comboCards(c as ComboIndex);
      expect(formatCombo(c as ComboIndex)).toBe(formatCard(hi) + formatCard(lo));
    }
  });

  it('루트는 빈 seq 이고 4조각이 유지된다', () => {
    const combo = comboIndex(parseCard('As'), parseCard('Kh'));
    const key = formatSpotKey(REAL_HASH, '', combo);
    expect(key).toBe(`pf:${REAL_HASH}::AsKh`);
    expect(parseSpotKey(key)).toEqual({ contentHash: REAL_HASH, seq: '', combo });
  });

  it('seq 가 있는 키도 왕복한다', () => {
    const combo = comboIndex(parseCard('7d'), parseCard('2c'));
    const key = formatSpotKey(HASH, 'A', combo);
    expect(parseSpotKey(key)).toEqual({ contentHash: HASH, seq: 'A', combo });
  });
});

describe('P3 3.1 스팟 키 거부', () => {
  const combo = comboIndex(parseCard('As'), parseCard('Kh'));

  it('ps: 접두는 P6 예약이라 거부한다 (조용히 프리플랍으로 읽지 않는다)', () => {
    expect(() => parseSpotKey(`ps:${HASH}::AsKh`)).toThrow(SpotKeyError);
    expect(() => parseSpotKey(`ps:${HASH}::AsKh`)).toThrow(/reserved for P6/);
  });

  it('알 수 없는 접두는 거부한다', () => {
    expect(() => parseSpotKey(`xx:${HASH}::AsKh`)).toThrow(SpotKeyError);
  });

  it('해시가 64 hex 가 아니면 거부한다 (양쪽 방향 모두)', () => {
    expect(() => parseSpotKey(`pf:abc::AsKh`)).toThrow(SpotKeyError);
    expect(() => parseSpotKey(`pf:${'A'.repeat(64)}::AsKh`)).toThrow(SpotKeyError);
    expect(() => formatSpotKey('abc', '', combo)).toThrow(SpotKeyError);
  });

  it('비정규 콤보(KhAs: lo 가 앞)는 거부한다 — 키가 둘이 되면 안 된다', () => {
    expect(() => parseSpotKey(`pf:${HASH}::KhAs`)).toThrow(/not canonical/);
  });

  it('seq 파싱 실패는 SpotKeyError 다', () => {
    expect(() => parseSpotKey(`pf:${HASH}:ZZZ:AsKh`)).toThrow(SpotKeyError);
  });

  it('조각 수가 4 가 아니면 거부한다', () => {
    expect(() => parseSpotKey(`pf:${HASH}:AsKh`)).toThrow(SpotKeyError);
    expect(() => parseSpotKey(`pf:${HASH}::AsKh:extra`)).toThrow(SpotKeyError);
  });
});
