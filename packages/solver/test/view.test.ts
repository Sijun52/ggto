/**
 * P4.md 8.1 — 1326 → 169 집계 (5.4) 와 역순열 응답 조립.
 *
 * 집계 기댓값은 구현 복사가 아니라 **손계산**이다: `freq(h,a) = Σ reach·strategy / Σ reach`.
 * 콤보 하나에 가중치를 몰아 두면 그 클래스의 값은 그 콤보의 값과 같아야 한다.
 */

import {
  COMBO_COUNT,
  comboIndex,
  handClassCombos,
  handClassOf,
  invertPerm,
  parseCard,
  type SuitPerm,
} from '@ggto/core';
import { permuteLine } from '../src/line.js';
import { describe, expect, it } from 'vitest';
import { aggregateNode } from '../src/aggregate.js';
import { boardWithDealt, decodeRows, toNodeResponse, toRunoutsResponse } from '../src/view.js';
import type { CanonicalNode, CanonicalRunouts } from '../src/types.js';

const AsKs = comboIndex(parseCard('As'), parseCard('Ks'));
const AhKh = comboIndex(parseCard('Ah'), parseCard('Kh'));
const AKs_CLASS = handClassOf(AsKs);

function zeros(): Float32Array {
  return new Float32Array(COMBO_COUNT);
}

describe('P4 5.4 169 집계 (P2 3.5 규칙)', () => {
  it('P4 5.4 도달 가중 평균이다 — 단순 평균이 아니다', () => {
    const reachOop = zeros();
    // 같은 클래스(AKs)의 두 콤보에 3:1 가중. 전략은 1.0 과 0.0.
    reachOop[AsKs] = 0.75;
    reachOop[AhKh] = 0.25;
    const strategy = [zeros(), zeros()];
    (strategy[0] as Float32Array)[AsKs] = 1;
    (strategy[0] as Float32Array)[AhKh] = 0;
    (strategy[1] as Float32Array)[AsKs] = 0;
    (strategy[1] as Float32Array)[AhKh] = 1;
    const ev = [zeros(), zeros()];
    (ev[0] as Float32Array)[AsKs] = 4;
    (ev[0] as Float32Array)[AhKh] = 0;

    const agg = aggregateNode({ strategy, ev, reach: [reachOop, zeros()], player: 'oop' });
    // 손계산: (0.75*1 + 0.25*0) / (0.75+0.25) = 0.75. 단순 평균이면 0.5 다.
    expect(agg.strategy[0]?.[AKs_CLASS]).toBeCloseTo(0.75, 6);
    expect(agg.strategy[1]?.[AKs_CLASS]).toBeCloseTo(0.25, 6);
    expect(agg.ev[0]?.[AKs_CLASS]).toBeCloseTo(3, 6);
    expect(agg.reach[0]?.[AKs_CLASS]).toBeCloseTo(1.0, 6);
  });

  it('P4 5.4 도달 0 인 클래스는 0 이다 (inRange=false 로 그려진다)', () => {
    const agg = aggregateNode({ strategy: [zeros()], ev: [zeros()], reach: [zeros(), zeros()], player: 'oop' });
    expect(agg.strategy[0]?.every((x) => x === 0)).toBe(true);
    expect(agg.reach[0]?.every((x) => x === 0)).toBe(true);
    expect(agg.strategy[0]?.length).toBe(169);
  });

  it('P4 5.4 한 클래스 안에서 전략이 갈려도 합은 1 이다 (D4 블로커 보존 확인)', () => {
    const reach = zeros();
    for (const c of handClassCombos(AKs_CLASS)) reach[c] = 1;
    const strategy = [zeros(), zeros()];
    handClassCombos(AKs_CLASS).forEach((c, i) => {
      (strategy[0] as Float32Array)[c] = i % 2 === 0 ? 1 : 0;
      (strategy[1] as Float32Array)[c] = i % 2 === 0 ? 0 : 1;
    });
    const agg = aggregateNode({ strategy, ev: [zeros(), zeros()], reach: [reach, zeros()], player: 'oop' });
    const sum = (agg.strategy[0]?.[AKs_CLASS] ?? 0) + (agg.strategy[1]?.[AKs_CLASS] ?? 0);
    expect(sum).toBeCloseTo(1, 6);
    // 4 콤보 중 2 개가 액션 0 → 0.5. 169 값 하나로는 블로커 차이를 못 본다 (그래서 D4 다).
    expect(agg.strategy[0]?.[AKs_CLASS]).toBeCloseTo(0.5, 6);
  });
});

describe('P4 5.4 역순열 응답', () => {
  /** s <-> h 스왑. 원본 → 정규가 이 순열이라고 두고 응답의 역순열을 검사한다. */
  const PERM: SuitPerm = [0, 1, 3, 2];

  function node(): CanonicalNode {
    const strategy = [zeros(), zeros()];
    const ev = [zeros(), zeros()];
    const reach = zeros();
    // 정규 공간에서 AhKh 자리에 값이 있다 → 역순열하면 AsKs 자리로 가야 한다.
    reach[AhKh] = 1;
    (strategy[0] as Float32Array)[AhKh] = 0.25;
    (strategy[1] as Float32Array)[AhKh] = 0.75;
    (ev[0] as Float32Array)[AhKh] = 2.5;
    return {
      street: 'flop',
      line: 'B1-C/Qh',
      board: '2h7hKh',
      player: 'oop',
      potChips: 2000,
      stacksChips: [8000, 8000],
      actions: ['X', 'B1'],
      strategy,
      ev,
      reach: [reach, zeros()],
      equity: [zeros(), zeros()],
      evAvgBb: [12, 8],
      evBasis: 'stack_delta_from_node',
    };
  }

  it('P4 5.4 1326 배열·board·line 이 모두 원본 슈트로 돌아온다', () => {
    const r = toNodeResponse(node(), PERM);
    expect(r.board).toBe('2s7sKs');
    expect(r.line).toBe('B1-C/Qs');
    const strategy = decodeRows(r.strategy, 2);
    expect(strategy[0]?.[AsKs]).toBeCloseTo(0.25, 6);
    expect(strategy[1]?.[AsKs]).toBeCloseTo(0.75, 6);
    expect(strategy[0]?.[AhKh]).toBe(0);
    const reach = decodeRows(r.reach[0], 1)[0] as Float32Array;
    expect(reach[AsKs]).toBe(1);
    expect(r.evBasis).toBe('stack_delta_from_node');
  });

  it('P4 5.4 집계는 169 이고 클래스는 슈트 순열에 불변이다', () => {
    const r = toNodeResponse(node(), PERM);
    expect(r.aggregate.strategy[0]?.length).toBe(169);
    // AhKh 와 AsKs 는 둘 다 AKs 클래스다 — 역순열 전후로 같은 칸에 있어야 한다.
    expect(r.aggregate.strategy[0]?.[AKs_CLASS]).toBeCloseTo(0.25, 6);
    expect(r.aggregate.reach[0]?.[AKs_CLASS]).toBeCloseTo(1, 6);
  });

  it('P4 5.5 runouts 의 카드 이름도 역순열된다 (블로커 슈트가 뒤집힌다)', () => {
    const runouts: CanonicalRunouts = {
      line: 'X-X',
      board: '2h7hKh',
      cards: [
        { card: 'Ah', evOop: 1, evIp: 2, equityOop: 0.4, strategyRoot: [1] },
        { card: 'As', evOop: 1, evIp: 2, equityOop: 0.4, strategyRoot: [1] },
        { card: 'Ad', evOop: 1, evIp: 2, equityOop: 0.4, strategyRoot: [1] },
      ],
    };
    const r = toRunoutsResponse(runouts, PERM);
    expect(r.cards.map((c) => c.card)).toEqual(['As', 'Ah', 'Ad']);
    expect(r.board).toBe('2s7sKs');
    // 값은 그대로 따라간다 (카드 이름만 바뀐다).
    expect(r.cards[0]?.evOop).toBe(1);
  });

  it('P4 5.4 순열 → 역순열 왕복은 항등이다', () => {
    const inv = invertPerm(PERM);
    expect(invertPerm(inv)).toEqual(PERM);
    const r = toNodeResponse(node(), [0, 1, 2, 3]);
    expect(r.board).toBe('2h7hKh');
    expect(r.line).toBe('B1-C/Qh');
  });
});

describe('P4 5.3 base64 f32', () => {
  it('P4 5.3 decodeRows 는 길이가 안 맞으면 던진다 (조용히 자르지 않는다)', () => {
    const buf = Buffer.alloc(4 * COMBO_COUNT).toString('base64');
    expect(() => decodeRows(buf, 1)).not.toThrow();
    expect(() => decodeRows(buf, 2)).toThrow(/expected/);
  });
});

/**
 * P4 R1 MAJOR 6 — 역순열의 **방향**.
 *
 * involution(`[0,1,3,2]`, s↔h) 로만 검사하면 `perm` 과 `inverse` 가 같은 순열이라
 * `const inv = perm` 뮤턴트가 살아남는다 (R1 에서 실제로 65/65 통과했다). 3-cycle 로
 * 두 방향을 **구분**한다.
 */
describe('P4 5.4 역순열 방향 (비-involution 3-cycle)', () => {
  // c→d→h→c, s 고정. 원본 → 정규가 이것이면 응답은 그 역 (c←d←h←c) 으로 돌아와야 한다.
  const PERM3: SuitPerm = [1, 2, 0, 3];
  const INV3 = invertPerm(PERM3);

  it('P4 5.4 PERM3 는 involution 이 아니다 (이 테스트의 전제)', () => {
    expect(INV3).not.toEqual(PERM3);
    // 3-cycle 이므로 p² ≠ id 이고 p² = p⁻¹ 다 (p³ = id).
    const p2 = [0, 1, 2, 3].map((s) => PERM3[PERM3[s] as number] as number);
    expect(p2).not.toEqual([0, 1, 2, 3]);
    expect(p2).toEqual([...INV3]);
  });

  const AcKd = comboIndex(parseCard('Ac'), parseCard('Kd'));
  /** inv 를 적용한 자리 (정답): Ac→Ah, Kd→Kc */
  const AhKc = comboIndex(parseCard('Ah'), parseCard('Kc'));
  /** perm 을 적용한 자리 (뮤턴트가 가는 곳): Ac→Ad, Kd→Kh */
  const AdKh = comboIndex(parseCard('Ad'), parseCard('Kh'));

  function node3(): CanonicalNode {
    const strategy = [zeros(), zeros()];
    const ev = [zeros(), zeros()];
    const reach = zeros();
    const equity = zeros();
    reach[AcKd] = 1;
    equity[AcKd] = 0.61;
    (strategy[0] as Float32Array)[AcKd] = 0.3;
    (strategy[1] as Float32Array)[AcKd] = 0.7;
    (ev[0] as Float32Array)[AcKd] = 5.5;
    return {
      street: 'turn',
      line: 'B1-C/Qc',
      board: '2c7cKdQc'.slice(0, 6),
      player: 'oop',
      potChips: 2000,
      stacksChips: [8000, 8000],
      actions: ['X', 'B1'],
      strategy,
      ev,
      reach: [reach, zeros()],
      equity: [equity, zeros()],
      evAvgBb: [12, 8],
      evBasis: 'stack_delta_from_node',
    };
  }

  it('P4 5.4 정규 AcKd 의 값은 원본 AhKc 로 간다 (AdKh 가 아니다)', () => {
    const r = toNodeResponse(node3(), PERM3);
    const strategy = decodeRows(r.strategy, 2);
    expect(strategy[0]?.[AhKc]).toBeCloseTo(0.3, 6);
    expect(strategy[1]?.[AhKc]).toBeCloseTo(0.7, 6);
    // 순열을 뒤집어 적용하면 여기로 간다 — 0 이어야 한다.
    expect(strategy[0]?.[AdKh]).toBe(0);
    expect(strategy[0]?.[AcKd]).toBe(0);

    const ev = decodeRows(r.ev, 2);
    expect(ev[0]?.[AhKc]).toBeCloseTo(5.5, 5);
    expect(ev[0]?.[AdKh]).toBe(0);

    const reach = decodeRows(r.reach[0], 1)[0] as Float32Array;
    expect(reach[AhKc]).toBe(1);
    expect(reach[AdKh]).toBe(0);

    const equity = decodeRows(r.equity[0], 1)[0] as Float32Array;
    expect(equity[AhKc]).toBeCloseTo(0.61, 6);
    expect(equity[AdKh]).toBe(0);
  });

  it('P4 5.4 board·line 의 카드도 inv 방향으로 돌아온다', () => {
    const r = toNodeResponse(node3(), PERM3);
    // 정규 2c7cKd → inv(c→h, d→c, h→d) → 2h7hKc. perm 방향이면 2d7dKh 다.
    expect(r.board).toBe('2h7hKc');
    expect(r.line).toBe('B1-C/Qh');
    expect(r.perm).toEqual([1, 2, 0, 3]);
  });

  it('P4 5.5 runouts 카드도 inv 방향이다', () => {
    const runouts: CanonicalRunouts = {
      line: 'B1-C',
      board: '2c7cKd',
      cards: [{ card: 'Ac', evOop: 1, evIp: 2, equityOop: 0.4, strategyRoot: [1] }],
    };
    const r = toRunoutsResponse(runouts, PERM3);
    expect(r.cards[0]?.card).toBe('Ah');
    expect(r.board).toBe('2h7hKc');
    expect(r.perm).toEqual([1, 2, 0, 3]);
  });

  it('P4 5.4 요청(순)·응답(역) 왕복이 항등이다 — 3-cycle 에서도', () => {
    const r = toNodeResponse(node3(), PERM3);
    // 사용자 라인 → 정규 라인 → 응답 라인
    const userLine = r.line;
    expect(permuteLine(userLine, PERM3)).toBe('B1-C/Qc');
  });
});

/** P4 R1 MAJOR 1 — 응답 board 는 시작 보드 + 라인에서 딜된 카드다. */
describe('P4 5.4 boardWithDealt', () => {
  it('P4 5.4 사용자 표기 순서를 지키고 딜된 카드를 뒤에 붙인다', () => {
    // 정규 응답은 정렬 순서라 사용자 순서(Ks7h2h)와 다르다. 딜된 Qc 만 뒤에 남아야 한다.
    expect(boardWithDealt('Ks7h2h', '2h7hKsQc')).toBe('Ks7h2hQc');
    expect(boardWithDealt('Ks7h2hQc', '2h7hKsQc9d')).toBe('Ks7h2hQc9d');
  });

  it('P4 5.4 딜된 카드가 없으면 사용자 표기 그대로다', () => {
    expect(boardWithDealt('Ks7h2h', '2h7hKs')).toBe('Ks7h2h');
  });

  it('P4 5.4 응답에 요청 보드 카드가 없으면 던진다 (틀린 보드를 그리지 않는다)', () => {
    expect(() => boardWithDealt('Ks7h2h', '2d7dKd')).toThrow(/does not contain/);
  });
});
