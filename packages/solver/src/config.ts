/**
 * `SolveRequest` → `CanonicalConfig` (P4.md 3.1 · 3.2 · 3.3-1).
 *
 * 순수 함수다. 파일도 프로세스도 건드리지 않는다 — 서버가 400 을 돌려줄 판정을 여기서
 * 전부 끝내야 잡을 큐에 넣기 전에 거를 수 있다 (P4.md 7절).
 */

import {
  EmptyRangeError,
  RangeSyntaxError,
  CardSyntaxError,
  canonicalize,
  normalize,
  parseCards,
  parseRange,
  removeBoard,
  type Card,
  type Range,
} from '@ggto/core';
import {
  CHIPS_PER_BB,
  SolveConfigError,
  type CanonicalConfig,
  type RakeConfig,
  type SizingPresetName,
  type Sizings,
  type SolveRequest,
} from './types.js';

export const MAX_RANGE_TEXT = 4000;

/**
 * 베팅 사이즈 프리셋 (P4.md 3.2 표). API 는 **프리셋 이름만** 받는다 — 커스텀은 CLI 전용이다.
 * 트리 폭발을 UX 로 막는 것이 5.2 의 결정이다.
 */
export const SIZING_PRESETS: Readonly<Record<SizingPresetName, Sizings>> = {
  simple: {
    flop: { bet: '33%,75%', raise: '2.5x' },
    turn: { bet: '75%', raise: '2.5x' },
    river: { bet: '75%', raise: '2.5x' },
  },
  standard: {
    flop: { bet: '33%,66%,125%', raise: '2.5x,4x' },
    turn: { bet: '50%,100%', raise: '2.5x,4x' },
    river: { bet: '50%,100%,200%', raise: '2.5x,4x' },
  },
  'river-heavy': {
    flop: { bet: '50%', raise: '3x' },
    turn: { bet: '75%', raise: '3x' },
    river: { bet: '33%,66%,100%,200%', raise: '3x' },
  },
};

export function isSizingPreset(v: unknown): v is SizingPresetName {
  return typeof v === 'string' && Object.hasOwn(SIZING_PRESETS, v);
}

/** 사이즈 문자열 정규화: 공백 제거 + 정렬 (P4.md 3.1 "사이징은 문자열 정렬·공백 제거") */
function normalizeSizeList(s: string, where: string): string {
  const parts = s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) throw new SolveConfigError('OutOfRange', `${where}: empty sizing list`);
  if (parts.length > 4) {
    // 스트리트당 5개부터는 트리가 곱셈으로 터진다 (P4.md 3.2).
    throw new SolveConfigError('OutOfRange', `${where}: at most 4 sizes per street, got ${String(parts.length)}`);
  }
  return [...parts].sort().join(',');
}

function normalizeSizings(s: Sizings): Sizings {
  const street = (name: 'flop' | 'turn' | 'river'): { bet: string; raise: string } => ({
    bet: normalizeSizeList(s[name].bet, `sizings.${name}.bet`),
    raise: normalizeSizeList(s[name].raise, `sizings.${name}.raise`),
  });
  return { flop: street('flop'), turn: street('turn'), river: street('river') };
}

function num(v: unknown, name: string, lo: number, hi: number, fallback?: number): number {
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new SolveConfigError('OutOfRange', `${name} must be a finite number`);
  }
  if (v <= lo || v > hi) {
    throw new SolveConfigError('OutOfRange', `${name} must be in (${String(lo)}, ${String(hi)}], got ${String(v)}`);
  }
  return v;
}

function parseBoard(text: unknown): Card[] {
  if (typeof text !== 'string') throw new SolveConfigError('BoardSyntax', 'board must be a string');
  let cards: Card[];
  try {
    cards = parseCards(text);
  } catch (e) {
    if (e instanceof CardSyntaxError) throw new SolveConfigError('BoardSyntax', e.message);
    throw e;
  }
  if (cards.length < 3 || cards.length > 5) {
    throw new SolveConfigError('BoardSyntax', `board must be 3..5 cards, got ${String(cards.length)}`);
  }
  return cards;
}

/** 문법 검사 + "애초에 빈 레인지" 검사. 보드 제거는 **정규화 뒤에** 한다 (아래 이유). */
function parseSide(text: unknown, who: 'oop' | 'ip'): Range {
  if (typeof text !== 'string') throw new SolveConfigError('RangeSyntax', `${who} range must be a string`);
  if (text.length > MAX_RANGE_TEXT) {
    throw new SolveConfigError('OutOfRange', `${who} range text is longer than ${String(MAX_RANGE_TEXT)} chars`);
  }
  let r: Range;
  try {
    r = parseRange(text);
  } catch (e) {
    if (e instanceof RangeSyntaxError) throw new SolveConfigError('RangeSyntax', `${who}: ${e.message}`);
    throw e;
  }
  if (!r.some((w) => w > 0)) throw new SolveConfigError('EmptyRange', `${who} range is empty`);
  return r;
}

/** 정규 보드 기준으로 카드 제거 + 정규화. 비면 보드가 레인지를 통째로 지운 것이다. */
function removeAndNormalize(r: Range, board: readonly Card[], who: 'oop' | 'ip'): Range {
  try {
    return normalize(removeBoard(r, board));
  } catch (e) {
    if (e instanceof EmptyRangeError) {
      throw new SolveConfigError(
        'BoardRangeConflict',
        `${who} range has no combo left after removing the board cards`,
      );
    }
    throw e;
  }
}

function normalizeRake(rake: RakeConfig | undefined): RakeConfig {
  if (rake === undefined || rake.mode === 'none') return { mode: 'none' };
  const pct = num(rake.pct, 'rake.pct', 0, 20);
  if (rake.capBb < 0 || !Number.isFinite(rake.capBb)) {
    throw new SolveConfigError('OutOfRange', 'rake.capBb must be >= 0');
  }
  return { mode: 'pot', pct, capBb: rake.capBb };
}

/**
 * 순수 변환. 실패는 전부 `SolveConfigError` 다 (코드가 HTTP 400 본문에 그대로 나간다).
 *
 * 마지막 단계가 `canonicalize` 다 (D5): 레인지의 stabilizer 안에서 최소 보드를 고르므로
 * 레인지가 슈트 비대칭이면 `perm` 이 항등에 가깝고, 분기 없이 같은 코드가 돈다.
 */
export function buildConfig(req: SolveRequest): CanonicalConfig {
  const boardOriginal = parseBoard(req.board);
  const oopRaw = parseSide(req.oop, 'oop');
  const ipRaw = parseSide(req.ip, 'ip');

  const potBb = num(req.potBb, 'potBb', 0, 10_000);
  const stackBb = num(req.stackBb, 'stackBb', 0, 10_000);
  const targetExploitabilityPct = num(req.targetExploitabilityPct, 'targetExploitabilityPct', 0.0499, 5, 0.5);
  const maxIterationsRaw = req.maxIterations ?? 1000;
  if (!Number.isInteger(maxIterationsRaw) || maxIterationsRaw < 10 || maxIterationsRaw > 100_000) {
    throw new SolveConfigError('OutOfRange', 'maxIterations must be an integer in [10, 100000]');
  }

  const sizings = isSizingPreset(req.sizings)
    ? SIZING_PRESETS[req.sizings]
    : (req.sizings as Sizings | undefined);
  if (sizings === undefined || typeof sizings !== 'object') {
    throw new SolveConfigError('OutOfRange', `unknown sizings: ${JSON.stringify(req.sizings)}`);
  }
  for (const street of ['flop', 'turn', 'river'] as const) {
    const s = sizings[street] as { bet?: unknown; raise?: unknown } | undefined;
    if (s === undefined || typeof s.bet !== 'string' || typeof s.raise !== 'string') {
      throw new SolveConfigError('OutOfRange', `sizings.${street} needs {bet, raise} strings`);
    }
  }

  /**
   * **stabilizer 는 카드 제거 *전* 레인지로 계산한다** (D5 의 정확한 형태).
   *
   * `removeBoard` 를 먼저 걸면 stabilizer 가 보드에 의존하게 되어 (보드마다 다른 부분군),
   * 동형인 두 보드가 **서로 다른** 부분군 안에서 최소화돼 다른 대표를 고른다. 실측:
   * 슈트 대칭 레인지 + `Ks7h2h` 와 `Kd7s2s` 가 다른 해시를 받았다.
   * 원래 레인지의 stabilizer 는 보드와 무관하므로 두 보드가 같은 군에서 최소화되고,
   * "∃p ∈ stab(R): p(B1) = B2" 라는 올바른 동치관계를 그대로 준다.
   */
  const { board, ranges: permuted, perm } = canonicalize(boardOriginal, [oopRaw, ipRaw]);
  const ranges: [Range, Range] = [
    removeAndNormalize(permuted[0] as Range, board, 'oop'),
    removeAndNormalize(permuted[1] as Range, board, 'ip'),
  ];

  return {
    board,
    boardOriginal,
    perm,
    ranges,
    // 0.01bb 단위 입력이라 ×100 은 정수다. round 는 부동소수 표현(20.01*100 = 2000.9999…) 때문이다.
    potChips: Math.round(potBb * CHIPS_PER_BB),
    stackChips: Math.round(stackBb * CHIPS_PER_BB),
    chipsPerBb: CHIPS_PER_BB,
    sizings: normalizeSizings(sizings),
    rake: normalizeRake(req.rake),
    compressed: req.compressed === true,
    targetExploitabilityPct,
    maxIterations: maxIterationsRaw,
  };
}
