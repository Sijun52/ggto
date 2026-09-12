/**
 * 푸시/폴드 해답 → ggto-json 문서. P2.md 7.1.
 *
 * 여기서 나오는 EV 는 3.3 기준점("노드 이후 히어로 스택 변화, Fold=0")이다. 임포터가
 * 그 성질(F 열이 정확히 0)을 다시 검사하므로 기준점이 어긋나면 임포트가 막힌다.
 */

import { CLASS_KEYS, type GgtoJson, type GgtoJsonNode } from '@ggto/preflop';
import { solvePushFold, type PushFoldResult } from './pushFold.js';
import type { EquityTable } from './equityTable.js';

/** 파일에 적는 소수 자릿수. f32 저장 정밀도(≈7자리)와 같은 급 */
const DECIMALS = 6;

function round(x: number): number {
  const f = 10 ** DECIMALS;
  return Math.round(x * f) / f;
}

/** exploitability 처럼 1e-8 급인 값은 6자리 반올림하면 0 이 된다 — 유효숫자로 적는다. */
function sig(x: number, digits: number): number {
  return x === 0 ? 0 : Number(x.toExponential(digits - 1));
}

export const PUSH_FOLD_STACKS = [5, 8, 10, 12, 15, 20] as const;
export const DEFAULT_ITERATIONS = 5000;
/** P2.md 7.1 게이트 */
export const EXPLOITABILITY_GATE_BB = 0.005;

export interface GenerateOptions {
  stack: number;
  iterations?: number;
  generatorVersion: string;
}

export class ExploitabilityGateError extends Error {
  constructor(stack: number, value: number) {
    super(
      `push/fold solve for ${String(stack)}bb has exploitability ${value.toExponential(3)} bb, ` +
        `above the gate ${String(EXPLOITABILITY_GATE_BB)} bb`,
    );
    this.name = 'ExploitabilityGateError';
  }
}

/** 액션 배열 순서는 파일 계약이다: 항상 [F, <공격>] (F 가 인덱스 0) */
function node(seq: string, actions: [string, string], freq: Float64Array, ev: Float64Array): GgtoJsonNode {
  const strategy: Record<string, number[]> = {};
  const evRows: Record<string, number[]> = {};
  for (let h = 0; h < CLASS_KEYS.length; h++) {
    const key = CLASS_KEYS[h] as string;
    const p = round(freq[h] as number);
    strategy[key] = [round(1 - p), p];
    // 폴드 EV 는 기준점의 정의상 정확히 0 이다 (3.3). 계산하지 않고 0 을 쓴다.
    evRows[key] = [0, round(ev[h] as number)];
  }
  return { seq, actions: [...actions], strategy, ev: evRows };
}

export function pushFoldChart(table: EquityTable, opts: GenerateOptions): { doc: GgtoJson; solve: PushFoldResult } {
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const solve = solvePushFold(table.equity, opts.stack, iterations);
  if (!(solve.exploitabilityBb < EXPLOITABILITY_GATE_BB)) {
    throw new ExploitabilityGateError(opts.stack, solve.exploitabilityBb);
  }
  const doc: GgtoJson = {
    format: 'ggto-json',
    version: 1,
    name: `HU push/fold ${String(opts.stack)}bb (generated)`,
    gameType: 'cash',
    config: {
      positions: ['SB', 'BB'],
      blinds: [
        { pos: 'SB', amount: 0.5 },
        { pos: 'BB', amount: 1 },
      ],
      ante: { mode: 'none' },
      stack: opts.stack,
    },
    rake: { mode: 'none' },
    resolution: '169',
    evBasis: 'stack_delta_from_node',
    source: {
      kind: 'generated',
      name: 'ggto chart-gen push-fold',
      version: opts.generatorVersion,
      license: 'self',
      params: {
        stack: opts.stack,
        model: 'heads-up push/fold (SB: A|F, BB: C|F). No limp, no min-raise.',
        algorithm: 'CFR+ (regret matching+, linear averaging, alternating updates)',
        iterations,
        equityTable: `equity169.json@sha256:${table.meta.sha256}`,
        equitySamples: table.meta.samples,
        exploitabilityBb: sig(solve.exploitabilityBb, 4),
        nashConvBb: sig(solve.nashConvBb, 4),
      },
    },
    nodes: [
      node('', ['F', 'A'], solve.sbJam, solve.sbJamEv),
      node('A', ['F', 'C'], solve.bbCall, solve.bbCallEv),
    ],
  };
  return { doc, solve };
}

export function chartFileName(stack: number): string {
  return `hu-pushfold-${String(stack)}bb.json`;
}
