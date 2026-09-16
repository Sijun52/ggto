/** P7.md 2.1 / D37: 테이블 사이즈별 액션 순서. */
import { describe, expect, it } from 'vitest';
import { preflopState } from '@ggto/core';
import { MAX_TABLE_SIZE, MIN_TABLE_SIZE, tablePositions } from '../src/positions.js';

describe('tablePositions (P7 2.1)', () => {
  it('matches the spec table', () => {
    expect(tablePositions(2)).toEqual(['SB', 'BB']);
    expect(tablePositions(3)).toEqual(['BTN', 'SB', 'BB']);
    expect(tablePositions(4)).toEqual(['CO', 'BTN', 'SB', 'BB']);
    expect(tablePositions(5)).toEqual(['UTG', 'CO', 'BTN', 'SB', 'BB']);
    expect(tablePositions(6)).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    expect(tablePositions(7)).toEqual(['UTG', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    expect(tablePositions(8)).toEqual(['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    expect(tablePositions(9)).toEqual(['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  });

  it('never uses "+" in a position name (D37: "+" decodes to space in form encoding)', () => {
    for (let n = MIN_TABLE_SIZE; n <= MAX_TABLE_SIZE; n++) {
      for (const p of tablePositions(n)) {
        expect(p).not.toContain('+');
        // URL 안전성: 인코딩해도 같은 문자열이어야 ?pos= 왕복이 항등이다.
        expect(encodeURIComponent(p)).toBe(p);
      }
    }
  });

  it('is length n, unique, and ends with SB, BB', () => {
    for (let n = MIN_TABLE_SIZE; n <= MAX_TABLE_SIZE; n++) {
      const ps = tablePositions(n);
      expect(ps).toHaveLength(n);
      expect(new Set(ps).size).toBe(n);
      expect(ps.slice(-2)).toEqual(['SB', 'BB']);
    }
  });

  /**
   * "n 에서 첫 자리를 떼면 n-1" 은 **성립하지 않는다** (2.1 의 표): 9-max 에서 UTG 를 떼면
   * `UTG1 UTG2 LJ …` 인데 8-max 는 `UTG UTG1 LJ …` 다. 사라지는 자리는 맨 앞이 아니라
   * "UTG 다음" 이기 때문이다. 실제로 성립하는 성질만 고정한다.
   */
  it('always ends with CO BTN SB BB (n>=4) and starts with UTG (n>=5)', () => {
    for (let n = 4; n <= MAX_TABLE_SIZE; n++) {
      expect(tablePositions(n).slice(-4)).toEqual(['CO', 'BTN', 'SB', 'BB']);
    }
    for (let n = 5; n <= MAX_TABLE_SIZE; n++) {
      expect(tablePositions(n)[0]).toBe('UTG');
    }
    // 앞 자리는 UTG 뒤에서 사라진다: 9 -> 8 은 UTG2, 8 -> 7 은 UTG1 이 빠진다
    expect(tablePositions(9).filter((p) => !tablePositions(8).includes(p))).toEqual(['UTG2']);
    expect(tablePositions(8).filter((p) => !tablePositions(7).includes(p))).toEqual(['UTG1']);
  });

  it('rejects sizes outside 2..9', () => {
    for (const bad of [-1, 0, 1, 10, 1.5, Number.NaN]) {
      expect(() => tablePositions(bad)).toThrow(RangeError);
    }
  });

  it('drives the core state machine: first actor is UTG (n>=3) or SB (n=2)', () => {
    for (let n = MIN_TABLE_SIZE; n <= MAX_TABLE_SIZE; n++) {
      const positions = tablePositions(n);
      const state = preflopState(
        {
          positions,
          blinds: [
            { pos: 'SB', amount: 0.5 },
            { pos: 'BB', amount: 1 },
          ],
          ante: { mode: 'none' },
          stack: 10,
        },
        [],
      );
      expect(state.toAct).toBe(positions[0]);
    }
  });
});
