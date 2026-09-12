/**
 * SM-2 변형 간격 반복 (P3.md 5.3).
 *
 * 원본 SM-2 의 q 는 0..5 이고 우리 verdict 를 그 축에 올린다. `frequency` 채점도
 * 같은 축에 올려야 큐가 하나로 유지된다 (InStrategy 4 / OffStrategy 1).
 */

import type { Verdict } from './types.js';

export const DAY_MS = 86_400_000;
export const INITIAL_EASE = 2.5;
export const MIN_EASE = 1.3;
/** lapses 가 이 값 이상이면 leech: 세션 앞에 강제 배치된다 (P3.md 5.3-1). */
export const LEECH_LAPSES = 3;

const QUALITY: Record<Verdict, number> = {
  Perfect: 5,
  Minor: 3,
  Mistake: 1,
  Blunder: 0,
  InStrategy: 4,
  OffStrategy: 1,
};

export function qualityOf(verdict: Verdict): number {
  return QUALITY[verdict];
}

export interface SrsState {
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
  dueAt: number;
  lastVerdict: Verdict;
  updatedAt: number;
}

export function initialSrs(): Omit<SrsState, 'dueAt' | 'lastVerdict' | 'updatedAt'> {
  return { ease: INITIAL_EASE, intervalDays: 0, reps: 0, lapses: 0 };
}

/**
 * 복습 1회 반영. `prev === null` 이면 첫 복습이다.
 *
 * 순서가 중요하다: **interval 은 갱신 전 ease 로 계산하고, 그 다음에 ease 를 갱신한다**
 * (P3.md 5.3). 반대로 하면 [5,5,5] 의 3회차가 round(6×2.8)=17 이 되어 검증값과 어긋난다.
 */
export function applyReview(prev: SrsState | null, verdict: Verdict, now: number): SrsState {
  const q = qualityOf(verdict);
  const base = prev ?? { ...initialSrs(), dueAt: now, lastVerdict: verdict, updatedAt: now };

  let reps = base.reps;
  let lapses = base.lapses;
  let intervalDays: number;
  if (q < 3) {
    reps = 0;
    intervalDays = 1;
    lapses += 1;
  } else {
    reps += 1;
    intervalDays = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(base.intervalDays * base.ease);
  }
  const ease = Math.max(MIN_EASE, base.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));

  return {
    ease,
    intervalDays,
    reps,
    lapses,
    dueAt: now + intervalDays * DAY_MS,
    lastVerdict: verdict,
    updatedAt: now,
  };
}

export function isLeech(state: { lapses: number }): boolean {
  return state.lapses >= LEECH_LAPSES;
}
