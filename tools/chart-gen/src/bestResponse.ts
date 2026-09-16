/**
 * n-player best response 와 정확도 지표 (P7.md 1.6 · 1.7).
 *
 * **이 파일은 솔버의 EV 루프를 부르지 않는다.** 같은 값을 두 코드 경로로 얻는 것이
 * P2.md 13절이 요구한 독립 재계산이고, 그래서 여기 있는 축약은 희소화 없이 **조밀**하게
 * 다시 쓴 것이다 (느리지만 솔버의 희소화 버그가 여기로 전파되지 않는다).
 *
 * 세 가지를 돌려준다:
 *   - `gains[i] = u_i(BR_i, σ_{−i}) − u_i(σ)` — 각 플레이어가 일탈해서 얻는 bb/핸드.
 *     `epsilonBb = max_i gains[i]` 가 게이트다 (D34).
 *   - `values[i] = u_i(σ)` — 한 판 전체 기준 게임값. 근사가 없으면 Σ = 0 (1.7).
 *   - `massDefect` — `Σ_z P(z|h,x,비폴드)` 를 도달 확률로 나눈 값이 1 에서 벗어난 최대치.
 *     n=3 에서 정확히 0 이고 (1.4-3 의 주변화 항등), n≥4 에서만 양수다.
 */

import { COMBO_COUNT } from '@ggto/core';
import { N, N2, REMAINING_PAIRS, type NmaxTables } from './tables.js';
import type { GameSpec, TerminalPayoff } from './payoff.js';
import { foldNowValue } from './payoff.js';
import { matrixNodes, type FolderInfo, type PushFoldTree } from './tree.js';

export interface BestResponseResult {
  /** 플레이어별 BR 이득 (bb/핸드) */
  gains: number[];
  /** 플레이어별 게임값 u_i(σ) (bb/핸드, 한 판 전체 기준) */
  values: number[];
  sumValue: number;
  massDefect: number;
  /** 노드별 비폴드 EV (169, 노드 기준 — 파일에 쓰는 값) */
  ev: Float64Array[];
  /** 노드별 도달 확률 R(x|h) (169) */
  reach: Float64Array[];
}

/** 폴더 하나가 어떤 조건부로 들어가는가 (1.4 규칙 2). */
interface FolderSplit {
  /** 앞선 활성 상대가 없다 → (h) 조건, 169 벡터 */
  vec: number[];
  /** 앞선 활성 상대가 하나 이상 → (h, y) 조건, y 는 **첫** 활성 상대 (둘째는 버린다) */
  mat: number[];
}

/**
 * 히어로를 뺀 "앞선 활성 상대" 수로 폴더를 나눈다. 강제 폴드(콜러 상한)는 확률 1 이라
 * 어느 쪽에도 넣지 않는다.
 */
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

export function bestResponse(
  tree: PushFoldTree,
  spec: GameSpec,
  tables: NmaxTables,
  payoffs: readonly TerminalPayoff[],
  strategy: readonly Float64Array[],
): BestResponseResult {
  const nodeCount = tree.nodes.length;
  const { w2, w3, share3, eq2, rowTotal2, classProb } = tables;

  // --- 1. 폴더 조건부 확률 (조밀) ---
  const nfVec: Float64Array[] = [];
  const nfMat: Float64Array[] = [];
  const needsMatrix = matrixNodes(tree);
  for (let k = 0; k < nodeCount; k++) {
    const sigma = strategy[k] as Float64Array;
    const vec = new Float64Array(N);
    for (let h = 0; h < N; h++) {
      let acc = 0;
      const base = h * N;
      for (let y = 0; y < N; y++) acc += (sigma[y] as number) * (w2[base + y] as number);
      vec[h] = acc / (rowTotal2[h] as number);
    }
    nfVec.push(vec);
    const mat = new Float64Array(N2);
    if (!needsMatrix.has(k)) {
      nfMat.push(mat);
      continue;
    }
    for (let h = 0; h < N; h++) {
      const hBase = h * N;
      for (let y = 0; y < N; y++) {
        const pairW = w2[hBase + y] as number;
        if (pairW === 0) continue;
        const base = (hBase + y) * N;
        let acc = 0;
        for (let c = 0; c < N; c++) acc += (sigma[c] as number) * (w3[base + c] as number);
        mat[hBase + y] = acc / (pairW * REMAINING_PAIRS);
      }
    }
    nfMat.push(mat);
  }

  // --- 2. 노드별 도달 확률 R(x|h) ---
  const reach: Float64Array[] = [];
  for (const node of tree.nodes) {
    const r = new Float64Array(N);
    const split = splitFolders(node.priorFolders, node.actor);
    const active = node.priorActive;
    if (active.length === 0) {
      for (let h = 0; h < N; h++) r[h] = foldProduct(split.vec, nfVec, h, 1);
    } else {
      const o1 = strategy[activeNodeOf(tree, node.seq, active[0] as number)] as Float64Array;
      const o2 = active.length === 2 ? (nfMat[activeNodeOf(tree, node.seq, active[1] as number)] as Float64Array) : null;
      for (let h = 0; h < N; h++) {
        const a = foldProduct(split.vec, nfVec, h, 1);
        if (a === 0) continue;
        const hBase = h * N;
        const total = rowTotal2[h] as number;
        let acc = 0;
        for (let y = 0; y < N; y++) {
          const s = o1[y] as number;
          if (s === 0) continue;
          let term = s * ((w2[hBase + y] as number) / total) * foldProduct(split.mat, nfMat, hBase + y, 1);
          if (o2 !== null) term *= o2[hBase + y] as number;
          acc += term;
        }
        r[h] = a * acc;
      }
    }
    reach.push(r);
  }

  // --- 3. 노드별 비폴드 EV 와 질량 결함 ---
  const ev: Float64Array[] = Array.from({ length: nodeCount }, () => new Float64Array(N));
  let massDefect = 0;
  for (let hero = 0; hero < spec.n; hero++) {
    const map = tree.heroTerminals[hero] as Map<number, number[]>;
    for (const [nodeIndex, terminalList] of map) {
      const num = new Float64Array(N);
      const den = new Float64Array(N);
      for (const t of terminalList) {
        const z = tree.terminals[t];
        if (z === undefined) throw new Error(`terminal ${String(t)} is missing`);
        const pay = payoffs[t] as TerminalPayoff;
        const split = splitFolders(z.folders, hero);
        const others = z.J.filter((p) => p !== hero);
        const otherNodes = others.map((p) => z.activeNodes[z.J.indexOf(p)] as number);
        const pot = pay.pot;
        const base = pay.base[hero] as number;

        if (others.length === 0) {
          for (let h = 0; h < N; h++) {
            const p = foldProduct(split.vec, nfVec, h, 1);
            num[h] = (num[h] as number) + p * (pot + base);
            den[h] = (den[h] as number) + p;
          }
          continue;
        }
        const s1 = strategy[otherNodes[0] as number] as Float64Array;
        if (others.length === 1) {
          for (let h = 0; h < N; h++) {
            const a = foldProduct(split.vec, nfVec, h, 1);
            if (a === 0) continue;
            const hBase = h * N;
            const total = rowTotal2[h] as number;
            let accNum = 0;
            let accDen = 0;
            for (let y = 0; y < N; y++) {
              const s = s1[y] as number;
              if (s === 0) continue;
              const p = s * ((w2[hBase + y] as number) / total) * foldProduct(split.mat, nfMat, hBase + y, 1);
              accDen += p;
              accNum += p * ((eq2[hBase + y] as number) * pot + base);
            }
            num[h] = (num[h] as number) + a * accNum;
            den[h] = (den[h] as number) + a * accDen;
          }
          continue;
        }
        const s2 = strategy[otherNodes[1] as number] as Float64Array;
        for (let h = 0; h < N; h++) {
          const a = foldProduct(split.vec, nfVec, h, 1);
          if (a === 0) continue;
          const hBase = h * N;
          const norm = (rowTotal2[h] as number) * REMAINING_PAIRS;
          let accNum = 0;
          let accDen = 0;
          for (let y = 0; y < N; y++) {
            const sy = s1[y] as number;
            if (sy === 0) continue;
            const wBase = (hBase + y) * N;
            const bFactor = foldProduct(split.mat, nfMat, hBase + y, 1);
            if (bFactor === 0) continue;
            let innerNum = 0;
            let innerDen = 0;
            for (let c = 0; c < N; c++) {
              const sc = s2[c] as number;
              if (sc === 0) continue;
              const weight = sc * (w3[wBase + c] as number);
              innerDen += weight;
              innerNum += weight * ((share3[wBase + c] as number) * pot + base);
            }
            const f = (sy * bFactor) / norm;
            accDen += f * innerDen;
            accNum += f * innerNum;
          }
          num[h] = (num[h] as number) + a * accNum;
          den[h] = (den[h] as number) + a * accDen;
        }
      }

      const evRow = ev[nodeIndex] as Float64Array;
      const r = reach[nodeIndex] as Float64Array;
      let nodeReach = 0;
      for (let h = 0; h < N; h++) {
        const d = den[h] as number;
        evRow[h] = d > 0 ? (num[h] as number) / d : 0;
        const rh = r[h] as number;
        nodeReach += (classProb[h] as number) * rh;
        if (rh > 1e-12) {
          const defect = Math.abs(d / rh - 1);
          if (defect > massDefect) massDefect = defect;
        }
      }
      if (!(nodeReach > 0)) {
        // 도달 확률이 0 인 노드는 EV 가 정의되지 않는다. 균형에서는 일어나지 않는다
        // (AA 는 항상 잼·콜). 조용히 0 을 쓰지 않고 드러낸다 (P7 4.2).
        const node = tree.nodes[nodeIndex];
        throw new Error(`node ${JSON.stringify(node?.seq ?? '?')} (player ${String(hero)}) is unreachable: no opponent ever plays into it`);
      }
    }
  }

  // --- 4. 이득과 게임값 ---
  const gains = new Array<number>(spec.n).fill(0);
  const values = new Array<number>(spec.n).fill(0);
  for (let i = 0; i < spec.n; i++) values[i] = foldNowValue(spec, i);
  for (const [k, node] of tree.nodes.entries()) {
    const evRow = ev[k] as Float64Array;
    const r = reach[k] as Float64Array;
    const sigma = strategy[k] as Float64Array;
    let gain = 0;
    let value = 0;
    for (let h = 0; h < N; h++) {
      const weight = (classProb[h] as number) * (r[h] as number);
      if (weight === 0) continue;
      const e = evRow[h] as number;
      gain += weight * (Math.max(0, e) - (sigma[h] as number) * e);
      value += weight * (sigma[h] as number) * e;
    }
    gains[node.actor] = (gains[node.actor] as number) + gain;
    values[node.actor] = (values[node.actor] as number) + value;
  }

  // 전원 폴드 터미널: BB 는 결정 노드가 없으므로 위 합산에 안 들어간다.
  const walk = tree.terminals.find((z) => z.walk);
  if (walk === undefined) throw new Error('tree has no all-fold terminal');
  const walkPay = payoffs[tree.terminals.indexOf(walk)] as TerminalPayoff;
  const walkFolders = walk.folders.filter((f) => !f.forced).map((f) => f.node);
  let walkValue = 0;
  for (let h = 0; h < N; h++) {
    walkValue += (classProb[h] as number) * foldProduct(walkFolders, nfVec, h, 1) * walkPay.pot;
  }
  values[spec.n - 1] = (values[spec.n - 1] as number) + walkValue;

  return {
    gains,
    values,
    sumValue: values.reduce((a, b) => a + b, 0),
    massDefect,
    ev,
    reach,
  };
}

/** Π_f (1 − table[f][index]). 폴더가 없으면 1. */
function foldProduct(nodes: readonly number[], table: readonly Float64Array[], index: number, seed: number): number {
  let p = seed;
  for (const f of nodes) {
    p *= 1 - ((table[f] as Float64Array)[index] as number);
    if (p === 0) return 0;
  }
  return p;
}

/** 터미널·노드 경로에서 플레이어 p 가 비폴드를 고른 결정 노드의 인덱스 */
function activeNodeOf(tree: PushFoldTree, seq: string, player: number): number {
  const tokens = seq === '' ? [] : seq.split('-');
  const prefix = tokens.slice(0, player).join('-');
  const index = tree.nodes.findIndex((n) => n.seq === prefix);
  if (index < 0) throw new Error(`no decision node for player ${String(player)} on path ${JSON.stringify(seq)}`);
  return index;
}

export const TOTAL_COMBOS = COMBO_COUNT;
