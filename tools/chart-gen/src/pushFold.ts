/**
 * HU 푸시/폴드 내시 균형 (P2.md 7.1). CFR+ / regret matching+, 정확한 best response 로
 * exploitability 를 계산해 게이트로 쓴다.
 *
 * 게임: SB 가 먼저 {A(올인), F} 중 고르고, 잼을 당한 BB 가 {C, F} 중 고른다. 다른 액션은
 * 없다 (그것이 "푸시/폴드" 모델이다). 정보집합은 SB 169 + BB 169 개.
 *
 * 손패 분포는 169 클래스 쌍의 **콤보 쌍 개수** w(h,v) 로 준다 — 즉 카드 제거가 들어 있다.
 * Σ_{h,v} w(h,v) = 1326 × 1225 = 1,624,350 (테스트가 고정한다).
 *
 * 지불(한 판 전체 기준, SB 시점, 제로섬):
 *   SB 폴드                 : -0.5
 *   SB 잼 → BB 폴드         : +1.0
 *   SB 잼 → BB 콜           : 2S·eq(h,v) - S
 * 파일에 쓰는 EV 는 3.3 의 "노드 이후" 기준이라 여기서 한 번 더 변환한다 (fold = 0).
 */

import { COMBO_KEYS, CLASS_KEYS } from '@ggto/preflop';
import { comboCards, handClassCombos } from '@ggto/core';

export const CLASS_COUNT = CLASS_KEYS.length;

/** w[h*169+v] = 클래스 h 의 콤보와 클래스 v 의 콤보로 만들 수 있는 **서로 겹치지 않는** 순서쌍 수 */
export function pairCounts(): Float64Array {
  const w = new Float64Array(CLASS_COUNT * CLASS_COUNT);
  // 카드 2장을 비트마스크로 접지 않고 그대로 비교한다: 클래스당 최대 12콤보라
  // 169²×12×12 ≈ 410만 번의 비교이고 생성기에서 한 번만 돈다.
  const cards = Array.from({ length: CLASS_COUNT }, (_unused, h) =>
    handClassCombos(h).map((c) => comboCards(c)),
  );
  for (let h = 0; h < CLASS_COUNT; h++) {
    const ch = cards[h] as [number, number][];
    for (let v = 0; v < CLASS_COUNT; v++) {
      const cv = cards[v] as [number, number][];
      let n = 0;
      for (const [a1, a2] of ch) {
        for (const [b1, b2] of cv) {
          if (a1 !== b1 && a1 !== b2 && a2 !== b1 && a2 !== b2) n++;
        }
      }
      w[h * CLASS_COUNT + v] = n;
    }
  }
  return w;
}

export interface PushFoldResult {
  stack: number;
  iterations: number;
  /** 169. SB 가 잼하는 빈도 */
  sbJam: Float64Array;
  /** 169. BB 가 잼에 콜하는 빈도 */
  bbCall: Float64Array;
  /** 169. 노드 이후 기준 EV(bb). 폴드는 정의상 0 이라 배열이 없다 */
  sbJamEv: Float64Array;
  bbCallEv: Float64Array;
  /** NashConv / 2 (플레이어당 착취 가능액, bb) */
  exploitabilityBb: number;
  /** BR 이득의 합 (bb) */
  nashConvBb: number;
  /** 균형에서 SB 의 한 판 기대값(bb). 진단용 — HU 푸시/폴드는 항상 음수다(블라인드가 작으므로) */
  sbValueBb: number;
}

interface Matrices {
  w: Float64Array;
  /** W[h] = Σ_v w(h,v) */
  rowTotal: Float64Array;
  /** B[h][v] = w(h,v)·(S + 1 − 2S·eq(h,v)) */
  b: Float64Array;
  total: number;
}

function matrices(equity: readonly (readonly number[])[], stack: number, w: Float64Array): Matrices {
  const n = CLASS_COUNT;
  const b = new Float64Array(n * n);
  const rowTotal = new Float64Array(n);
  let total = 0;
  for (let h = 0; h < n; h++) {
    const row = equity[h] as readonly number[];
    let sum = 0;
    for (let v = 0; v < n; v++) {
      const k = h * n + v;
      const wc = w[k] as number;
      b[k] = wc * (stack + 1 - 2 * stack * (row[v] as number));
      sum += wc;
    }
    rowTotal[h] = sum;
    total += sum;
  }
  return { w, rowTotal, b, total };
}

/** D_SB[h] = V(jam) − V(fold), 반정규화 counterfactual (P2.md 7.1 유도) */
function sbDiff(m: Matrices, call: Float64Array, out: Float64Array): void {
  const n = CLASS_COUNT;
  for (let h = 0; h < n; h++) {
    let acc = 0;
    const base = h * n;
    for (let v = 0; v < n; v++) acc += (call[v] as number) * (m.b[base + v] as number);
    out[h] = 1.5 * (m.rowTotal[h] as number) - acc;
  }
}

/** D_BB[v] = V(call) − V(fold), SB 의 잼 도달확률이 곱해진 counterfactual */
function bbDiff(m: Matrices, jam: Float64Array, out: Float64Array): void {
  const n = CLASS_COUNT;
  out.fill(0);
  for (let h = 0; h < n; h++) {
    const s = jam[h] as number;
    if (s === 0) continue;
    const base = h * n;
    for (let v = 0; v < n; v++) out[v] = (out[v] as number) + s * (m.b[base + v] as number);
  }
}

/** 2액션 정보집합의 regret matching+ (음의 후회는 0 으로 눌러 둔다) */
function updateRegrets(diff: Float64Array, strat: Float64Array, rPos: Float64Array, rNeg: Float64Array): void {
  for (let i = 0; i < CLASS_COUNT; i++) {
    const d = diff[i] as number;
    const p = strat[i] as number;
    const a = Math.max(0, (rPos[i] as number) + (1 - p) * d);
    const f = Math.max(0, (rNeg[i] as number) - p * d);
    rPos[i] = a;
    rNeg[i] = f;
    const sum = a + f;
    // 후회가 전부 0 이면 (아직 정보 없음) 균등. CFR 의 표준 규약이다.
    strat[i] = sum > 0 ? a / sum : 0.5;
  }
}

export function solvePushFold(
  equity: readonly (readonly number[])[],
  stack: number,
  iterations: number,
  w: Float64Array = pairCounts(),
): PushFoldResult {
  const n = CLASS_COUNT;
  const m = matrices(equity, stack, w);

  const jam = new Float64Array(n).fill(0.5);
  const call = new Float64Array(n).fill(0.5);
  const jamRA = new Float64Array(n);
  const jamRF = new Float64Array(n);
  const callRC = new Float64Array(n);
  const callRF = new Float64Array(n);
  const jamSum = new Float64Array(n);
  const callSum = new Float64Array(n);
  const dSb = new Float64Array(n);
  const dBb = new Float64Array(n);
  let weightSum = 0;

  for (let t = 1; t <= iterations; t++) {
    sbDiff(m, call, dSb);
    updateRegrets(dSb, jam, jamRA, jamRF);
    bbDiff(m, jam, dBb);
    updateRegrets(dBb, call, callRC, callRF);
    // 선형 가중 평균 (CFR+ 의 표준): 나중 반복에 더 큰 가중치.
    for (let i = 0; i < n; i++) {
      jamSum[i] = (jamSum[i] as number) + t * (jam[i] as number);
      callSum[i] = (callSum[i] as number) + t * (call[i] as number);
    }
    weightSum += t;
  }

  const jamAvg = new Float64Array(n);
  const callAvg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    jamAvg[i] = (jamSum[i] as number) / weightSum;
    callAvg[i] = (callSum[i] as number) / weightSum;
  }

  // --- exploitability: 평균 전략에 대한 정확한 best response ---
  sbDiff(m, callAvg, dSb);
  bbDiff(m, jamAvg, dBb);
  let sbGain = 0;
  let sbValue = 0;
  for (let h = 0; h < n; h++) {
    const d = dSb[h] as number;
    const s = jamAvg[h] as number;
    sbGain += Math.max(0, d) - s * d;
    // V_fold(h) = −0.5·W(h) 를 기준으로 한 한 판 전체 기대값
    sbValue += s * d - 0.5 * (m.rowTotal[h] as number);
  }
  let bbGain = 0;
  for (let v = 0; v < n; v++) {
    const d = dBb[v] as number;
    bbGain += Math.max(0, d) - (callAvg[v] as number) * d;
  }
  const nashConv = (sbGain + bbGain) / m.total;

  // --- 파일에 쓸 EV (3.3 기준: 노드 이후 스택 변화, fold = 0) ---
  const sbJamEv = new Float64Array(n);
  for (let h = 0; h < n; h++) sbJamEv[h] = (dSb[h] as number) / (m.rowTotal[h] as number);
  const bbCallEv = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    let reach = 0;
    for (let h = 0; h < n; h++) reach += (jamAvg[h] as number) * (m.w[h * n + v] as number);
    if (!(reach > 0)) {
      // SB 가 어떤 핸드로도 잼하지 않으면 이 노드는 도달 불가라 EV 가 정의되지 않는다.
      // 균형에서는 일어나지 않는다 (AA 는 항상 잼). 조용히 0 을 쓰지 않고 드러낸다.
      throw new Error(`BB node is unreachable for class ${String(CLASS_KEYS[v])}: SB never jams`);
    }
    bbCallEv[v] = (dBb[v] as number) / reach;
  }

  return {
    stack,
    iterations,
    sbJam: jamAvg,
    bbCall: callAvg,
    sbJamEv,
    bbCallEv,
    exploitabilityBb: nashConv / 2,
    nashConvBb: nashConv,
    sbValueBb: sbValue / m.total,
  };
}

/** 1326 가중 잼 콤보 수 (성질 게이트 (b) 단조성 검사용) */
export function jamCombos(jam: Float64Array): number {
  let sum = 0;
  for (let h = 0; h < CLASS_COUNT; h++) sum += (jam[h] as number) * handClassCombos(h).length;
  return sum;
}

export const TOTAL_COMBOS = COMBO_KEYS.length;
