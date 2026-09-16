/**
 * n-max 솔버가 쓰는 169 단위 표들 (P7.md 1.4). **생성기 전용 입력**이다 — 런타임의 어떤
 * 경로도 169 인덱스로 계산하지 않는다 (D4).
 *
 * `Float64Array` 는 생성기 내부 연산 전용이다 (D7 은 전송·저장 컨테이너에만 적용되고
 * `tools/chart-gen` 은 이미 그 대상 밖이다).
 */

import { COMBO_COUNT, handClassCombos } from '@ggto/core';
import { CLASS_KEYS } from '@ggto/preflop';
import { pairCounts } from './pushFold.js';
import type { EquityTable } from './equityTable.js';
import type { Equity3 } from './equity3.js';

export const N = CLASS_KEYS.length;
export const N2 = N * N;
/** 히어로·상대 2명의 카드를 뺀 뒤 남는 콤보 수 C(48,2) — p3 의 정규화 상수 */
export const REMAINING_PAIRS = 1128;
/** 히어로의 카드를 뺀 뒤 남는 콤보 수 C(50,2) */
export const REMAINING_SINGLE = 1225;

export interface NmaxTables {
  /** 169² — 서로 겹치지 않는 (h,v) 콤보 순서쌍 수. Σ = 1326·1225 */
  w2: Float64Array;
  /** 169 — Σ_v w2(h,v) = n_h·1225 */
  rowTotal2: Float64Array;
  /** 169 — 클래스 h 의 콤보 수 (6 / 4 / 12) */
  comboCount: Float64Array;
  /** 169 — p(h) = n_h / 1326 */
  classProb: Float64Array;
  /** 169² — eq2(h, v) */
  eq2: Float64Array;
  /** 169³ — eq3(h; y, c). 세 지분의 합은 정확히 1 */
  share3: Float32Array;
  /** 169³ — w3(h, y, c) */
  w3: Float32Array;
  /** `equity169.json@sha256:...` */
  equityRef: string;
  /** `equity169-3way.bin@sha256:...` */
  equity3Ref: string;
  equity3Samples: number;
}

export function buildTables(equity: EquityTable, equity3: Equity3): NmaxTables {
  const w2 = pairCounts();
  const rowTotal2 = new Float64Array(N);
  const comboCount = new Float64Array(N);
  const classProb = new Float64Array(N);
  const eq2 = new Float64Array(N2);
  for (let h = 0; h < N; h++) {
    let sum = 0;
    const row = equity.equity[h] as readonly number[];
    for (let v = 0; v < N; v++) {
      sum += w2[h * N + v] as number;
      eq2[h * N + v] = row[v] as number;
    }
    rowTotal2[h] = sum;
    const nh = handClassCombos(h).length;
    comboCount[h] = nh;
    classProb[h] = nh / COMBO_COUNT;
  }
  return {
    w2,
    rowTotal2,
    comboCount,
    classProb,
    eq2,
    share3: equity3.share,
    w3: equity3.w3,
    equityRef: `equity169.json@sha256:${equity.meta.sha256}`,
    equity3Ref: `equity169-3way.bin@sha256:${equity3.meta.sha256}`,
    equity3Samples: equity3.meta.samples,
  };
}

/**
 * 폴더의 비폴드 확률 (P7.md 1.4 규칙 2, 앞선 활성 상대가 없는 경우):
 * `nfVec[h] = Σ_y p2(y|h)·σ(y)`.
 */
export function foldVector(t: NmaxTables, strategy: Float64Array, out: Float64Array): void {
  for (let h = 0; h < N; h++) {
    const base = h * N;
    let acc = 0;
    for (let y = 0; y < N; y++) {
      const s = strategy[y] as number;
      if (s !== 0) acc += s * (t.w2[base + y] as number);
    }
    out[h] = acc / (t.rowTotal2[h] as number);
  }
}

/**
 * 폴더의 비폴드 확률 (앞선 활성 상대 y 가 하나 있는 경우):
 * `nfMat[h·169+y] = Σ_c [w3(h,y,c)/(w2(h,y)·1128)]·σ(c)`.
 *
 * **희소 축약**: RM+ 는 정확한 0 을 만든다. σ(c)=0 인 c 를 건너뛰면 폴더(대부분 좁다)의
 * 이 루프가 5~10배 빨라진다. 건너뛴 항은 정확히 0 이므로 근사가 아니다.
 */
export function foldMatrix(t: NmaxTables, strategy: Float64Array, out: Float64Array, support: Int32Array, supportLen: number): void {
  const w3 = t.w3;
  const w2 = t.w2;
  if (supportLen === 0) {
    out.fill(0);
    return;
  }
  for (let h = 0; h < N; h++) {
    const hBase = h * N;
    for (let y = 0; y < N; y++) {
      const pairW = w2[hBase + y] as number;
      if (pairW === 0) {
        out[hBase + y] = 0;
        continue;
      }
      const base = (hBase + y) * N;
      let acc = 0;
      for (let s = 0; s < supportLen; s++) {
        const c = support[s] as number;
        acc += (strategy[c] as number) * (w3[base + c] as number);
      }
      out[hBase + y] = acc / (pairW * REMAINING_PAIRS);
    }
  }
}

/** σ 의 지지집합(σ > 0)을 채우고 길이를 돌려준다. */
export function supportOf(strategy: Float64Array, out: Int32Array): number {
  let k = 0;
  for (let c = 0; c < N; c++) {
    if ((strategy[c] as number) > 0) out[k++] = c;
  }
  return k;
}
