/**
 * 차트 노드(1326 전략 + 1326 도달 레인지) → 169 표시 모델. P2.md 3.5 / 9.
 *
 * **표시 전용이다.** 여기서 나온 169 값은 어떤 계산에도 다시 들어가지 않는다 (D4).
 * 집계는 도달 레인지 가중 평균이다 — 단순 평균은 콤보 가중치를 무시해서 틀린다:
 *   freq(h, a) = Σ_{c∈h} reach[c]·strategy[a][c] / Σ_{c∈h} reach[c]
 */

import { HAND_CLASS_COUNT, HandClassKind, handClassCombos, handClassKind, handClassName } from '@ggto/core';
import type { CellLayer, CellModel } from './grid';

const CLASS_COMBOS: readonly (readonly number[])[] = Array.from({ length: HAND_CLASS_COUNT }, (_unused, h) =>
  handClassCombos(h),
);

const KIND_OF: Record<HandClassKind, CellModel['kind']> = {
  [HandClassKind.Pair]: 'pair',
  [HandClassKind.Suited]: 'suited',
  [HandClassKind.Offsuit]: 'offsuit',
};

/** 액션 종류별 고정 색 (P2.md 9). 사이즈가 있는 공격은 amber → red 램프. */
const FIXED_COLORS: Readonly<Record<string, string>> = {
  F: '#64748b', // slate
  X: '#38bdf8', // sky
  C: '#10b981', // emerald
  A: '#dc2626', // crimson
};

const RAMP_FROM = [245, 158, 11] as const; // amber
const RAMP_TO = [239, 68, 68] as const; // red

function ramp(i: number, n: number): string {
  const t = n <= 1 ? 0 : i / (n - 1);
  const ch = RAMP_FROM.map((from, k) => Math.round(from + ((RAMP_TO[k] as number) - from) * t));
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** 액션 토큰의 금액 (없으면 null). 문법은 core 가 정본이지만 색 배정에는 크기만 필요하다. */
function sizeOf(token: string): number | null {
  if (token.length < 2) return null;
  const head = token[0];
  if (head !== 'B' && head !== 'R') return null;
  const n = Number(token.slice(1));
  return Number.isFinite(n) ? n : null;
}

/** 액션 토큰 → 색. 같은 노드 안에서 사이즈 순서대로 amber→red 를 배정한다. */
export function actionColors(actions: readonly string[]): Record<string, string> {
  const sized = actions
    .map((a) => ({ a, size: sizeOf(a) }))
    .filter((x): x is { a: string; size: number } => x.size !== null)
    .sort((x, y) => x.size - y.size);
  const out: Record<string, string> = {};
  for (const a of actions) {
    const fixed = FIXED_COLORS[a];
    if (fixed !== undefined) out[a] = fixed;
  }
  sized.forEach(({ a }, i) => {
    out[a] = ramp(i, sized.length);
  });
  // 알 수 없는 토큰이 와도 색이 없어 안 그려지는 일이 없게 한다 (조용한 누락 방지).
  for (const a of actions) out[a] ??= '#a855f7';
  return out;
}

export interface ChartCellInput {
  actions: readonly string[];
  /** [a] → 1326 */
  strategy: readonly Float32Array[];
  /** [a] → 1326, 없으면 null */
  ev: readonly Float32Array[] | null;
  /** 1326. 히어로 포지션의 도달 레인지 */
  reach: Float32Array;
}

export interface ChartCellModel extends CellModel {
  /** 액션별 빈도 (3.5). 합은 1 (레인지 밖이면 전부 0) */
  freq: number[];
  /** 액션별 reach 가중 평균 EV. ev 가 없으면 null */
  ev: number[] | null;
}

/** 3.5 집계. strategy 모드 격자와 우측 패널이 같은 값을 쓴다. */
export function buildChartCells(input: ChartCellInput, colors: Record<string, string>): ChartCellModel[] {
  const { actions, strategy, ev, reach } = input;
  const cells: ChartCellModel[] = new Array<ChartCellModel>(HAND_CLASS_COUNT);
  for (let h = 0; h < HAND_CLASS_COUNT; h++) {
    const combos = CLASS_COMBOS[h] as readonly number[];
    let den = 0;
    let active = 0;
    const num = new Array<number>(actions.length).fill(0);
    const evNum = ev === null ? null : new Array<number>(actions.length).fill(0);
    for (const c of combos) {
      const w = reach[c] ?? 0;
      if (w <= 0) continue;
      den += w;
      active++;
      for (let a = 0; a < actions.length; a++) {
        num[a] = (num[a] as number) + w * ((strategy[a] as Float32Array)[c] as number);
        if (evNum !== null) {
          evNum[a] = (evNum[a] as number) + w * (((ev as Float32Array[])[a] as Float32Array)[c] as number);
        }
      }
    }
    const inRange = den > 0;
    const freq = inRange ? num.map((x) => x / den) : num.map(() => 0);
    const layers: CellLayer[] = [];
    if (inRange) {
      for (let a = 0; a < actions.length; a++) {
        const fraction = freq[a] as number;
        if (fraction <= 0) continue;
        const key = actions[a] as string;
        layers.push({ key, color: colors[key] ?? '#a855f7', fraction });
      }
    }
    cells[h] = {
      handClass: h,
      label: handClassName(h),
      kind: KIND_OF[handClassKind(h)],
      comboCount: combos.length,
      activeCombos: active,
      weightSum: den,
      fill: layers.reduce((acc, l) => acc + l.fraction, 0),
      inRange,
      layers,
      freq,
      ev: evNum === null || !inRange ? null : evNum.map((x) => x / den),
    };
  }
  return cells;
}

export function formatPct(x: number): string {
  return `${(x * 100).toFixed(x >= 0.995 || x <= 0.005 ? 0 : 1)}%`;
}

export function formatEv(x: number): string {
  return `${x >= 0 ? '+' : ''}${x.toFixed(2)}bb`;
}

/**
 * 호버 상태줄 / 패널 제목 공통 표기 (P2.md 9). 툴팁과 상태줄이 **같은 함수**를 쓴다.
 * 예: `AKs · A 100% +1.42bb · F 0% 0.00bb`
 */
export function formatChartCellSummary(cell: ChartCellModel, actions: readonly string[]): string {
  if (!cell.inRange) return `${cell.label} · not in range`;
  const parts = actions.map((a, i) => {
    const f = formatPct(cell.freq[i] as number);
    const ev = cell.ev === null ? '' : ` ${formatEv(cell.ev[i] as number)}`;
    return `${a} ${f}${ev}`;
  });
  return [cell.label, ...parts].join(' · ');
}
