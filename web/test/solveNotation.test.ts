/**
 * P5.md 1.2 / 8.1 — 표기 보관과 쿼리 조립 (D13·D26).
 *
 * 가장 중요한 단언은 `+` 다: `URLSearchParams` 를 쓰면 리터럴 `+` 가 공백이 되어
 * `22+,A2s+` 가 **에러 없이** 다른 레인지가 된다 (P1 R1 MAJOR 1 에서 실제로 일어났다).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearNotation,
  loadNotation,
  notationQuery,
  saveNotation,
  type SolveNotation,
} from '../src/lib/solveNotation';

const NOTATION: SolveNotation = {
  board: 'Ks7h2h',
  oop: '22+,A2s+',
  ip: 'TT-22,AJs-A2s',
  potBb: 20,
  stackBb: 80,
  sizings: 'simple',
  compressed: false,
  rake: { mode: 'none' },
};

describe('P5 1.2 표기 저장·복원', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('P5 1.2 저장 → 복원 왕복이 같은 값이다', () => {
    saveNotation('abc', NOTATION);
    expect(loadNotation('abc')).toEqual(NOTATION);
    clearNotation('abc');
    expect(loadNotation('abc')).toBeNull();
  });

  it('P5 1.2 해시마다 따로 저장된다', () => {
    saveNotation('abc', NOTATION);
    saveNotation('def', { ...NOTATION, board: 'Kd7s2s' });
    expect(loadNotation('abc')?.board).toBe('Ks7h2h');
    expect(loadNotation('def')?.board).toBe('Kd7s2s');
  });

  it('P5 1.2 손상된 JSON·모양이 다른 값은 null 이다 (정규 모드로 연다)', () => {
    window.localStorage.setItem('ggto.solve.notation.bad', '{not json');
    expect(loadNotation('bad')).toBeNull();
    window.localStorage.setItem('ggto.solve.notation.partial', JSON.stringify({ board: 'Ks7h2h' }));
    expect(loadNotation('partial')).toBeNull();
    window.localStorage.setItem(
      'ggto.solve.notation.preset',
      JSON.stringify({ ...NOTATION, sizings: 'made-up' }),
    );
    expect(loadNotation('preset')).toBeNull();
  });
});

describe('P5 1.2 쿼리 조립', () => {
  it('P5 1.2 (D13) 레인지의 `+` 는 %2B 로 인코딩된다 — 공백이 되면 안 된다', () => {
    const q = notationQuery(NOTATION);
    expect(q).toContain('oop=22%2B%2CA2s%2B');
    expect(q).not.toContain('+');
    // 서버가 다시 읽었을 때 원본과 같아야 한다.
    const value = /(?:^|&)oop=([^&]*)/.exec(q)?.[1] as string;
    expect(decodeURIComponent(value)).toBe('22+,A2s+');
  });

  it('P5 1.1 다섯 파라미터를 전부 보낸다 (부분집합은 서버가 400 이다)', () => {
    const q = notationQuery(NOTATION);
    for (const key of ['board=', 'oop=', 'ip=', 'potBb=', 'stackBb=', 'sizings=']) {
      expect(q, key).toContain(key);
    }
  });

  it('P5 12 R2-2 compressed 는 `1` 로 보내고, 거짓이면 아예 보내지 않는다', () => {
    expect(notationQuery({ ...NOTATION, compressed: true })).toContain('compressed=1');
    expect(notationQuery(NOTATION)).not.toContain('compressed');
  });

  it('P5 1.1 레이크는 있을 때만 붙는다', () => {
    expect(notationQuery(NOTATION)).not.toContain('rakePct');
    const withRake = notationQuery({ ...NOTATION, rake: { mode: 'pot', pct: 5, capBb: 3 } });
    expect(withRake).toContain('rakePct=5');
    expect(withRake).toContain('rakeCapBb=3');
  });

  it('P5 1.1 표기가 없으면 쿼리도 없다 (= 정규 모드)', () => {
    expect(notationQuery(null)).toBe('');
  });
});
