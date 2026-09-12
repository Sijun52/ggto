import { describe, expect, it } from 'vitest';
import {
  CARD_COUNT,
  CardSyntaxError,
  RANKS,
  SUITS,
  cardRank,
  cardSuit,
  formatCard,
  formatCards,
  makeCard,
  parseCard,
  parseCards,
} from '../src/index.js';

describe('4.1 card', () => {
  it('4.1 parseCard/formatCard 52장 왕복', () => {
    const seen = new Set<string>();
    for (let c = 0; c < CARD_COUNT; c++) {
      const s = formatCard(c);
      expect(s).toHaveLength(2);
      expect(seen.has(s)).toBe(false);
      seen.add(s);
      expect(parseCard(s)).toBe(c);
    }
    expect(seen.size).toBe(52);
  });

  it('4.1 고정 인코딩: "As"=51, "2c"=0, "Td"=33', () => {
    expect(parseCard('As')).toBe(51);
    expect(parseCard('2c')).toBe(0);
    expect(parseCard('Td')).toBe(33);
    expect(formatCard(51)).toBe('As');
    expect(formatCard(0)).toBe('2c');
    expect(formatCard(33)).toBe('Td');
  });

  it('4.1 rank = card >> 2, suit = card & 3', () => {
    for (let r = 0; r < 13; r++) {
      for (let s = 0; s < 4; s++) {
        const c = makeCard(r, s);
        expect(c).toBe(r * 4 + s);
        expect(cardRank(c)).toBe(r);
        expect(cardSuit(c)).toBe(s);
        expect(formatCard(c)).toBe((RANKS[r] as string) + (SUITS[s] as string));
      }
    }
  });

  it('4.1 parseCard 는 잘못된 입력에 throw', () => {
    for (const bad of ['', 'A', 'Ass', 'as', 'AS', '1s', 'Ax', '10s', 'Sa', ' As']) {
      expect(() => parseCard(bad), bad).toThrow(CardSyntaxError);
    }
  });

  it('4.1 parseCards 붙여 쓴 형태 / 중복 카드 throw', () => {
    expect(parseCards('KsQh2d')).toEqual([parseCard('Ks'), parseCard('Qh'), parseCard('2d')]);
    expect(formatCards(parseCards('KsQh2d'))).toBe('KsQh2d');
    expect(parseCards('')).toEqual([]);
    expect(() => parseCards('AsAs')).toThrow(CardSyntaxError);
    expect(() => parseCards('AsK')).toThrow(CardSyntaxError);
  });

  it('4.1 makeCard 범위 검증', () => {
    expect(() => makeCard(-1, 0)).toThrow(CardSyntaxError);
    expect(() => makeCard(13, 0)).toThrow(CardSyntaxError);
    expect(() => makeCard(0, 4)).toThrow(CardSyntaxError);
  });
});
