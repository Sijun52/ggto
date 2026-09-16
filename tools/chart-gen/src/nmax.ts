/**
 * n-max 차트 한 장을 만드는 파사드 (P7.md 2.2 · 6절). CLI · 테스트 · 벤치가 이 함수만 쓴다.
 *
 * 입력 표 두 개(2-way 전수 · 3-way MC)를 받아 트리 → 지불 → CFR+ → 절단 이득 → ggto-json
 * 까지를 한 번에 돈다. 같은 입력은 바이트 동일한 문서를 낸다 (시각·경로·호스트명 없음).
 */

import { loadEquity3, type Equity3 } from './equity3.js';
import { loadEquityTable, type EquityTable } from './equityTable.js';
import { buildTables, type NmaxTables } from './tables.js';
import { gameSpec, terminalPayoffs, type AntePreset } from './payoff.js';
import { buildTree, CAP_CALLERS, type PushFoldTree } from './tree.js';
import { solveNmax, type NmaxResult, type SolveOptions } from './solveNmax.js';

export interface NmaxInputs {
  equity: EquityTable;
  equity3: Equity3 | null;
  tables: NmaxTables;
}

/**
 * 표를 읽는다. `equity3BinPath` 가 null 이면 **2-max 전용** 입력이다 (n≥3 솔브는
 * `resolveEquity3` 에서 throw 한다) — `npm run seed` 가 3-way 표를 읽지 않고 45개
 * 2-max 차트만 만들 수 있게 한다.
 */
export function loadInputs(equityPath: string, equity3BinPath: string | null, equity3MetaPath: string | null): NmaxInputs {
  const equity = loadEquityTable(equityPath);
  const equity3 =
    equity3BinPath === null || equity3MetaPath === null ? null : loadEquity3(equity3BinPath, equity3MetaPath);
  return { equity, equity3, tables: buildTables(equity, equity3) };
}

export interface SolvedGame {
  tree: PushFoldTree;
  spec: ReturnType<typeof gameSpec>;
  /** 터미널 지불 (테스트가 같은 게임을 BR 로 다시 채점할 때 쓴다) */
  payoffs: ReturnType<typeof terminalPayoffs>;
  solve: NmaxResult;
}

/** 트리 · 지불 · 솔브를 한 번에. 차트 문서는 `chartNmax.ts` 가 만든다. */
export function solveGame(
  n: number,
  antePreset: AntePreset,
  stack: number,
  tables: NmaxTables,
  opts: SolveOptions = {},
): SolvedGame {
  const tree = buildTree(n, CAP_CALLERS);
  const spec = gameSpec(n, antePreset, stack);
  const payoffs = terminalPayoffs(tree, spec);
  const solve = solveNmax(tree, spec, tables, payoffs, opts);
  return { tree, spec, payoffs, solve };
}

/** 1326 가중 비폴드 집계 % (P7.md 5.2 (c) · 5.4 의 단조성 게이트가 쓴다) */
export function aggregatePct(strategy: Float64Array, tables: NmaxTables): number {
  let sum = 0;
  let total = 0;
  for (let h = 0; h < strategy.length; h++) {
    const n = tables.comboCount[h] as number;
    sum += (strategy[h] as number) * n;
    total += n;
  }
  return (sum / total) * 100;
}
