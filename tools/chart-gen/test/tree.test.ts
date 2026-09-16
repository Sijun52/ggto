/**
 * 트리 열거 게이트 (P7.md 1.1 · 5.1 (d)).
 *
 * 표는 **스펙에 박힌 숫자를 그대로 적는다** — `expectedTreeCounts()` 를 불러서 비교하면
 * 같은 식을 두 번 쓰는 동어반복이 된다. 아래 리터럴이 계약이고, 트리와 공식이 **둘 다**
 * 그 리터럴과 맞아야 한다.
 */

import { describe, expect, it } from 'vitest';
import { childSeq, tablePositions } from '@ggto/preflop';
import { CAP_CALLERS, buildTree, expectedTreeCounts, matrixNodes } from '../src/tree.js';

interface Row {
  n: number;
  decisions: number;
  twoWay: number;
  threeWay: number;
  jamAllFold: number;
  truncated: number;
  removedFourWayPlus: number;
}

/** P7.md 1.1 의 표 (직접 열거) */
const TABLE: readonly Row[] = [
  { n: 2, decisions: 2, twoWay: 1, threeWay: 0, jamAllFold: 1, truncated: 0, removedFourWayPlus: 0 },
  { n: 3, decisions: 6, twoWay: 3, threeWay: 1, jamAllFold: 2, truncated: 0, removedFourWayPlus: 0 },
  { n: 4, decisions: 13, twoWay: 6, threeWay: 4, jamAllFold: 3, truncated: 1, removedFourWayPlus: 1 },
  { n: 5, decisions: 24, twoWay: 10, threeWay: 10, jamAllFold: 4, truncated: 5, removedFourWayPlus: 6 },
  { n: 6, decisions: 40, twoWay: 15, threeWay: 20, jamAllFold: 5, truncated: 15, removedFourWayPlus: 22 },
  { n: 7, decisions: 62, twoWay: 21, threeWay: 35, jamAllFold: 6, truncated: 35, removedFourWayPlus: 64 },
  { n: 8, decisions: 91, twoWay: 28, threeWay: 56, jamAllFold: 7, truncated: 70, removedFourWayPlus: 163 },
  { n: 9, decisions: 128, twoWay: 36, threeWay: 84, jamAllFold: 8, truncated: 126, removedFourWayPlus: 382 },
];

/** P7.md 1.1: 포지션별 결정 노드 수 (n=9) */
const DECISIONS_BY_PLAYER_9 = [1, 2, 4, 7, 11, 16, 22, 29, 36];

function binomial(a: number, b: number): number {
  if (b < 0 || b > a) return 0;
  let r = 1;
  for (let t = 0; t < b; t++) r = (r * (a - t)) / (t + 1);
  return Math.round(r);
}

describe('1.1 트리 열거 (5.1 (d))', () => {
  for (const row of TABLE) {
    it(`1.1 n=${String(row.n)} 의 노드·터미널 수가 표와 같다`, () => {
      const tree = buildTree(row.n, CAP_CALLERS);
      expect(tree.nodes.length).toBe(row.decisions);
      expect(tree.terminals.filter((z) => z.J.length === 2).length).toBe(row.twoWay);
      expect(tree.terminals.filter((z) => z.J.length === 3).length).toBe(row.threeWay);
      expect(tree.terminals.filter((z) => z.J.length === 1).length).toBe(row.jamAllFold);
      expect(tree.terminals.filter((z) => z.walk).length).toBe(1);
      expect(tree.truncated.length).toBe(row.truncated);

      // 제거된 4-way+ 터미널 수는 "상한이 없었다면 있었을 쇼다운 터미널" 의 수다:
      // |J| >= 4 인 부분집합 전부 = Σ_{k>=4} C(n,k).
      let removed = 0;
      for (let k = 4; k <= row.n; k++) removed += binomial(row.n, k);
      expect(removed).toBe(row.removedFourWayPlus);

      // 공식(`expectedTreeCounts`) 도 같은 리터럴과 맞아야 한다.
      const f = expectedTreeCounts(row.n);
      expect(f.decisions).toBe(row.decisions);
      expect(f.twoWay).toBe(row.twoWay);
      expect(f.threeWay).toBe(row.threeWay);
      expect(f.jamAllFold).toBe(row.jamAllFold);
      expect(f.truncated).toBe(row.truncated);
      expect(f.removedFourWayPlus).toBe(row.removedFourWayPlus);
    });
  }

  it('1.1 n=9 의 포지션별 결정 노드 수 = [1,2,4,7,11,16,22,29,36]', () => {
    const tree = buildTree(9, CAP_CALLERS);
    expect(tree.nodesByPlayer.map((x) => x.length)).toEqual(DECISIONS_BY_PLAYER_9);
    expect(expectedTreeCounts(9).decisionsByPlayer).toEqual(DECISIONS_BY_PLAYER_9);
  });

  it('1.1 각 플레이어는 어떤 경로에서도 한 번만 행동한다', () => {
    for (let n = 2; n <= 9; n++) {
      const tree = buildTree(n, CAP_CALLERS);
      for (const z of tree.terminals) {
        const actors = [...z.J, ...z.F];
        expect(new Set(actors).size).toBe(actors.length);
        // 전원 폴드 터미널만 BB 가 빠진다 (BB 는 행동하지 않고 걷는다).
        expect(actors.length).toBe(z.walk ? n - 1 : n);
      }
    }
  });

  it('1.1 절단 노드는 잼 + 콜 2 뒤에만 있고 n <= 3 에는 없다', () => {
    for (let n = 2; n <= 9; n++) {
      const tree = buildTree(n, CAP_CALLERS);
      for (const t of tree.truncated) expect(t.J.length).toBe(1 + CAP_CALLERS);
      if (n <= 3) expect(tree.truncated.length).toBe(0);
    }
  });

  it('1.1 F-A-C-C 라인(9-max)은 노드가 없다 — 콜러 상한', () => {
    const tree = buildTree(9, CAP_CALLERS);
    // 'F-A-C-C' 다음 액터(플레이어 4)는 강제 폴드다: 그 seq 로 시작하는 결정 노드가 없다.
    expect(tree.bySeq.has('F-A-C-C')).toBe(false);
    const truncated = tree.truncated.find((t) => t.seq === 'F-A-C-C');
    expect(truncated).toBeDefined();
    expect(truncated?.actor).toBe(4);
    // 반면 'F-A-C' 는 결정 노드다 (콜러 1명).
    expect(tree.bySeq.has('F-A-C')).toBe(true);
  });

  /**
   * P7.md 0절 1번은 이 라인을 `F-F-F-F-F-F-A` (F 6개) 라고 적었지만, 9-max 의 SB 는
   * 인덱스 7 이라 **폴드가 7개** 있어야 SB 가 행동한다. F 6개 뒤의 잼은 BTN 잼이고 그
   * 다음 노드는 SB 다. 아래는 두 라인을 다 고정한다 (스펙 문장의 오탈자를 리뷰에 올린다).
   */
  it('1.1 9-max 의 F^7-A 는 SB 잼을 마주한 BB 노드다', () => {
    const tree = buildTree(9, CAP_CALLERS);
    let six = '';
    for (let i = 0; i < 6; i++) six = childSeq(six, 'F');
    const btnJam = tree.bySeq.get(childSeq(six, 'A'));
    expect(tablePositions(9)[tree.nodes[btnJam as number]?.actor as number]).toBe('SB');
    let seq = six;
    for (let i = 6; i < 7; i++) seq = childSeq(seq, 'F');
    const sb = tree.bySeq.get(seq);
    expect(sb).toBeDefined();
    expect(tablePositions(9)[tree.nodes[sb as number]?.actor as number]).toBe('SB');
    const bb = tree.bySeq.get(childSeq(seq, 'A'));
    expect(bb).toBeDefined();
    const node = tree.nodes[bb as number];
    expect(tablePositions(9)[node?.actor as number]).toBe('BB');
    expect(node?.actions).toEqual(['F', 'C']);
  });

  it('1.1 액션 배열은 항상 [F, 비폴드] 이고 잼 뒤에는 C 만 합법이다', () => {
    for (let n = 2; n <= 9; n++) {
      for (const node of buildTree(n, CAP_CALLERS).nodes) {
        expect(node.actions[0]).toBe('F');
        expect(node.actions[1]).toBe(node.priorActive.length === 0 ? 'A' : 'C');
        expect(node.kind).toBe(node.priorActive.length === 0 ? 'open' : 'facing');
      }
    }
  });

  it('2.1 n=2 는 (h,y) 행렬 노드가 없다 — 3-way 표를 쓰지 않는 이유', () => {
    expect(matrixNodes(buildTree(2, CAP_CALLERS)).size).toBe(0);
    expect(matrixNodes(buildTree(3, CAP_CALLERS)).size).toBeGreaterThan(0);
  });

  it('1.1 n 이 2..9 밖이면 RangeError', () => {
    expect(() => buildTree(1)).toThrow(RangeError);
    expect(() => buildTree(10)).toThrow(RangeError);
    expect(() => buildTree(3.5)).toThrow(RangeError);
  });
});
