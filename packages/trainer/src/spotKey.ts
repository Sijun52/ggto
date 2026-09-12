/**
 * 스팟 키 `pf:<content_hash>:<seq>:<combo>` (P3.md 3.1, DECISIONS D17).
 *
 * 이 문자열이 `attempt.spot_key`·`srs_state.spot_key`·API 필드다. 인포셋을 문자열로
 * 식별하는 D9 의 연장이고, 차트 참조는 **영구 식별자인 content_hash** 로만 한다
 * (`chart_set.id` 는 `npm run seed` 마다 달라질 수 있는 API 핸들이다 — P2 4.3).
 *
 * `seq` 에는 `-` `/` `.` 만 나오고 `:` 는 문법상 불가능하므로 `:` 로 4조각 분해가 안전하다
 * (core 의 액션 문법: F/X/C/A/B<amt>/R<amt>).
 */

import { comboCards, comboIndex, formatCard, parseActionSequence, parseCard, type ComboIndex } from '@ggto/core';
import { SpotKeyError } from './types.js';

export const SPOT_KEY_PREFIX = 'pf';
/** P6 포스트플랍용으로 예약. 지금 받으면 거부한다 (조용히 프리플랍으로 읽지 않는다). */
export const POSTFLOP_KEY_PREFIX = 'ps';

const HASH_RE = /^[0-9a-f]{64}$/;

/** 콤보 인덱스 → 1326 키 규약 (P2 5.1): formatCard(hi) + formatCard(lo) */
export function formatCombo(combo: ComboIndex): string {
  const [hi, lo] = comboCards(combo);
  return formatCard(hi) + formatCard(lo);
}

/** 1326 키 → 콤보 인덱스. 비정규(`KhAs`: lo 가 앞) 는 거부한다 — 키가 둘이 되면 안 된다. */
export function parseCombo(key: string): ComboIndex {
  if (key.length !== 4) throw new SpotKeyError(`combo key must be 4 characters, got ${JSON.stringify(key)}`);
  let combo: ComboIndex;
  try {
    combo = comboIndex(parseCard(key.slice(0, 2)), parseCard(key.slice(2, 4)));
  } catch (e) {
    throw new SpotKeyError(`bad combo key ${JSON.stringify(key)}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const canonical = formatCombo(combo);
  if (canonical !== key) {
    throw new SpotKeyError(
      `combo key ${JSON.stringify(key)} is not canonical (high card first): expected ${JSON.stringify(canonical)}`,
    );
  }
  return combo;
}

export interface ParsedSpotKey {
  contentHash: string;
  seq: string;
  combo: ComboIndex;
}

export function formatSpotKey(contentHash: string, seq: string, combo: ComboIndex): string {
  if (!HASH_RE.test(contentHash)) {
    throw new SpotKeyError(`content hash must be 64 lowercase hex characters: ${JSON.stringify(contentHash)}`);
  }
  return `${SPOT_KEY_PREFIX}:${contentHash}:${seq}:${formatCombo(combo)}`;
}

export function parseSpotKey(key: string): ParsedSpotKey {
  const parts = key.split(':');
  if (parts.length !== 4) {
    throw new SpotKeyError(`spot key must have 4 colon-separated parts, got ${String(parts.length)}: ${JSON.stringify(key)}`);
  }
  const [prefix, hash, seq, combo] = parts as [string, string, string, string];
  if (prefix === POSTFLOP_KEY_PREFIX) {
    throw new SpotKeyError(`postflop spot keys ("${POSTFLOP_KEY_PREFIX}:") are reserved for P6 and not accepted yet`);
  }
  if (prefix !== SPOT_KEY_PREFIX) {
    throw new SpotKeyError(`spot key must start with "${SPOT_KEY_PREFIX}:", got ${JSON.stringify(prefix)}`);
  }
  if (!HASH_RE.test(hash)) {
    throw new SpotKeyError(`content hash must be 64 lowercase hex characters: ${JSON.stringify(hash)}`);
  }
  if (seq !== '') {
    try {
      parseActionSequence(seq);
    } catch (e) {
      throw new SpotKeyError(`bad action sequence ${JSON.stringify(seq)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { contentHash: hash, seq, combo: parseCombo(combo) };
}
