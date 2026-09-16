/**
 * n-max 푸시/폴드 해답 → ggto-json 문서 (P7.md 6절). 형식은 v1 그대로이고 임포터는 안 바뀐다.
 *
 * **시각·경로·호스트명은 어디에도 넣지 않는다** — `content_hash` 가 문서 전체의 해시라
 * 하나라도 들어가면 `npm run seed` 를 두 번 돌릴 때 같은 차트가 두 번 들어간다.
 */

import { CLASS_KEYS, type GgtoJson, type GgtoJsonNode } from '@ggto/preflop';
import type { AntePreset, GameSpec } from './payoff.js';
import { STACK_CONVENTION, terminalPayoffs } from './payoff.js';
import { CAP_CALLERS, type PushFoldTree } from './tree.js';
import { ALGORITHM_NOTE, solveNmax, type NmaxResult, type SolveOptions } from './solveNmax.js';
import { buildTree } from './tree.js';
import { gameSpec } from './payoff.js';
import type { NmaxTables } from './tables.js';
import { DEFAULT_TRUNCATION_SAMPLES, truncationGain, type TruncationResult } from './truncation.js';

export const MODEL_ID = 'pf-nmax-v1';
export const GENERATOR_NAME = 'ggto chart-gen push-fold nmax';
/** 5.5 / D31: 이 값을 넘는 차트는 출하하지 않는다 */
export const TRUNCATION_GATE_BB = 0.02;

/** 파일에 적는 소수 자릿수. f32 저장 정밀도(약 7자리)와 같은 급 */
const DECIMALS = 6;

function round(x: number): number {
  const f = 10 ** DECIMALS;
  return Math.round(x * f) / f;
}

/** epsilon 처럼 1e-8 급인 값은 6자리 반올림하면 0 이 된다 — 유효숫자로 적는다. */
function sig(x: number, digits: number): number {
  return x === 0 ? 0 : Number(x.toExponential(digits - 1));
}

const ANTE_LABEL: Record<AntePreset, string> = {
  none: 'no ante',
  bba1: 'BB ante 1bb',
  'pp0.125': 'ante 0.125bb each',
};

export const MODEL_NOTE =
  'n-max push/fold: no jam yet -> {F,A}; facing jam -> {F,C}; at most 2 callers per jam (4-way+ lines removed); ' +
  'each player acts once; folders fold prob = 1 - non-fold prob conditioned on hero (+ first active opponent) hand; ' +
  'no card bunching from folded ranges; equal in-hand stacks; chip EV, no ICM, no rake';

/** P7.md 10절 — P8 이 UI 에 그대로 띄우는 문장이다. 코드에서 바꾸지 않는다. */
export const LIMITATIONS: readonly string[] = [
  'chip EV only: ICM not modeled — bubble and final-table decisions differ',
  'push/fold only: no limp, no min-raise',
  'at most 2 callers per jam',
  'no card bunching from folded ranges',
  'equal in-hand stacks',
];

export function chartName(n: number, antePreset: AntePreset, stack: number): string {
  const size = n === 2 ? '2-max (HU)' : `${String(n)}-max`;
  return `${size} push/fold ${String(stack)}bb, ${ANTE_LABEL[antePreset]} (generated)`;
}

export function chartFileNameNmax(n: number, antePreset: AntePreset, stack: number): string {
  return `pf-${String(n)}max-${antePreset}-${String(stack)}bb.json`;
}

/** 차트 식별자 (절단 측정의 시드에 들어간다 — 시각이 아니라 설정에서만 나온다) */
export function chartId(n: number, antePreset: AntePreset, stack: number): string {
  return `pf-${String(n)}max-${antePreset}-${String(stack)}bb`;
}

function byPosition(spec: GameSpec, values: readonly number[], digits: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [i, pos] of spec.positions.entries()) out[pos] = sig(values[i] as number, digits);
  return out;
}

function nodeDoc(seq: string, actions: readonly [string, string], freq: Float64Array, ev: Float64Array): GgtoJsonNode {
  const strategy: Record<string, number[]> = {};
  const evRows: Record<string, number[]> = {};
  for (let h = 0; h < CLASS_KEYS.length; h++) {
    const key = CLASS_KEYS[h] as string;
    const p = round(freq[h] as number);
    strategy[key] = [round(1 - p), p];
    // 폴드 EV 는 기준점의 정의상 정확히 0 이다 (P2 3.3). 계산하지 않고 0 을 쓴다.
    evRows[key] = [0, round(ev[h] as number)];
  }
  return { seq, actions: [...actions], strategy, ev: evRows };
}

export interface NmaxChartInput {
  n: number;
  antePreset: AntePreset;
  stack: number;
  tables: NmaxTables;
  generatorVersion: string;
  solve?: SolveOptions;
  truncationSamples?: number;
}

export interface NmaxChartResult {
  doc: GgtoJson;
  solve: NmaxResult;
  truncation: TruncationResult;
  tree: PushFoldTree;
  spec: GameSpec;
  fileName: string;
}

export function nmaxChart(input: NmaxChartInput): NmaxChartResult {
  const { n, antePreset, stack, tables } = input;
  const tree = buildTree(n, CAP_CALLERS);
  const spec = gameSpec(n, antePreset, stack);
  const payoffs = terminalPayoffs(tree, spec);
  const id = chartId(n, antePreset, stack);
  const solve = solveNmax(tree, spec, tables, payoffs, { label: id, ...input.solve });
  const strategies = solve.nodes.map((x) => x.strategy);
  const truncationSamples = input.truncationSamples ?? DEFAULT_TRUNCATION_SAMPLES;
  const truncation = truncationGain(tree, spec, tables, strategies, id, truncationSamples);

  const order = tree.nodes.map((node, k) => ({ node, k })).sort((a, b) => (a.node.seq < b.node.seq ? -1 : a.node.seq > b.node.seq ? 1 : 0));

  const doc: GgtoJson = {
    format: 'ggto-json',
    version: 1,
    name: chartName(n, antePreset, stack),
    gameType: 'mtt',
    config: spec.config,
    rake: { mode: 'none' },
    resolution: '169',
    evBasis: 'stack_delta_from_node',
    source: {
      kind: 'generated',
      name: GENERATOR_NAME,
      version: input.generatorVersion,
      license: 'self',
      params: {
        modelId: MODEL_ID,
        tableSize: n,
        antePreset,
        stack,
        capCallers: CAP_CALLERS,
        model: MODEL_NOTE,
        stackConvention: STACK_CONVENTION,
        algorithm: ALGORITHM_NOTE,
        iterations: solve.iterations,
        equityTable: tables.equityRef,
        equitySamples: null,
        // 2-max 는 3-way 쇼다운이 없어 표가 계산에 **들어가지 않는다**. 표가 실렸는지에
        // 따라 해시가 흔들리지 않도록 null 을 적는다 (P7.md 6절의 필드는 유지).
        equityTable3: n >= 3 ? tables.equity3Ref : null,
        equity3Samples: n >= 3 ? tables.equity3Samples : null,
        epsilonBb: sig(solve.epsilonBb, 4),
        mixedLossBb: sig(solve.mixedLossBb, 4),
        nashConvBb: sig(solve.nashConvBb, 4),
        exploitabilityBb: sig(solve.exploitabilityBb, 4),
        gainsBb: byPosition(spec, solve.gainsBb, 4),
        gameValueBb: byPosition(spec, solve.gameValueBb, 6),
        sumGameValueBb: sig(solve.sumGameValueBb, 4),
        massDefect: sig(solve.massDefect, 4),
        truncationGainBb: sig(truncation.totalBb, 4),
        truncationByPlayerBb: byPosition(spec, truncation.byPlayerBb, 4),
        truncationSamples,
        limitations: [...LIMITATIONS],
      },
    },
    nodes: order.map(({ node, k }) =>
      nodeDoc(node.seq, node.actions, solve.nodes[k]?.strategy as Float64Array, solve.nodes[k]?.ev as Float64Array),
    ),
  };

  return { doc, solve, truncation, tree, spec, fileName: chartFileNameNmax(n, antePreset, stack) };
}
