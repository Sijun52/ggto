/**
 * 카드 표현. P0.md 3.1.
 *
 * card = rank*4 + suit, rank 0=2 … 12=A, suit 0=c 1=d 2=h 3=s.
 * 이 인코딩은 `card >> 2` / `card & 3` 로 분해되도록 고정되어 있으며,
 * 슈트가 하위 비트라서 "같은 랭크 4장"이 연속 id가 된다 (콤보/동형 코드가 이걸 가정한다).
 */

export type Card = number;

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';
export const RANK_COUNT = 13;
export const SUIT_COUNT = 4;
export const CARD_COUNT = 52;

export class CardSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardSyntaxError';
  }
}

export function cardRank(c: Card): number {
  return c >> 2;
}

export function cardSuit(c: Card): number {
  return c & 3;
}

export function makeCard(rank: number, suit: number): Card {
  if (!Number.isInteger(rank) || rank < 0 || rank >= RANK_COUNT) {
    throw new CardSyntaxError(`rank out of range: ${String(rank)}`);
  }
  if (!Number.isInteger(suit) || suit < 0 || suit >= SUIT_COUNT) {
    throw new CardSyntaxError(`suit out of range: ${String(suit)}`);
  }
  return rank * 4 + suit;
}

export function isCard(c: unknown): c is Card {
  return typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < CARD_COUNT;
}

export function assertCard(c: number, what = 'card'): Card {
  if (!isCard(c)) throw new CardSyntaxError(`${what} out of range 0..51: ${String(c)}`);
  return c;
}

/** 랭크 문자 → 0..12. 'T' 만 10이다 ('10' 은 두 글자라 여기서 자동으로 거부된다). */
export function rankFromChar(ch: string): number {
  const r = RANKS.indexOf(ch);
  if (r < 0 || ch.length !== 1) throw new CardSyntaxError(`bad rank char: ${JSON.stringify(ch)}`);
  return r;
}

export function suitFromChar(ch: string): number {
  const s = SUITS.indexOf(ch);
  if (s < 0 || ch.length !== 1) throw new CardSyntaxError(`bad suit char: ${JSON.stringify(ch)}`);
  return s;
}

export function parseCard(s: string): Card {
  if (typeof s !== 'string' || s.length !== 2) {
    throw new CardSyntaxError(`card must be exactly 2 chars: ${JSON.stringify(s)}`);
  }
  const r = RANKS.indexOf(s[0] as string);
  const u = SUITS.indexOf(s[1] as string);
  if (r < 0) throw new CardSyntaxError(`bad rank in ${JSON.stringify(s)} (rank must be one of ${RANKS})`);
  if (u < 0) throw new CardSyntaxError(`bad suit in ${JSON.stringify(s)} (suit must be one of ${SUITS})`);
  return r * 4 + u;
}

export function formatCard(c: Card): string {
  assertCard(c);
  return (RANKS[c >> 2] as string) + (SUITS[c & 3] as string);
}

/** `"KsQh2d"` 처럼 붙여 쓴 카드열. 중복 카드는 throw. */
export function parseCards(s: string): Card[] {
  if (typeof s !== 'string') throw new CardSyntaxError('parseCards expects a string');
  if (s.length === 0) return [];
  if (s.length % 2 !== 0) throw new CardSyntaxError(`card list length must be even: ${JSON.stringify(s)}`);
  const out: Card[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < s.length; i += 2) {
    const c = parseCard(s.slice(i, i + 2));
    if (seen.has(c)) throw new CardSyntaxError(`duplicate card ${formatCard(c)} in ${JSON.stringify(s)}`);
    seen.add(c);
    out.push(c);
  }
  return out;
}

export function formatCards(cs: readonly Card[]): string {
  let out = '';
  for (const c of cs) out += formatCard(c);
  return out;
}
