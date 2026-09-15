/**
 * P5.md 1.3 — `line` 문법 (D3). 기댓값은 **스펙 1.3 의 표를 그대로** 박았다.
 *
 * 여기서 잡는 회귀는 둘이다: (1) `B6.6` 을 `.` 에서 쪼개는 것 (D3 의 원래 사고),
 * (2) 카드 세그먼트를 액션처럼 `-` 로 붙이는 것 (그러면 데몬이 `NoSuchLine` 이다).
 */

import { describe, expect, it } from 'vitest';
import {
  childLine,
  crumbs,
  isCardToken,
  isActionToken,
  parentLine,
  rootStreetOf,
  segments,
} from '../src/lib/solveLine';

describe('P5 1.3 childLine', () => {
  it('P5 1.3 스펙 표의 여섯 줄이 그대로 나온다', () => {
    expect(childLine('', 'X')).toBe('X');
    expect(childLine('X', 'X')).toBe('X-X');
    expect(childLine('X-X', 'Qc')).toBe('X-X/Qc');
    expect(childLine('X-X/Qc', 'X')).toBe('X-X/Qc/X');
    expect(childLine('X-X/Qc/X', 'B15')).toBe('X-X/Qc/X-B15');
    expect(childLine('', 'Qc')).toBe('Qc');
  });

  it('P5 1.3 (D3) B6.6 은 하나의 토큰이다 — `.` 은 구분자가 아니다', () => {
    expect(childLine('B6.6', 'C')).toBe('B6.6-C');
    expect(segments('B6.6-C')).toEqual([{ street: 'flop', actions: ['B6.6', 'C'] }]);
    expect(parentLine('B6.6-C')).toBe('B6.6');
  });
});

describe('P5 1.3 parentLine', () => {
  it('P5 1.3 토큰 하나 뒤로 — 카드 세그먼트도 토큰 하나다', () => {
    expect(parentLine('X-X/Qc/X-B15')).toBe('X-X/Qc/X');
    expect(parentLine('X-X/Qc/X')).toBe('X-X/Qc');
    expect(parentLine('X-X/Qc')).toBe('X-X');
    expect(parentLine('X-X')).toBe('X');
    expect(parentLine('X')).toBe('');
    expect(parentLine('')).toBe('');
  });

  it('P5 1.3 parentLine(childLine(l, t)) === l — 액션·카드 100 조합', () => {
    const actionTokens = ['X', 'C', 'F', 'A', 'B6.6', 'R15', 'B33', 'B2.5', 'B1', 'R2.5'];
    const cardTokens = ['Qc', '2h', 'Ts', 'Ad'];
    const lines = ['', 'X', 'X-X', 'B6.6-C', 'X-X/Qc', 'X-X/Qc/X', 'X-X/Qc/X-B15', 'B6.6-C/Qc/X-B15/2h'];
    let checked = 0;
    for (const l of lines) {
      for (const t of [...actionTokens, ...cardTokens]) {
        // 같은 카드가 라인에 두 번 나오는 조합은 문법상 만들 수 있다 (합법성은 데몬이 본다).
        expect(parentLine(childLine(l, t)), `${JSON.stringify(l)} + ${t}`).toBe(l);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(100);
  });
});

describe('P5 1.3 segments', () => {
  it('P5 1.3 스펙 예시가 그대로 분해된다 (스트리트 라벨 포함)', () => {
    expect(segments('B6.6-C/Qc/X-B15')).toEqual([
      { street: 'flop', actions: ['B6.6', 'C'] },
      { card: 'Qc' },
      { street: 'turn', actions: ['X', 'B15'] },
    ]);
  });

  it('P5 1.3 턴 솔브는 첫 세그먼트가 turn 이고 카드 뒤가 river 다', () => {
    expect(segments('X-X/9d/X', 'turn')).toEqual([
      { street: 'turn', actions: ['X', 'X'] },
      { card: '9d' },
      { street: 'river', actions: ['X'] },
    ]);
  });

  it('P5 1.3 rootStreetOf 는 카드 세그먼트 수만큼 거슬러 올라간다', () => {
    expect(rootStreetOf('turn', 'X-X/Qc')).toBe('flop');
    expect(rootStreetOf('river', 'X-X/Qc/X-X/9d')).toBe('flop');
    expect(rootStreetOf('river', 'X-X/9d')).toBe('turn');
    expect(rootStreetOf('flop', '')).toBe('flop');
  });
});

describe('P5 1.3 토큰 판별', () => {
  it('P5 1.3 카드는 두 글자, 액션 `A` 와 카드 `Ah` 는 길이로 갈린다', () => {
    expect(isCardToken('Ah')).toBe(true);
    expect(isCardToken('A')).toBe(false);
    expect(isCardToken('X')).toBe(false);
    expect(isCardToken('B6')).toBe(false);
    expect(isCardToken('Zz')).toBe(false);
  });

  it('P5 2 액션 토큰 판별은 core 의 토크나이저다 — 소문자·b33 은 거짓', () => {
    for (const good of ['X', 'C', 'F', 'A', 'B6.6', 'R15']) expect(isActionToken(good), good).toBe(true);
    for (const bad of ['x', 'c', 'b33', 'B', 'R', 'Q', '']) expect(isActionToken(bad), bad).toBe(false);
  });
});

describe('P5 3.2 crumbs', () => {
  it('P5 3.2 칩마다 접두 라인이 붙고 카드 칩 뒤의 스트리트가 올라간다', () => {
    expect(crumbs('X-X/Qc/X')).toEqual([
      { line: 'X', label: 'X', card: false, street: 'flop' },
      { line: 'X-X', label: 'X', card: false, street: 'flop' },
      { line: 'X-X/Qc', label: 'Qc', card: true, street: 'turn' },
      { line: 'X-X/Qc/X', label: 'X', card: false, street: 'turn' },
    ]);
  });
});
