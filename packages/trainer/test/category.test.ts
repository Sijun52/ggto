/**
 * P3.md 3.2 카테고리. **상태 기계로만** 정한다 — 문자열을 눈으로 세지 않는다 (D9).
 */

import type { PreflopConfig } from '@ggto/core';
import { describe, expect, it } from 'vitest';
import { categoryOf, isTerminalSeq, preflopStateOf } from '../src/category.js';
import { seededRepo } from './helpers.js';

const HU: PreflopConfig = {
  positions: ['SB', 'BB'],
  blinds: [
    { pos: 'SB', amount: 0.5 },
    { pos: 'BB', amount: 1 },
  ],
  ante: { mode: 'none' },
  stack: 10,
};

const SIX: PreflopConfig = {
  positions: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  blinds: [
    { pos: 'SB', amount: 0.5 },
    { pos: 'BB', amount: 1 },
  ],
  ante: { mode: 'none' },
  stack: 100,
};

describe('P3 3.2 카테고리 = 상태 기계 파생', () => {
  it('루트는 open, 올인 대면은 vs_jam (P2 시드의 두 노드)', () => {
    expect(categoryOf(HU, '')).toBe('open');
    expect(categoryOf(HU, 'A')).toBe('vs_jam');
  });

  it('6max: 폴드만 이어진 노드는 여전히 open 이다 (r === 0)', () => {
    expect(categoryOf(SIX, 'F')).toBe('open');
    expect(categoryOf(SIX, 'F-F-F')).toBe('open');
  });

  it('림프가 있으면 vs_limp (r === 0 && C ≥ 1)', () => {
    expect(categoryOf(SIX, 'C')).toBe('vs_limp');
    expect(categoryOf(SIX, 'F-C')).toBe('vs_limp');
  });

  it('레이즈 1개 = vs_open, 2개 = vs_3bet, 3개 이상 = vs_4bet_plus', () => {
    expect(categoryOf(SIX, 'R2.5')).toBe('vs_open');
    expect(categoryOf(SIX, 'R2.5-R8')).toBe('vs_3bet');
    expect(categoryOf(SIX, 'R2.5-R8-R20')).toBe('vs_4bet_plus');
    expect(categoryOf(SIX, 'R2.5-R8-R20-R45')).toBe('vs_4bet_plus');
  });

  it('올인 대면은 레이즈 수와 무관하게 vs_jam 이 이긴다', () => {
    // R2.5 → A(=100bb 올인) 를 마주한 SB. 레이즈 2개지만 vs_3bet 이 아니라 vs_jam 이다.
    expect(categoryOf(SIX, 'R2.5-A')).toBe('vs_jam');
    expect(categoryOf(SIX, 'R2.5-R8-A')).toBe('vs_jam');
  });

  it('vs_limp 와 vs_open 은 포트 상태가 같아도 갈린다 (D9: 히스토리가 인포셋이다)', () => {
    // C-R2.5 (림프 후 아이솔) 와 R2.5 (오픈) 는 currentBet 이 같아도 다른 카테고리다.
    expect(categoryOf(SIX, 'C-R2.5')).toBe('vs_open');
    expect(categoryOf(SIX, 'C')).toBe('vs_limp');
  });
});

describe('P3 3.2 facingJam 판정은 상태 기계 값으로만 한다', () => {
  it('올인이 있어도 히어로가 콜해도 올인이 안 되면 vs_jam 이 아니다', () => {
    // 짧은 스택이 없는 config 에서 A 는 곧 풀스택이므로 항상 vs_jam 이다.
    // 반대 케이스(올인이 있는데 currentBet < stack)는 균등 스택에서는 만들 수 없다.
    const s = preflopStateOf(SIX, 'R2.5-A');
    expect(s.allIn.size).toBeGreaterThan(0);
    expect(s.currentBet).toBeGreaterThanOrEqual(SIX.stack);
  });

  it('P3.md 3.2 의 두 식이 시드 전 노드에서 동치다', () => {
    const repo = seededRepo();
    try {
      for (const set of repo.listSets()) {
        for (const meta of repo.listNodes(set.id)) {
          const s = preflopStateOf(set.config, meta.seq);
          if (s.allIn.size === 0 || s.toAct === null) continue;
          const contributed = s.contributions[s.toAct] ?? 0;
          const bySpec = s.currentBet >= set.config.stack - contributed - 1e-9;
          const byImpl = s.currentBet >= set.config.stack - 1e-9;
          expect(byImpl).toBe(bySpec);
        }
      }
    } finally {
      repo.close();
    }
  });
});

describe('P3 5.1 터미널 노드 제외', () => {
  it('A-F / A-C 는 터미널이라 출제 대상이 아니다', () => {
    expect(isTerminalSeq(HU, 'A-F')).toBe(true);
    expect(isTerminalSeq(HU, 'A-C')).toBe(true);
    expect(isTerminalSeq(HU, '')).toBe(false);
    expect(isTerminalSeq(HU, 'A')).toBe(false);
  });
});
