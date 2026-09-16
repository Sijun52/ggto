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

  it('is a suffix chain: tablePositions(n) ends with tablePositions(n-1)', () => {
    for (let n = MIN_TABLE_SIZE + 1; n <= MAX_TABLE_SIZE; n++) {
      expect(tablePositions(n).slice(1)).toEqual([...tablePositions(n - 1)]);
    }
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
