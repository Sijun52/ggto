/**
 * 스팟 카테고리 (P3.md 3.2). **상태 기계로만** 정한다.
 *
 * 문자열을 눈으로 세지 않는 이유: `C-R2-C` (림프-레이즈-콜) 와 `R2-C` (오픈-콜) 는
 * 서로 다른 인포셋이고 (D9), 누가 행동 중인지·누가 올인인지는 core 의 `preflopState`
 * 만 안다. 여기서 다시 계산하면 두 개의 규칙이 생긴다.
 */

import { parseActionSequence, preflopState, type PreflopConfig, type PreflopState } from '@ggto/core';
import type { Category } from './types.js';

/** 프리플랍은 스트리트가 하나다. 루트('')는 빈 액션 목록. */
export function preflopStateOf(config: PreflopConfig, seq: string): PreflopState {
  return preflopState(config, parseActionSequence(seq)[0] ?? []);
}

export function categoryOfState(config: PreflopConfig, state: PreflopState): Category {
  let raises = 0;
  let calls = 0;
  for (const a of state.actionsTaken) {
    // 프리플랍에서 'bet' 은 도달 불가다 (블라인드가 항상 currentBet > 0 을 만든다).
    if (a.kind === 'raise' || a.kind === 'allin' || a.kind === 'bet') raises++;
    else if (a.kind === 'call') calls++;
  }
  const limped = raises === 0 && calls > 0;

  if (raises === 0) return limped ? 'vs_limp' : 'open';
  if (facingJam(config, state)) return 'vs_jam';
  if (raises === 1) return 'vs_open';
  if (raises === 2) return 'vs_3bet';
  return 'vs_4bet_plus';
}

export function categoryOf(config: PreflopConfig, seq: string): Category {
  return categoryOfState(config, preflopStateOf(config, seq));
}

const EPS = 1e-9;

/**
 * "누군가 올인이고, 히어로가 콜하면 히어로도 올인이 되는" 상태.
 *
 * 콜은 `min(currentBet, stack)` 까지 채우므로 (core `applyAction` 의 'call' 분기)
 * 히어로가 올인이 되는 조건은 `currentBet >= stack` 이다. `currentBet` 은 증분이 아니라
 * "to" 금액이라 히어로의 기존 투입이 이미 포함돼 있다.
 *
 * P3.md 3.2 는 같은 조건을 `currentBet >= stack - contributions[hero]` 로 적었는데,
 * 두 식은 **도달 가능한 상태 전부에서 동치**다: 어떤 포지션이 올인이 되는 경로
 * (allin 액션 / stack 이하로 깎인 call) 는 전부 `currentBet >= stack` 을 만들고,
 * `currentBet` 은 프리플랍 안에서 감소하지 않는다. 그래서 `allIn` 이 비어 있지 않으면
 * 두 식 다 참이다 (test/category.test.ts 가 시드 전 노드에서 확인한다).
 */
function facingJam(config: PreflopConfig, state: PreflopState): boolean {
  if (state.allIn.size === 0) return false;
  if (state.toAct === null) return false;
  return state.currentBet >= config.stack - EPS;
}

/** 터미널 노드는 출제할 수 없다 (답할 사람이 없다). */
export function isTerminalSeq(config: PreflopConfig, seq: string): boolean {
  return preflopStateOf(config, seq).isTerminal;
}
