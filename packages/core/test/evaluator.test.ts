import { describe, expect, it } from 'vitest';
import {
  CardSyntaxError,
  HandCategory,
  evaluate5,
  evaluate7,
  handCategory,
  parseCard,
  parseCards,
} from '../src/index.js';

const ev5 = (s: string): number => evaluate5(parseCards(s));
const ev7 = (s: string): number => evaluate7(parseCards(s));
const cat = (s: string): HandCategory => handCategory(ev5(s));

describe('4.4 evaluator', () => {
  it('4.4 카테고리 예제 10개', () => {
    expect(cat('AsKsQsJsTs')).toBe(HandCategory.StraightFlush); // 로열
    expect(cat('As2s3s4s5s')).toBe(HandCategory.StraightFlush); // 스틸휠
    expect(cat('7c7d7h7s2c')).toBe(HandCategory.Quads);
    expect(cat('9c9d9hKsKd')).toBe(HandCategory.FullHouse);
    expect(cat('Ah9h7h4h2h')).toBe(HandCategory.Flush);
    expect(cat('Ac2d3h4s5c')).toBe(HandCategory.Straight); // 휠
    expect(cat('5c6d7h8s9c')).toBe(HandCategory.Straight);
    expect(cat('QcQdQh3s2c')).toBe(HandCategory.Trips);
    expect(cat('JcJd4h4sKc')).toBe(HandCategory.TwoPair);
    expect(cat('8c8dKhQs2c')).toBe(HandCategory.Pair);
    expect(cat('Ac9d7h5s3c')).toBe(HandCategory.HighCard);
  });

  it('4.4 휠(A2345)은 5-high 스트레이트: 6-high 보다 약하다', () => {
    expect(ev5('Ac2d3h4s5c')).toBeLessThan(ev5('2c3d4h5s6c'));
  });

  it('4.4 스틸휠 < 6-high 스트레이트플러시', () => {
    expect(ev5('As2s3s4s5s')).toBeLessThan(ev5('2s3s4s5s6s'));
  });

  it('4.4 AAAKK > KKKAA', () => {
    expect(ev5('AcAdAhKcKd')).toBeGreaterThan(ev5('KcKdKhAcAd'));
    expect(handCategory(ev5('AcAdAhKcKd'))).toBe(HandCategory.FullHouse);
  });

  it('4.4 AAKK2 > AAQQK', () => {
    expect(ev5('AcAdKcKd2h')).toBeGreaterThan(ev5('AcAdQcQdKh'));
  });

  it('4.4 플러시 킥커 비교: AKQJ9s > AKQJ8s', () => {
    expect(ev5('AsKsQsJs9s')).toBeGreaterThan(ev5('AsKsQsJs8s'));
  });

  it('4.4 7장에서 베스트 5 선택', () => {
    // 세 페어 -> 상위 두 페어 + 최고 킥커 (AAKK + Q), 세 번째 페어(77)는 버려진다
    const three = ev7('AcAdKcKd7c7dQh');
    expect(handCategory(three)).toBe(HandCategory.TwoPair);
    expect(three).toBe(ev5('AcAdKcKdQh'));

    // 7장 플러시: 상위 5장만
    const flush = ev7('AhKhQhJh9h2h3c');
    expect(handCategory(flush)).toBe(HandCategory.Flush);
    expect(flush).toBe(ev5('AhKhQhJh9h'));

    // 두 개의 트립스 -> 풀하우스 AAAKK
    const boat = ev7('AcAdAhKcKdKh2c');
    expect(handCategory(boat)).toBe(HandCategory.FullHouse);
    expect(boat).toBe(ev5('AcAdAhKcKd'));

    // 7장 스트레이트 (휠 포함) - 더 높은 스트레이트를 고른다
    const st = ev7('Ac2d3h4s5c6d9h');
    expect(handCategory(st)).toBe(HandCategory.Straight);
    expect(st).toBe(ev5('2d3h4s5c6d'));
  });

  it('4.4 동일 값 → 동일 HandValue (tie)', () => {
    expect(ev7('AhKhQhJhTh2c3d')).toBe(ev7('AsKsQsJsTs2c3d'));
    expect(ev5('AhKhQhJh9h')).toBe(ev5('AsKsQsJs9s'));
  });

  it('4.4 카테고리 순서가 포커 랭킹과 일치한다', () => {
    const ordered = [
      'Ac9d7h5s3c', // high card
      '8c8dKhQs2c', // pair
      'JcJd4h4sKc', // two pair
      'QcQdQh3s2c', // trips
      '5c6d7h8s9c', // straight
      'Ah9h7h4h2h', // flush
      '9c9d9hKsKd', // full house
      '7c7d7h7s2c', // quads
      'As2s3s4s5s', // straight flush
    ];
    for (let i = 1; i < ordered.length; i++) {
      expect(ev5(ordered[i] as string), ordered[i]).toBeGreaterThan(ev5(ordered[i - 1] as string));
      expect(handCategory(ev5(ordered[i] as string))).toBe(i);
    }
  });

  it('4.4 잘못된 장수는 throw', () => {
    expect(() => evaluate5(parseCards('AsKsQsJs'))).toThrow();
    expect(() => evaluate5(parseCards('AsKsQsJsTs9s'))).toThrow();
    expect(() => evaluate7(parseCards('AsKsQs'))).toThrow();
    expect(() => evaluate7(parseCards('AsKsQsJsTs9s8s7s'))).toThrow();
  });

  it('4.4 중복 카드 / 범위 밖 카드는 CardSyntaxError (R1)', () => {
    // 검사가 없으면 evaluate5(As,As,Ks,Qs,Js) 가 조용히 Pair 를 돌려준다 (P0 R1 MINOR 1).
    const as = parseCard('As');
    expect(() => evaluate5([as, as, parseCard('Ks'), parseCard('Qs'), parseCard('Js')])).toThrow(
      CardSyntaxError,
    );
    // 카드 id 31/32 경계 (내부 중복 마스크가 두 32비트로 쪼개지는 지점)
    const c31 = 31;
    const c32 = 32;
    expect(() => evaluate5([c31, c31, 0, 1, 2])).toThrow(CardSyntaxError);
    expect(() => evaluate5([c32, c32, 0, 1, 2])).toThrow(CardSyntaxError);
    expect(() => evaluate5([c31, c32, 0, 1, 2])).not.toThrow();
    expect(() => evaluate7([0, 1, 2, 3, 4, 5, 5])).toThrow(CardSyntaxError);
    expect(() => evaluate5([0, 1, 2, 3, 52])).toThrow(CardSyntaxError);
    expect(() => evaluate5([0, 1, 2, 3, -1])).toThrow(CardSyntaxError);
    // 중복이 없으면 그대로 통과한다
    expect(() => evaluate7(parseCards('AsKsQsJsTs9s8s'))).not.toThrow();
  });

  it('4.4 5장 전수 분포 (2,598,960 핸드)', () => {
    const counts = new Array<number>(9).fill(0);
    const hand = [0, 0, 0, 0, 0];
    let n = 0;
    for (let a = 0; a < 52; a++) {
      hand[0] = a;
      for (let b = a + 1; b < 52; b++) {
        hand[1] = b;
        for (let c = b + 1; c < 52; c++) {
          hand[2] = c;
          for (let d = c + 1; d < 52; d++) {
            hand[3] = d;
            for (let e = d + 1; e < 52; e++) {
              hand[4] = e;
              const k = handCategory(evaluate5(hand));
              counts[k] = (counts[k] as number) + 1;
              n++;
            }
          }
        }
      }
    }
    expect(n).toBe(2598960);
    expect(counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
  });
});
