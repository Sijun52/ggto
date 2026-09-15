/**
 * P5.md 1.5 / 8.1 — **브라우저 집계 == 서버 집계** 대조, 그리고 **순열 방향**.
 *
 * 픽스처는 `packages/solver/scripts/make-web-fixture.mjs` 가 실제 `toNodeResponse` 로
 * 만든 응답이고 순열은 **3-cycle** 이다. involution 이면 자기 자신이 역이라 "역순열 대신
 * 순순열을 썼다" 는 버그(P4 R1 MAJOR 6 의 `inv = perm`)가 통과한다.
 *
 * 두 가지를 본다:
 *  (a) 169 집계 규칙이 서버(`aggregateNode`)와 브라우저(`chartGrid`)에서 같은가.
 *  (b) 응답의 1326 배열이 **원본 슈트 공간**인가 — 정규 공간 값과 대조한다.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { comboIndex, parseCard } from '@ggto/core';
import type { SolveNodeResponse } from '@ggto/protocol';
import { decodeF32Rows } from '../src/lib/f32';
import { solveAggregate } from '../src/lib/solveGrid';
import type { SolveNodeView } from '../src/api/solve';

interface Fixture {
  perm: [number, number, number, number];
  canonical: { board: string; line: string; strategy: string; reach: [string, string] };
  response: SolveNodeResponse;
}

const FIXTURE = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'fixtures/solve-node.json'), 'utf8'),
) as Fixture;

function view(res: SolveNodeResponse): SolveNodeView {
  const rows = res.actions.length;
  return {
    street: res.street,
    line: res.line,
    board: res.board,
    player: res.player,
    potChips: res.potChips,
    stacksChips: res.stacksChips,
    actions: res.actions,
    strategy: decodeF32Rows(res.strategy, rows),
    ev: decodeF32Rows(res.ev, rows),
    reach: [decodeF32Rows(res.reach[0], 1)[0] as Float32Array, decodeF32Rows(res.reach[1], 1)[0] as Float32Array],
    equity: [
      decodeF32Rows(res.equity[0], 1)[0] as Float32Array,
      decodeF32Rows(res.equity[1], 1)[0] as Float32Array,
    ],
    evAvgBb: res.evAvgBb,
    reachable: res.reachable,
    aggregate: res.aggregate,
    perm: res.perm,
  };
}

const combo = (a: string, b: string): number => comboIndex(parseCard(a), parseCard(b));

describe('P5 1.5 브라우저 집계 == 서버 aggregate', () => {
  const node = view(FIXTURE.response);
  const mine = solveAggregate(node);
  const theirs = FIXTURE.response.aggregate;

  it('P5 1.5 액션별 169 전략이 1e-6 안에서 같다', () => {
    expect(mine.strategy.length).toBe(theirs.strategy.length);
    for (let a = 0; a < theirs.strategy.length; a++) {
      const row = theirs.strategy[a] as number[];
      expect(row.length).toBe(169);
      for (let h = 0; h < row.length; h++) {
        expect(Math.abs((mine.strategy[a]?.[h] as number) - (row[h] as number)), `a${String(a)} h${String(h)}`).toBeLessThan(
          1e-6,
        );
      }
    }
  });

  it('P5 1.5 액션별 169 EV 가 1e-6 안에서 같다', () => {
    for (let a = 0; a < theirs.ev.length; a++) {
      const row = theirs.ev[a] as number[];
      for (let h = 0; h < row.length; h++) {
        expect(Math.abs((mine.ev[a]?.[h] as number) - (row[h] as number))).toBeLessThan(1e-6);
      }
    }
  });

  it('P5 1.5 플레이어별 169 도달 질량이 1e-6 안에서 같다', () => {
    expect(mine.reach.length).toBe(2);
    for (let p = 0; p < 2; p++) {
      const row = theirs.reach[p] as number[];
      for (let h = 0; h < row.length; h++) {
        expect(Math.abs((mine.reach[p]?.[h] as number) - (row[h] as number))).toBeLessThan(1e-6);
      }
    }
    // 서버·브라우저가 **둘 다 0** 을 내는 사각지대가 아니라는 확인: 질량이 실제로 있다.
    expect((mine.reach[0] as number[]).reduce((x, y) => x + y, 0)).toBeGreaterThan(100);
  });
});

describe('P5 1.5 응답은 원본 슈트 공간이다 (순열 방향)', () => {
  it('P5 1.5 3-cycle perm 에서 원본 AcKd 의 값 = 정규 AdKh 의 값', () => {
    // perm = [1,2,0,3] 은 **원본 → 정규** 다 (c→d, d→h, h→c, s 고정).
    // 따라서 원본 `AcKd` 는 정규 `AdKh` 에 대응한다. 응답은 원본 공간이어야 하므로
    // 응답[AcKd] === 정규[AdKh] 다. `inv = perm` 뮤턴트면 정규 `AhKc` 가 온다.
    expect(FIXTURE.perm).toEqual([1, 2, 0, 3]);
    const rows = FIXTURE.response.actions.length;
    const responseStrategy = decodeF32Rows(FIXTURE.response.strategy, rows);
    const canonicalStrategy = decodeF32Rows(FIXTURE.canonical.strategy, rows);
    const original = combo('Ac', 'Kd');
    const canonical = combo('Ad', 'Kh');
    const wrongDirection = combo('Ah', 'Kc');
    for (let a = 0; a < rows; a++) {
      const got = (responseStrategy[a] as Float32Array)[original] as number;
      expect(got).toBe((canonicalStrategy[a] as Float32Array)[canonical]);
      // 방향이 뒤집혔다면 이 값이 나온다 — 우연히 같으면 테스트가 무력하므로 확인한다.
      expect(got).not.toBe((canonicalStrategy[a] as Float32Array)[wrongDirection]);
    }
  });

  it('P5 1.5 도달 레인지도 같은 방향으로 돌아간다', () => {
    const responseReach = decodeF32Rows(FIXTURE.response.reach[0], 1)[0] as Float32Array;
    const canonicalReach = decodeF32Rows(FIXTURE.canonical.reach[0], 1)[0] as Float32Array;
    expect(responseReach[combo('Ac', 'Kd')]).toBe(canonicalReach[combo('Ad', 'Kh')]);
    expect(responseReach[combo('2c', '2d')]).toBe(canonicalReach[combo('2d', '2h')]);
  });

  it('P5 1.5 보드와 line 의 카드도 원본 공간이다', () => {
    // 정규 `2c7cKdQc` 의 역순열(정규→원본) 은 c→h, d→c, h→d 이므로 `2h7hKcQh` 다.
    expect(FIXTURE.canonical.board).toBe('2c7cKdQc');
    expect(FIXTURE.response.board).toBe('2h7hKcQh');
    expect(FIXTURE.canonical.line).toBe('X-B6.6-C/Qc');
    expect(FIXTURE.response.line).toBe('X-B6.6-C/Qh');
  });
});
