/**
 * 레인지 텍스트 파서. P0.md 3.5 (PioSOLVER 호환 부분집합).
 *
 * range := item ( ',' item )*
 * item  := spec ( ':' weight )?
 * spec  := pair | pair '+' | pair '-' pair
 *        | XY sfx? | XY sfx? '+' | XY sfx? '-' XZ sfx?
 *        | combo                                   ('AhKh')
 *
 * 같은 콤보가 여러 item 에 걸리면 마지막 item 이 이긴다 (덮어쓰기).
 * 잘못된 입력은 전부 throw. 조용히 빈 결과를 돌려주지 않는다.
 * 커넥터 '+' ("T9s+", "AKs+", "32+" 등)는 뜻이 도구마다 달라서 거부한다 (3.5, R1).
 * 가중치 표기는 관대하게 받는다 ("AA:1.0", "AA:.5", "AA:01" 전부 값으로만 해석).
 * 정규형은 포매터가 정한다 (의도된 비대칭, P0.md 3.5).
 */

import { RANKS, parseCard } from '../card.js';
import { comboIndex, type ComboIndex } from '../combo.js';
import { HAND_CLASS_COMBOS_TABLE, handClassFromRanks } from '../handClass.js';
import { emptyRange, type Range } from './range.js';

export class RangeSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RangeSyntaxError';
  }
}

const RANK_CHARS = new Set(RANKS.split(''));

function rankOf(ch: string | undefined, item: string): number {
  if (ch === undefined || !RANK_CHARS.has(ch)) {
    throw new RangeSyntaxError(
      `bad rank ${JSON.stringify(ch ?? '')} in item ${JSON.stringify(item)} ` +
        `(ranks are ${RANKS}; "10" is not accepted, use "T")`,
    );
  }
  return RANKS.indexOf(ch);
}

/** 3.5 의 weight 토큰: "0.5" "1" ".25" 허용, 0..1 범위. */
const WEIGHT_RE = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

function parseWeight(text: string, item: string): number {
  if (!WEIGHT_RE.test(text)) {
    throw new RangeSyntaxError(`bad weight ${JSON.stringify(text)} in item ${JSON.stringify(item)}`);
  }
  const w = Number(text);
  if (!Number.isFinite(w) || w < 0 || w > 1) {
    throw new RangeSyntaxError(
      `weight must be in [0,1], got ${JSON.stringify(text)} in item ${JSON.stringify(item)}`,
    );
  }
  return w;
}

type Sfx = 's' | 'o' | undefined;

/** "+" / "-" 가 붙지 않은 단일 스펙. */
interface SimpleSpec {
  kind: 'pair' | 'nonpair' | 'combo';
  hiRank: number;
  loRank: number;
  /** nonpair 전용. undefined 면 s 와 o 둘 다. */
  sfx: Sfx;
  combo: ComboIndex;
}

function parseSimple(text: string, item: string): SimpleSpec {
  if (text.length === 0) throw new RangeSyntaxError(`empty spec in item ${JSON.stringify(item)}`);

  // 4글자: 특정 콤보 ("AhKh")
  if (text.length === 4) {
    let a: number;
    let b: number;
    try {
      a = parseCard(text.slice(0, 2));
      b = parseCard(text.slice(2, 4));
    } catch (e) {
      // 레인지 텍스트 파서의 실패는 항상 RangeSyntaxError 로 통일한다 (호출 측 분기 단순화).
      throw new RangeSyntaxError(
        `bad combo ${JSON.stringify(text)} in item ${JSON.stringify(item)}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    if (a === b) throw new RangeSyntaxError(`combo needs two distinct cards: ${JSON.stringify(item)}`);
    return { kind: 'combo', hiRank: 0, loRank: 0, sfx: undefined, combo: comboIndex(a, b) };
  }

  if (text.length !== 2 && text.length !== 3) {
    throw new RangeSyntaxError(`bad spec ${JSON.stringify(text)} in item ${JSON.stringify(item)}`);
  }

  const r1 = rankOf(text[0], item);
  const r2 = rankOf(text[1], item);
  const sfxChar = text.length === 3 ? (text[2] as string) : undefined;

  if (r1 === r2) {
    if (sfxChar !== undefined) {
      throw new RangeSyntaxError(`pair must not carry a suffix: ${JSON.stringify(item)}`);
    }
    return { kind: 'pair', hiRank: r1, loRank: r1, sfx: undefined, combo: -1 };
  }

  if (r1 < r2) {
    throw new RangeSyntaxError(`hand class must be written high rank first: ${JSON.stringify(item)}`);
  }
  if (sfxChar !== undefined && sfxChar !== 's' && sfxChar !== 'o') {
    // "AKx" 같은 입력. 3글자 스펙 자리에는 s/o 만 온다.
    throw new RangeSyntaxError(`suffix must be "s" or "o": ${JSON.stringify(item)}`);
  }
  return { kind: 'nonpair', hiRank: r1, loRank: r2, sfx: sfxChar as Sfx, combo: -1 };
}

function classesOfNonPair(hiRank: number, loRank: number, sfx: Sfx): number[] {
  if (sfx === 's') return [handClassFromRanks(hiRank, loRank, true)];
  if (sfx === 'o') return [handClassFromRanks(hiRank, loRank, false)];
  return [handClassFromRanks(hiRank, loRank, true), handClassFromRanks(hiRank, loRank, false)];
}

function pushClass(out: ComboIndex[], h: number): void {
  const combos = HAND_CLASS_COMBOS_TABLE[h] as readonly ComboIndex[];
  for (let i = 0; i < combos.length; i++) out.push(combos[i] as ComboIndex);
}

/** 한 item 의 spec 이 덮는 콤보 목록. */
function expandSpec(spec: string, item: string): ComboIndex[] {
  const dash = spec.indexOf('-');
  if (dash >= 0) {
    if (spec.indexOf('-', dash + 1) >= 0) {
      throw new RangeSyntaxError(`only one "-" allowed: ${JSON.stringify(item)}`);
    }
    const left = parseSimple(spec.slice(0, dash), item);
    const right = parseSimple(spec.slice(dash + 1), item);
    if (left.kind === 'combo' || right.kind === 'combo') {
      throw new RangeSyntaxError(`"-" ranges cannot use explicit combos: ${JSON.stringify(item)}`);
    }
    if (left.kind !== right.kind) {
      throw new RangeSyntaxError(`"-" range endpoints must be the same shape: ${JSON.stringify(item)}`);
    }
    const out: ComboIndex[] = [];
    if (left.kind === 'pair') {
      const a = Math.min(left.hiRank, right.hiRank);
      const b = Math.max(left.hiRank, right.hiRank);
      for (let r = b; r >= a; r--) pushClass(out, handClassFromRanks(r, r, true));
      return out;
    }
    if (left.hiRank !== right.hiRank) {
      throw new RangeSyntaxError(`"-" range endpoints must share the high card: ${JSON.stringify(item)}`);
    }
    if (left.sfx !== right.sfx) {
      throw new RangeSyntaxError(`"-" range endpoints must share the s/o suffix: ${JSON.stringify(item)}`);
    }
    const a = Math.min(left.loRank, right.loRank);
    const b = Math.max(left.loRank, right.loRank);
    for (let k = b; k >= a; k--) {
      for (const h of classesOfNonPair(left.hiRank, k, left.sfx)) pushClass(out, h);
    }
    return out;
  }

  if (spec.endsWith('+')) {
    const base = parseSimple(spec.slice(0, -1), item);
    if (base.kind === 'combo') {
      throw new RangeSyntaxError(`"+" cannot be applied to an explicit combo: ${JSON.stringify(item)}`);
    }
    const out: ComboIndex[] = [];
    if (base.kind === 'pair') {
      for (let r = 12; r >= base.hiRank; r--) pushClass(out, handClassFromRanks(r, r, true));
      return out;
    }
    // 커넥터 '+' 는 거부한다 (P0.md 3.5, R1). "T9s+" 는 도구마다 뜻이 다르다:
    // PokerStove/Equilab 계열은 커넥터 런(T9s,JTs,QJs,KQs), 아래의 키커 규칙으로는 T9s 하나(no-op).
    // 조용히 한쪽을 고르면 다른 쪽 사용자에게는 틀린 레인지가 되므로 명시적 나열을 요구한다.
    // AKs+ / AKo+ / AK+ 도 예외 없이 거부한다.
    if (base.loRank === base.hiRank - 1) {
      const hi = RANKS[base.hiRank] as string;
      const lo = RANKS[base.loRank] as string;
      const sfx = base.sfx ?? '';
      const single = `${hi}${lo}${sfx}`;
      // hi 가 A 면 커넥터 런의 시작과 끝이 같아서 "AKs,...,AKs" 라는 무의미한 예시가 된다
      // (P0 R2 MINOR 2). 그 경우 런 예시를 생략한다.
      const hint =
        base.hiRank === 12
          ? `list the class explicitly as "${single}"`
          : `list hands explicitly (e.g. "${single},...,AK${sfx}" for a connector run, ` +
            `or just "${single}" for the single class)`;
      throw new RangeSyntaxError(`connector "+" is ambiguous across tools: ${JSON.stringify(item)}. ${hint}`);
    }
    // "A2s+" = A2s..AKs : 키커를 하이카드 바로 아래까지 올린다.
    for (let k = base.hiRank - 1; k >= base.loRank; k--) {
      for (const h of classesOfNonPair(base.hiRank, k, base.sfx)) pushClass(out, h);
    }
    return out;
  }

  const simple = parseSimple(spec, item);
  if (simple.kind === 'combo') return [simple.combo];
  const out: ComboIndex[] = [];
  if (simple.kind === 'pair') {
    pushClass(out, handClassFromRanks(simple.hiRank, simple.hiRank, true));
    return out;
  }
  for (const h of classesOfNonPair(simple.hiRank, simple.loRank, simple.sfx)) pushClass(out, h);
  return out;
}

export function parseRange(text: string): Range {
  if (typeof text !== 'string') throw new RangeSyntaxError('parseRange expects a string');
  const r = emptyRange();
  const trimmed = text.trim();
  // 빈 텍스트 = 빈 레인지. formatRange(emptyRange()) === "" 와의 왕복을 위해 허용한다.
  // (",", ",," 같은 빈 item 은 아래에서 여전히 에러다.)
  if (trimmed.length === 0) return r;

  const parts = trimmed.split(',');
  for (const raw of parts) {
    const item = raw.trim();
    if (item.length === 0) throw new RangeSyntaxError(`empty item in range ${JSON.stringify(text)}`);
    if (/\s/.test(item)) throw new RangeSyntaxError(`whitespace inside item ${JSON.stringify(item)}`);

    const colon = item.indexOf(':');
    let spec = item;
    let weight = 1;
    if (colon >= 0) {
      if (item.indexOf(':', colon + 1) >= 0) {
        throw new RangeSyntaxError(`only one ":" allowed per item: ${JSON.stringify(item)}`);
      }
      spec = item.slice(0, colon);
      weight = parseWeight(item.slice(colon + 1), item);
    }
    if (spec.length === 0) throw new RangeSyntaxError(`missing spec before ":" in ${JSON.stringify(item)}`);

    const combos = expandSpec(spec, item);
    if (combos.length === 0) throw new RangeSyntaxError(`item matched no combos: ${JSON.stringify(item)}`);
    // 마지막 item 이 이긴다: 덮어쓰기
    for (let i = 0; i < combos.length; i++) r[combos[i] as ComboIndex] = weight;
  }
  return r;
}
