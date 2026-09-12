/**
 * 문서의 전략/EV 표 → **1326 f32 행** (P2.md 6.2-4, 6.2-5).
 *
 * 키 완전성·행 길이·값 범위·행 합을 본 뒤 전개한다. 169 문서는 클래스의 모든 콤보에
 * 같은 행을 복사한다 — 저장 표현은 언제나 1326 이고, 169 는 파일 표현일 뿐이다 (D4).
 *
 * 결함은 전부 모아 `issues` 에 쌓고, 하나라도 있으면 null 을 돌려준다 (P2.md 4.3).
 */

import { COMBO_KEYS, combosForKeyIndex, keyIndex, keysFor } from './keys.js';
import type { ChartIssue, GgtoJson, Resolution } from './types.js';

const COMBO_COUNT = COMBO_KEYS.length;
/** 행 합 허용 오차. P2.md 3.2 */
const SUM_EPS = 1e-4;

export interface NodeRows {
  strategy: Float32Array[];
  ev: Float32Array[] | null;
}

export function buildRows(
  issues: ChartIssue[],
  path: string,
  resolution: Resolution,
  actions: readonly string[],
  strategy: Record<string, number[]>,
  ev: Record<string, number[]> | undefined,
  evBasis: GgtoJson['evBasis'],
): NodeRows | null {
  const keys = keysFor(resolution);
  const nActions = actions.length;
  const stratRows = Array.from({ length: nActions }, () => new Float32Array(COMBO_COUNT));
  const evRows = ev === undefined ? null : Array.from({ length: nActions }, () => new Float32Array(COMBO_COUNT));
  let ok = true;

  const checkExtra = (kind: 'strategy' | 'ev', rows: Record<string, number[]>): void => {
    for (const k of Object.keys(rows)) {
      if (keyIndex(resolution, k) < 0) {
        issues.push({ path: `${path}.${kind}.${k}`, reason: `not a valid ${resolution}-resolution key` });
        ok = false;
      }
    }
  };
  checkExtra('strategy', strategy);
  if (ev !== undefined) checkExtra('ev', ev);

  const foldIndex = actions.indexOf('F');

  for (let k = 0; k < keys.length; k++) {
    const key = keys[k] as string;
    const row = strategy[key];
    if (row === undefined) {
      issues.push({ path: `${path}.strategy.${key}`, reason: 'missing key' });
      ok = false;
      continue;
    }
    if (row.length !== nActions) {
      issues.push({
        path: `${path}.strategy.${key}`,
        reason: `expected ${String(nActions)} values (one per action), got ${String(row.length)}`,
      });
      ok = false;
      continue;
    }
    let sum = 0;
    for (let a = 0; a < nActions; a++) {
      const v = row[a] as number;
      if (v < 0 || v > 1) {
        issues.push({ path: `${path}.strategy.${key}[${String(a)}]`, reason: `value ${String(v)} is outside [0,1]` });
        ok = false;
      }
      sum += v;
    }
    if (!(sum >= 1 - SUM_EPS && sum <= 1 + SUM_EPS)) {
      issues.push({ path: `${path}.strategy.${key}`, reason: `row sums to ${sum.toFixed(6)}, expected 1` });
      ok = false;
    }
    for (const c of combosForKeyIndex(resolution, k)) {
      for (let a = 0; a < nActions; a++) (stratRows[a] as Float32Array)[c] = row[a] as number;
    }

    if (ev === undefined || evRows === null) continue;
    const erow = ev[key];
    if (erow === undefined) {
      issues.push({ path: `${path}.ev.${key}`, reason: 'missing key' });
      ok = false;
      continue;
    }
    if (erow.length !== nActions) {
      issues.push({
        path: `${path}.ev.${key}`,
        reason: `expected ${String(nActions)} values (one per action), got ${String(erow.length)}`,
      });
      ok = false;
      continue;
    }
    // 3.3: 노드 이전 투입은 매몰이므로 Fold 의 EV 는 정확히 0 이다. 파일이 다른 기준점을
    // 쓰면서 라벨만 바꾼 것을 잡는 가장 싼 검사 (6.2-5).
    if (evBasis === 'stack_delta_from_node' && foldIndex >= 0 && erow[foldIndex] !== 0) {
      issues.push({
        path: `${path}.ev.${key}[${String(foldIndex)}]`,
        reason: `fold EV must be exactly 0 under evBasis "stack_delta_from_node", got ${String(erow[foldIndex])}`,
      });
      ok = false;
    }
    for (const c of combosForKeyIndex(resolution, k)) {
      for (let a = 0; a < nActions; a++) (evRows[a] as Float32Array)[c] = erow[a] as number;
    }
  }

  if (!ok) return null;
  return { strategy: stratRows, ev: evRows };
}
