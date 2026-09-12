/**
 * 스팟 한 개 뽑기 (P3.md 5.3). **순서가 규칙이다**: leech → due(동전) → 가중 추첨.
 *
 * SRS 를 "가중치" 로 넣지 않고 **삽입**으로 처리하는 이유: 확률을 조금 올리는 것으로는
 * "내일 이 스팟을 다시 본다" 를 보장할 수 없다. 간격 반복은 큐 앞에 끼워 넣어야 성립한다.
 *
 * 모든 난수는 호출 측이 준 `Rng` 에서 나온다 (세션 시드의 `createRng`). 같은 DB 상태에서
 * 난수 소비 횟수가 달라지면 키 열이 갈라지므로, **동전은 후보가 실제로 있을 때만** 던진다.
 */

import type { Rng } from '@ggto/core';
import { findNodeByKey, sampleCombo, spotKeyOf, type Pool } from './pool.js';
import { pickNode } from './sampler.js';
import { DAY_MS, LEECH_LAPSES } from './srs.js';
import type { TrainerStore } from './store.js';
import type { Category } from './types.js';

/** 재출제 회피 재시도 횟수. 넘으면 포기하고 중복을 허용한다 (풀이 작으면 피할 수 없다). */
export const RESAMPLE_TRIES = 200;
/** due/leech 후보를 한 번에 읽는 최대 행 수. */
export const DUE_SCAN_LIMIT = 500;
/** 리크보정(w4) 이 보는 창 (P3.md 5.2 "meanEvLoss30d"). */
export const LEAK_WINDOW_DAYS = 30;

/** 카테고리별 30일 평균 EV loss. 기록이 없는 카테고리는 키가 없다 (= 보정 1). */
export function leakMeans(store: TrainerStore, now: number): Map<Category, number> {
  const out = new Map<Category, number>();
  for (const [cat, v] of store.meanEvLossByCategory(now - LEAK_WINDOW_DAYS * DAY_MS)) out.set(cat, v.mean);
  return out;
}

export interface DrawInput {
  store: TrainerStore;
  pool: Pool;
  rng: Rng;
  /** 이 세션에서 이미 낸 키 (재출제 방지) */
  used: ReadonlySet<string>;
  now: number;
}

export function drawSpotKey(input: DrawInput): string {
  const { store, pool, rng, used, now } = input;
  const usable = (d: { spotKey: string }): boolean =>
    !used.has(d.spotKey) && findNodeByKey(pool, d.spotKey) !== null;

  // 1. leech (lapses >= 3) 는 동전 없이 항상 먼저다.
  const leech = store.leechSpots(now, LEECH_LAPSES, DUE_SCAN_LIMIT).find(usable);
  if (leech !== undefined) return leech.spotKey;

  // 2. due 가 있으면 절반의 확률로 그것. `find` 로 첫 후보에서 멈춘다
  //    (스캔 상한이 500 이라 filter 면 매번 500 건을 훑는다).
  const due = store.dueSpots(now, DUE_SCAN_LIMIT).find(usable);
  if (due !== undefined && rng.nextFloat() < 0.5) return due.spotKey;

  // 3. 5.2 가중 추첨.
  const leaks = leakMeans(store, now);
  let key = '';
  for (let i = 0; i < RESAMPLE_TRIES; i++) {
    const node = pickNode(pool.nodes, leaks, rng);
    key = spotKeyOf(node, sampleCombo(node, rng));
    if (!used.has(key)) return key;
  }
  // 풀보다 세션이 길면 중복은 불가피하다. 조용히 멈추지 않고 마지막 키를 쓴다.
  return key;
}
