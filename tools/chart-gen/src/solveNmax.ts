/**
 * n-max 푸시/폴드 CFR+ 솔버 (P7.md 4절).
 *
 * `pushFold.ts` 와 같은 변종이다: regret matching+, 선형 가중 평균, 교대 갱신.
 * 각 플레이어가 히스토리마다 **한 번만** 행동하므로 재귀가 없다 — 노드마다 그 아래
 * 터미널들을 직접 축약해 EV 를 얻는다.
 *
 * 희소 축약: RM+ 는 정확한 0 을 만든다. σ(y)=0 인 y 를 건너뛰는 것은 근사가 아니라
 * 0 항을 빼는 것이고, 9-max 조밀 반복(약 1.8 GFMA)을 예산 안으로 들여놓는 유일한 방법이다.
 *
 * 정지: `epsilonBb < 1e-5` 또는 4,000 반복. 게이트(`< 0.005`)를 못 넘으면 **생성 실패**다
 * (D34 — 조용히 낮은 품질을 출하하지 않는다).
 */

import { bestResponse } from './bestResponse.js';
import type { GameSpec, TerminalPayoff } from './payoff.js';
import { updateRegrets } from './pushFold.js';
import { N, N2, REMAINING_PAIRS, foldMatrix, foldVector, supportOf, type NmaxTables } from './tables.js';
import { matrixNodes, type FolderInfo, type PushFoldTree } from './tree.js';

/** P7.md 1.6 / D34: 어느 플레이어도 이만큼은 못 얻는다 (ε-균형). */
export const EPSILON_GATE_BB = 0.005;
/** 정지 목표. 게이트의 1/500 이다 (HU 실측 500 반복 ≈ 4e-6). */
export const EPSILON_TARGET_BB = 1e-5;
export const MAX_ITERATIONS = 4000;
export const CHECK_FROM = 100;
export const CHECK_EVERY = 50;

export const ALGORITHM_NOTE =
  'CFR+ (regret matching+, linear averaging, alternating updates); stop at epsilon < 1e-5 or 4000 iterations';

export class ExploitabilityGateError extends Error {
  readonly epsilonBb: number;
  readonly iterations: number;
  constructor(label: string, epsilonBb: number, iterations: number) {
    super(
      `${label}: epsilon ${epsilonBb.toExponential(3)} bb after ${String(iterations)} iterations is at or above the gate ${String(EPSILON_GATE_BB)} bb`,
    );
    this.name = 'ExploitabilityGateError';
    this.epsilonBb = epsilonBb;
    this.iterations = iterations;
  }
}

export interface NmaxNodeResult {
  /** 169 — 비폴드 평균 빈도 */
  strategy: Float64Array;
  /** 169 — 비폴드 EV (노드 기준, bb) */
  ev: Float64Array;
}

export interface NmaxResult {
  nodes: NmaxNodeResult[];
  /** max_i gain_i (게이트 대상) */
  epsilonBb: number;
  /** Σ_i gain_i (OpenSpiel nash_conv) */
  nashConvBb: number;
  /** nashConv / n (OpenSpiel: 2인 상수합에서 착취가능액 — 기존 HU 필드와 호환) */
  exploitabilityBb: number;
  gainsBb: number[];
  gameValueBb: number[];
  sumGameValueBb: number;
  massDefect: number;
  iterations: number;
}

export interface SolveOptions {
  maxIterations?: number;
  epsilonTarget?: number;
  /** 게이트를 넘지 못해도 던지지 않는다 (실험·진단용). 기본 false */
  allowGateFailure?: boolean;
  label?: string;
}

interface FolderSplit {
  vec: number[];
  mat: number[];
}

function splitFolders(folders: readonly FolderInfo[], hero: number): FolderSplit {
  const vec: number[] = [];
  const mat: number[] = [];
  for (const f of folders) {
    if (f.forced) continue;
    const priors = f.priorActive.filter((p) => p !== hero);
    if (priors.length === 0) vec.push(f.node);
    else mat.push(f.node);
  }
  return { vec, mat };
}

/** 터미널·노드 경로에서 플레이어 p 의 결정 노드 인덱스 */
function nodeOnPath(bySeq: Map<string, number>, seq: string, player: number): number {
  const tokens = seq === '' ? [] : seq.split('-');
  const prefix = tokens.slice(0, player).join('-');
  const index = bySeq.get(prefix);
  if (index === undefined) throw new Error(`no decision node for player ${String(player)} on path ${JSON.stringify(seq)}`);
  return index;
}

/** 노드 하나의 축약에 필요한 모든 것을 미리 풀어 둔다 (반복마다 다시 만들지 않는다). */
interface NodePlan {
  index: number;
  actor: number;
  /** 도달 확률용 */
  reachVec: number[];
  reachMat: number[];
  reachActive: number[];
  /** 비폴드 서브트리의 터미널들 */
  terms: {
    pot: number;
    base: number;
    vec: number[];
    mat: number[];
    /** 히어로를 뺀 활성 상대의 결정 노드 (0~2개) */
    others: number[];
  }[];
}

function buildPlans(tree: PushFoldTree, payoffs: readonly TerminalPayoff[]): NodePlan[] {
  const bySeq = new Map<string, number>();
  for (const [i, node] of tree.nodes.entries()) bySeq.set(node.seq, i);
  return tree.nodes.map((node, index) => {
    const split = splitFolders(node.priorFolders, node.actor);
    const terminalList = (tree.heroTerminals[node.actor] as Map<number, number[]>).get(index) ?? [];
    return {
      index,
      actor: node.actor,
      reachVec: split.vec,
      reachMat: split.mat,
      reachActive: node.priorActive.map((p) => nodeOnPath(bySeq, node.seq, p)),
      terms: terminalList.map((t) => {
        const z = tree.terminals[t];
        if (z === undefined) throw new Error(`terminal ${String(t)} is missing`);
        const pay = payoffs[t] as TerminalPayoff;
        const s = splitFolders(z.folders, node.actor);
        return {
          pot: pay.pot,
          base: pay.base[node.actor] as number,
          vec: s.vec,
          mat: s.mat,
          others: z.J.filter((p) => p !== node.actor).map((p) => z.activeNodes[z.J.indexOf(p)] as number),
        };
      }),
    };
  });
}

function product(nodes: readonly number[], table: readonly Float64Array[], index: number): number {
  let p = 1;
  for (const f of nodes) {
    p *= 1 - ((table[f] as Float64Array)[index] as number);
    if (p === 0) return 0;
  }
  return p;
}

export function solveNmax(
  tree: PushFoldTree,
  spec: GameSpec,
  tables: NmaxTables,
  payoffs: readonly TerminalPayoff[],
  opts: SolveOptions = {},
): NmaxResult {
  const maxIterations = opts.maxIterations ?? MAX_ITERATIONS;
  const epsilonTarget = opts.epsilonTarget ?? EPSILON_TARGET_BB;
  const label = opts.label ?? `${String(spec.n)}-max ${spec.antePreset} ${String(spec.stack)}bb`;
  const nodeCount = tree.nodes.length;
  const { w2, w3, share3, eq2, rowTotal2, classProb } = tables;
  const plans = buildPlans(tree, payoffs);

  const strat = Array.from({ length: nodeCount }, () => new Float64Array(N).fill(0.5));
  const regretPos = Array.from({ length: nodeCount }, () => new Float64Array(N));
  const regretNeg = Array.from({ length: nodeCount }, () => new Float64Array(N));
  const sum = Array.from({ length: nodeCount }, () => new Float64Array(N));
  const avg = Array.from({ length: nodeCount }, () => new Float64Array(N));
  const nfVec = Array.from({ length: nodeCount }, () => new Float64Array(N));
  const nfMat = Array.from({ length: nodeCount }, () => new Float64Array(N2));
  const support = Array.from({ length: nodeCount }, () => new Int32Array(N));
  const supportLen = new Int32Array(nodeCount);
  const dirty = new Uint8Array(nodeCount).fill(1);
  // (h,y) 행렬이 실제로 쓰이는 노드만 만든다. n=2 는 하나도 없다.
  const needsMatrix = matrixNodes(tree);
  const diff = new Float64Array(N);
  const reach = new Float64Array(N);
  const num = new Float64Array(N);
  const den = new Float64Array(N);
  let weightSum = 0;

  /** 더러운 노드의 폴더 조건부 확률을 다시 만든다. `skipActor` 의 노드는 지금 갱신될
   *  것이므로 건너뛴다 (히어로는 자기 서브트리에서 폴더가 아니다). */
  const refresh = (skipActor: number): void => {
    for (let k = 0; k < nodeCount; k++) {
      if (dirty[k] !== 1) continue;
      if ((tree.nodes[k] as { actor: number }).actor === skipActor) continue;
      const sigma = strat[k] as Float64Array;
      supportLen[k] = supportOf(sigma, support[k] as Int32Array);
      foldVector(tables, sigma, nfVec[k] as Float64Array);
      if (needsMatrix.has(k)) foldMatrix(tables, sigma, nfMat[k] as Float64Array, support[k] as Int32Array, supportLen[k] as number);
      dirty[k] = 0;
    }
  };

  /** 노드 x 의 도달 확률과 비폴드 EV 를 채운다 (희소 축약). */
  const evaluate = (plan: NodePlan): void => {
    reach.fill(0);
    num.fill(0);
    den.fill(0);

    // --- 도달 확률 R(x|h) ---
    if (plan.reachActive.length === 0) {
      for (let h = 0; h < N; h++) reach[h] = product(plan.reachVec, nfVec, h);
    } else {
      const o1 = strat[plan.reachActive[0] as number] as Float64Array;
      const sup1 = support[plan.reachActive[0] as number] as Int32Array;
      const len1 = supportLen[plan.reachActive[0] as number] as number;
      const o2 = plan.reachActive.length === 2 ? (nfMat[plan.reachActive[1] as number] as Float64Array) : null;
      for (let h = 0; h < N; h++) {
        const a = product(plan.reachVec, nfVec, h);
        if (a === 0) continue;
        const hBase = h * N;
        const total = rowTotal2[h] as number;
        let acc = 0;
        for (let s = 0; s < len1; s++) {
          const y = sup1[s] as number;
          let term = (o1[y] as number) * ((w2[hBase + y] as number) / total) * product(plan.reachMat, nfMat, hBase + y);
          if (o2 !== null) term *= o2[hBase + y] as number;
          acc += term;
        }
        reach[h] = a * acc;
      }
    }

    // --- 비폴드 EV ---
    for (const term of plan.terms) {
      const { pot, base, others } = term;
      if (others.length === 0) {
        for (let h = 0; h < N; h++) {
          const p = product(term.vec, nfVec, h);
          num[h] = (num[h] as number) + p * (pot + base);
          den[h] = (den[h] as number) + p;
        }
        continue;
      }
      const s1 = strat[others[0] as number] as Float64Array;
      const sup1 = support[others[0] as number] as Int32Array;
      const len1 = supportLen[others[0] as number] as number;
      if (others.length === 1) {
        for (let h = 0; h < N; h++) {
          const a = product(term.vec, nfVec, h);
          if (a === 0) continue;
          const hBase = h * N;
          const total = rowTotal2[h] as number;
          let accNum = 0;
          let accDen = 0;
          for (let s = 0; s < len1; s++) {
            const y = sup1[s] as number;
            const p = (s1[y] as number) * ((w2[hBase + y] as number) / total) * product(term.mat, nfMat, hBase + y);
            accDen += p;
            accNum += p * ((eq2[hBase + y] as number) * pot + base);
          }
          num[h] = (num[h] as number) + a * accNum;
          den[h] = (den[h] as number) + a * accDen;
        }
        continue;
      }
      const s2 = strat[others[1] as number] as Float64Array;
      const sup2 = support[others[1] as number] as Int32Array;
      const len2 = supportLen[others[1] as number] as number;
      for (let h = 0; h < N; h++) {
        const a = product(term.vec, nfVec, h);
        if (a === 0) continue;
        const hBase = h * N;
        const norm = (rowTotal2[h] as number) * REMAINING_PAIRS;
        let accNum = 0;
        let accDen = 0;
        for (let sy = 0; sy < len1; sy++) {
          const y = sup1[sy] as number;
          const bFactor = product(term.mat, nfMat, hBase + y);
          if (bFactor === 0) continue;
          const wBase = (hBase + y) * N;
          let innerNum = 0;
          let innerDen = 0;
          for (let sc = 0; sc < len2; sc++) {
            const c = sup2[sc] as number;
            const weight = (s2[c] as number) * (w3[wBase + c] as number);
            innerDen += weight;
            innerNum += weight * ((share3[wBase + c] as number) * pot + base);
          }
          const f = ((s1[y] as number) * bFactor) / norm;
          accDen += f * innerDen;
          accNum += f * innerNum;
        }
        num[h] = (num[h] as number) + a * accNum;
        den[h] = (den[h] as number) + a * accDen;
      }
    }
  };

  let iterations = 0;

  for (let t = 1; t <= maxIterations; t++) {
    iterations = t;
    for (let i = 0; i < spec.n; i++) {
      refresh(i);
      for (const k of tree.nodesByPlayer[i] as number[]) {
        const plan = plans[k] as NodePlan;
        evaluate(plan);
        for (let h = 0; h < N; h++) {
          const d = den[h] as number;
          const ev = d > 0 ? (num[h] as number) / d : 0;
          // 반정규화 counterfactual: p(h)·R(x|h)·EV. RM+ 는 스케일에 불변이지만
          // h 마다 다른 이 가중치가 빠지면 다른 게임을 푸는 것이 된다.
          diff[h] = (classProb[h] as number) * (reach[h] as number) * ev;
        }
        updateRegrets(diff, strat[k] as Float64Array, regretPos[k] as Float64Array, regretNeg[k] as Float64Array);
        dirty[k] = 1;
      }
    }
    // 선형 가중 평균 (CFR+ 의 표준): 나중 반복에 더 큰 가중치.
    for (let k = 0; k < nodeCount; k++) {
      const s = strat[k] as Float64Array;
      const acc = sum[k] as Float64Array;
      for (let h = 0; h < N; h++) acc[h] = (acc[h] as number) + t * (s[h] as number);
    }
    weightSum += t;

    if (t >= CHECK_FROM && t % CHECK_EVERY === 0) {
      for (let k = 0; k < nodeCount; k++) {
        const acc = sum[k] as Float64Array;
        const a = avg[k] as Float64Array;
        for (let h = 0; h < N; h++) a[h] = (acc[h] as number) / weightSum;
      }
      const probe = bestResponse(tree, spec, tables, payoffs, avg);
      if (Math.max(...probe.gains) < epsilonTarget) break;
    }
  }

  for (let k = 0; k < nodeCount; k++) {
    const acc = sum[k] as Float64Array;
    const a = avg[k] as Float64Array;
    for (let h = 0; h < N; h++) a[h] = (acc[h] as number) / weightSum;
  }
  // 마지막 평균 전략으로 한 번 더 — 정지 시점의 평균과 최종 평균이 같아야 기록이 정직하다.
  const final = bestResponse(tree, spec, tables, payoffs, avg);
  const gains = final.gains;
  const epsilonBb = Math.max(...gains);
  const nashConvBb = gains.reduce((a, b) => a + b, 0);

  if (!(epsilonBb < EPSILON_GATE_BB) && opts.allowGateFailure !== true) {
    throw new ExploitabilityGateError(label, epsilonBb, iterations);
  }

  return {
    nodes: tree.nodes.map((_unused, k) => ({
      strategy: avg[k] as Float64Array,
      ev: final.ev[k] as Float64Array,
    })),
    epsilonBb,
    nashConvBb,
    exploitabilityBb: nashConvBb / spec.n,
    gainsBb: gains,
    gameValueBb: final.values,
    sumGameValueBb: final.sumValue,
    massDefect: final.massDefect,
    iterations,
  };
}
