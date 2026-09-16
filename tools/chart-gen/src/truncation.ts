/**
 * 절단 이득 측정 (P7.md 5.5, D31).
 *
 * 콜러 상한 때문에 모델에서 지워진 결정 노드 x (잼 + 콜 2, 다음 액터 i) 마다, **모델 밖
 * 액션 "콜" 의 best-response 이득**을 몬테카를로로 잰다:
 * ```
 * gain_x = Σ_h p(h)·P(x|h)·max(0, EV_call4(h))
 * ```
 * 의미는 상한이다 — "4-way 라인을 허용한 게임에서 어떤 플레이어가 **첫 번째 절단 결정**
 * 에서 얻을 수 있는 최대"이고, 그 뒤 플레이어들의 2차 반응은 포함하지 않는다.
 * `truncationGainBb > 0.02bb` 인 차트는 출하하지 않는다.
 *
 * 세 상대의 핸드는 "전략 × 겹치지 않는 균등" 으로 뽑는다 — 히어로 핸드를 조건으로 한
 * **정확한** 4핸드 결합분포다 (p3 근사가 아니다). 반면 `P(x|h)` 는 w4 가 없으므로 1.4 의
 * 규칙을 그대로 연장해 (h, 잼 핸드) 까지만 조건으로 쓴다 — 이 근사는 이득의 **가중치**에만
 * 들어가고 EV 자체에는 들어가지 않는다.
 */

import { comboCards, createRng, handClassCombos, type Rng } from '@ggto/core';
import { evaluateMasks } from '@ggto/core/internal';
import { COMBO_KEYS } from '@ggto/preflop';
import { fnv1a32 } from './equityTable.js';
import type { GameSpec } from './payoff.js';
import { N, REMAINING_PAIRS, resolveEquity3, type NmaxTables } from './tables.js';
import type { PushFoldTree } from './tree.js';

export const DEFAULT_TRUNCATION_SAMPLES = 2000;

export interface TruncationResult {
  totalBb: number;
  byPlayerBb: number[];
  byNode: { seq: string; actor: number; gainBb: number }[];
  samples: number;
}

const COMBO_COUNT = COMBO_KEYS.length;

/** 콤보 인덱스 → 두 카드 (핫 경로에서 배열 할당을 피한다) */
const COMBO_HI = new Uint8Array(COMBO_COUNT);
const COMBO_LO = new Uint8Array(COMBO_COUNT);
const COMBO_CLASS = new Uint8Array(COMBO_COUNT);
for (let i = 0; i < COMBO_COUNT; i++) {
  const [hi, lo] = comboCards(i);
  COMBO_HI[i] = hi;
  COMBO_LO[i] = lo;
}
for (let h = 0; h < N; h++) {
  for (const c of handClassCombos(h)) COMBO_CLASS[c] = h;
}

/** 클래스의 대표 콤보. 프리플랍은 슈트 순열이 자기동형이라 어느 콤보를 골라도 같은 값이다. */
function representative(h: number): number {
  const combos = handClassCombos(h);
  const first = combos[0];
  if (first === undefined) throw new Error(`hand class ${String(h)} has no combos`);
  return first;
}

/** σ(class(combo)) 를 가중치로 하는 1326 누적합. 0 이면 뽑히지 않는다. */
function comboCumulative(strategy: Float64Array): Float64Array {
  const cum = new Float64Array(COMBO_COUNT);
  let acc = 0;
  for (let c = 0; c < COMBO_COUNT; c++) {
    acc += strategy[COMBO_CLASS[c] as number] as number;
    cum[c] = acc;
  }
  return cum;
}

function drawCombo(cum: Float64Array, rng: Rng): number {
  const total = cum[COMBO_COUNT - 1] as number;
  const target = rng.nextFloat() * total;
  let lo = 0;
  let hi = COMBO_COUNT - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((cum[mid] as number) > target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function truncationGain(
  tree: PushFoldTree,
  spec: GameSpec,
  tables: NmaxTables,
  strategy: readonly Float64Array[],
  chartId: string,
  samples: number = DEFAULT_TRUNCATION_SAMPLES,
): TruncationResult {
  const byPlayerBb = new Array<number>(spec.n).fill(0);
  const byNode: { seq: string; actor: number; gainBb: number }[] = [];
  if (tree.truncated.length === 0) return { totalBb: 0, byPlayerBb, byNode, samples };

  const { w2, rowTotal2, classProb } = tables;
  // 절단 노드가 있다는 것은 n ≥ 4 라는 뜻이다 — 3-way 표 없이는 도달 확률을 못 만든다.
  const { w3 } = resolveEquity3(tables, tree, `${chartId} truncation gain`);

  // 폴더의 비폴드 확률 (조건 (h) 와 (h, 잼 핸드)) — 도달 확률 가중치에만 쓴다.
  const nfVec: Float64Array[] = tree.nodes.map((_unused, k) => {
    const sigma = strategy[k] as Float64Array;
    const out = new Float64Array(N);
    for (let h = 0; h < N; h++) {
      let acc = 0;
      for (let y = 0; y < N; y++) acc += (sigma[y] as number) * (w2[h * N + y] as number);
      out[h] = acc / (rowTotal2[h] as number);
    }
    return out;
  });
  const nfMatCache = new Map<number, Float64Array>();
  const nfMatOf = (k: number): Float64Array => {
    const hit = nfMatCache.get(k);
    if (hit !== undefined) return hit;
    const sigma = strategy[k] as Float64Array;
    const out = new Float64Array(N * N);
    for (let h = 0; h < N; h++) {
      const hBase = h * N;
      for (let y = 0; y < N; y++) {
        const pairW = w2[hBase + y] as number;
        if (pairW === 0) continue;
        const base = (hBase + y) * N;
        let acc = 0;
        for (let c = 0; c < N; c++) acc += (sigma[c] as number) * (w3[base + c] as number);
        out[hBase + y] = acc / (pairW * REMAINING_PAIRS);
      }
    }
    nfMatCache.set(k, out);
    return out;
  };

  for (const trunc of tree.truncated) {
    const hero = trunc.actor;
    const activeNodes = trunc.J.map((p) => nodeOnPath(tree, trunc.seq, p));
    const folderNodes: { node: number; conditioned: boolean }[] = [];
    const tokens = trunc.seq === '' ? [] : trunc.seq.split('-');
    let seenActive = 0;
    for (const [p, token] of tokens.entries()) {
      if (token !== 'F') {
        seenActive++;
        continue;
      }
      const k = tree.bySeq.get(tokens.slice(0, p).join('-'));
      // 상한에 걸린 강제 폴드는 결정 노드가 없다 (확률 1).
      if (k === undefined) continue;
      folderNodes.push({ node: k, conditioned: seenActive > 0 });
    }

    // --- 도달 확률 P(x|h) ---
    const jamStrat = strategy[activeNodes[0] as number] as Float64Array;
    const call1 = nfMatOf(activeNodes[1] as number);
    const call2 = nfMatOf(activeNodes[2] as number);
    const reach = new Float64Array(N);
    for (let h = 0; h < N; h++) {
      let a = 1;
      for (const f of folderNodes) {
        if (!f.conditioned) a *= 1 - ((nfVec[f.node] as Float64Array)[h] as number);
      }
      if (a === 0) continue;
      const hBase = h * N;
      const total = rowTotal2[h] as number;
      let acc = 0;
      for (let y = 0; y < N; y++) {
        const s = jamStrat[y] as number;
        if (s === 0) continue;
        let term = s * ((w2[hBase + y] as number) / total);
        for (const f of folderNodes) {
          if (f.conditioned) term *= 1 - (nfMatOf(f.node)[hBase + y] as number);
        }
        term *= (call1[hBase + y] as number) * (call2[hBase + y] as number);
        acc += term;
      }
      reach[h] = a * acc;
    }

    // --- 모델 밖 콜의 EV (4-way 쇼다운) ---
    const pot = spec.antePot + 4 * spec.stack + foldedBlinds(spec, [...trunc.J, hero]);
    const base = -spec.stack + (spec.blind[hero] as number);
    const cums = activeNodes.map((k) => comboCumulative(strategy[k] as Float64Array));
    const rng = createRng(fnv1a32(`${chartId}|${trunc.seq}`));
    const handScratch = new Int32Array(6);
    let gain = 0;
    for (let h = 0; h < N; h++) {
      const weight = (classProb[h] as number) * (reach[h] as number);
      if (weight <= 0) continue;
      const rep = representative(h);
      const hero1 = COMBO_HI[rep] as number;
      const hero2 = COMBO_LO[rep] as number;
      let shareSum = 0;
      for (let s = 0; s < samples; s++) {
        shareSum += sampleShare(cums, rng, hero1, hero2, handScratch);
      }
      const ev = (shareSum / samples) * pot + base;
      if (ev > 0) gain += weight * ev;
    }
    byNode.push({ seq: trunc.seq, actor: hero, gainBb: gain });
    byPlayerBb[hero] = (byPlayerBb[hero] as number) + gain;
  }

  return { totalBb: byPlayerBb.reduce((a, b) => a + b, 0), byPlayerBb, byNode, samples };
}

/**
 * 한 샘플의 히어로 지분 (4-way 쇼다운, 동률은 균등 분할).
 * 마스크는 스칼라로 든다 — 샘플마다 배열을 만들면 4,200만 샘플에서 GC 가 지배한다.
 */
function sampleShare(cums: readonly Float64Array[], rng: Rng, hero1: number, hero2: number, hands: Int32Array): number {
  let ulo = 0;
  let uhi = 0;
  if (hero1 < 32) ulo |= 1 << hero1;
  else uhi |= 1 << (hero1 - 32);
  if (hero2 < 32) ulo |= 1 << hero2;
  else uhi |= 1 << (hero2 - 32);

  for (let p = 0; p < 3; p++) {
    for (;;) {
      const combo = drawCombo(cums[p] as Float64Array, rng);
      const a = COMBO_HI[combo] as number;
      const b = COMBO_LO[combo] as number;
      const aUsed = a < 32 ? (ulo & (1 << a)) !== 0 : (uhi & (1 << (a - 32))) !== 0;
      if (aUsed) continue;
      const bUsed = b < 32 ? (ulo & (1 << b)) !== 0 : (uhi & (1 << (b - 32))) !== 0;
      if (bUsed) continue;
      if (a < 32) ulo |= 1 << a;
      else uhi |= 1 << (a - 32);
      if (b < 32) ulo |= 1 << b;
      else uhi |= 1 << (b - 32);
      hands[p * 2] = a;
      hands[p * 2 + 1] = b;
      break;
    }
  }

  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  for (let n = 0; n < 5; n++) {
    let card = 0;
    for (;;) {
      card = rng.nextInt(52);
      const u = card < 32 ? (ulo & (1 << card)) !== 0 : (uhi & (1 << (card - 32))) !== 0;
      if (!u) break;
    }
    if (card < 32) ulo |= 1 << card;
    else uhi |= 1 << (card - 32);
    const b = 1 << (card >> 2);
    m4 |= m3 & b;
    m3 |= m2 & b;
    m2 |= m1 & b;
    m1 |= b;
    const su = card & 3;
    if (su === 0) s0 |= b;
    else if (su === 1) s1 |= b;
    else if (su === 2) s2 |= b;
    else s3 |= b;
  }

  const vh = evalWith(m1, m2, m3, m4, s0, s1, s2, s3, hero1, hero2);
  let best = vh;
  let ties = 1;
  for (let p = 0; p < 3; p++) {
    const v = evalWith(m1, m2, m3, m4, s0, s1, s2, s3, hands[p * 2] as number, hands[p * 2 + 1] as number);
    if (v > best) {
      best = v;
      ties = 1;
    } else if (v === best) ties++;
  }
  return vh === best ? 1 / ties : 0;
}

/** 보드 마스크에 홀 카드 2장을 더해 평가한다 (equity3Mc 와 같은 패턴). */
function evalWith(
  m1: number,
  m2: number,
  m3: number,
  m4: number,
  s0: number,
  s1: number,
  s2: number,
  s3: number,
  h1: number,
  h2: number,
): number {
  let b = 1 << (h1 >> 2);
  let n4 = m4 | (m3 & b);
  let n3 = m3 | (m2 & b);
  let n2 = m2 | (m1 & b);
  let n1 = m1 | b;
  let t0 = s0;
  let t1 = s1;
  let t2 = s2;
  let t3 = s3;
  let su = h1 & 3;
  if (su === 0) t0 |= b;
  else if (su === 1) t1 |= b;
  else if (su === 2) t2 |= b;
  else t3 |= b;

  b = 1 << (h2 >> 2);
  n4 |= n3 & b;
  n3 |= n2 & b;
  n2 |= n1 & b;
  n1 |= b;
  su = h2 & 3;
  if (su === 0) t0 |= b;
  else if (su === 1) t1 |= b;
  else if (su === 2) t2 |= b;
  else t3 |= b;

  return evaluateMasks(n1, n2, n3, n4, t0, t1, t2, t3);
}

function foldedBlinds(spec: GameSpec, allIn: readonly number[]): number {
  const set = new Set(allIn);
  let sum = 0;
  for (let i = 0; i < spec.n; i++) if (!set.has(i)) sum += spec.blind[i] as number;
  return sum;
}

function nodeOnPath(tree: PushFoldTree, seq: string, player: number): number {
  const tokens = seq === '' ? [] : seq.split('-');
  const index = tree.bySeq.get(tokens.slice(0, player).join('-'));
  if (index === undefined) throw new Error(`no decision node for player ${String(player)} on path ${JSON.stringify(seq)}`);
  return index;
}
