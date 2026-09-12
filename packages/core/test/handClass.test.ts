import { describe, expect, it } from 'vitest';
import {
  COMBO_COUNT,
  HAND_CLASS_COUNT,
  HandClassKind,
  comboCards,
  cardRank,
  cardSuit,
  handClassCombos,
  handClassKind,
  handClassName,
  handClassOf,
  parseHandClass,
} from '../src/index.js';

describe('4.1 handClass (169, 표시 전용)', () => {
  it('4.1 1326 콤보를 169 클래스에 분배하면 페어 6 / 수티드 4 / 오프수트 12, 합 1326', () => {
    const counts = new Array<number>(HAND_CLASS_COUNT).fill(0);
    for (let i = 0; i < COMBO_COUNT; i++) counts[handClassOf(i)] = (counts[handClassOf(i)] as number) + 1;

    let pairs = 0;
    let suited = 0;
    let offsuit = 0;
    let total = 0;
    for (let h = 0; h < HAND_CLASS_COUNT; h++) {
      const c = counts[h] as number;
      total += c;
      switch (handClassKind(h)) {
        case HandClassKind.Pair:
          expect(c, handClassName(h)).toBe(6);
          pairs++;
          break;
        case HandClassKind.Suited:
          expect(c, handClassName(h)).toBe(4);
          suited++;
          break;
        case HandClassKind.Offsuit:
          expect(c, handClassName(h)).toBe(12);
          offsuit++;
          break;
      }
    }
    expect(pairs).toBe(13);
    expect(suited).toBe(78);
    expect(offsuit).toBe(78);
    // 13*6 + 78*4 + 78*12 = 78 + 312 + 936 = 1326
    expect(13 * 6 + 78 * 4 + 78 * 12).toBe(1326);
    expect(total).toBe(COMBO_COUNT);
  });

  it('4.1 격자 배치 고정값: 0=AA, 1=AKs, 13=AKo, 168=22, 12=A2s, 156=A2o', () => {
    expect(handClassName(0)).toBe('AA');
    expect(handClassName(1)).toBe('AKs');
    expect(handClassName(13)).toBe('AKo');
    expect(handClassName(168)).toBe('22');
    expect(handClassName(12)).toBe('A2s');
    expect(handClassName(156)).toBe('A2o');
    expect(handClassName(14)).toBe('KK');
  });

  it('4.1 169개 이름 전부 parseHandClass 왕복', () => {
    const names = new Set<string>();
    for (let h = 0; h < HAND_CLASS_COUNT; h++) {
      const name = handClassName(h);
      expect(names.has(name), name).toBe(false);
      names.add(name);
      expect(parseHandClass(name)).toBe(h);
    }
    expect(names.size).toBe(169);
  });

  it('4.1 handClassCombos 와 handClassOf 가 서로 역이다', () => {
    let total = 0;
    for (let h = 0; h < HAND_CLASS_COUNT; h++) {
      const combos = handClassCombos(h);
      total += combos.length;
      for (const c of combos) {
        expect(handClassOf(c)).toBe(h);
        // 이름과 실제 카드가 일치하는지 독립적으로 확인
        const [hi, lo] = comboCards(c);
        const ranks = [cardRank(hi), cardRank(lo)].sort((a, b) => b - a);
        const name = handClassName(h);
        const RANKS = '23456789TJQKA';
        expect(name[0]).toBe(RANKS[ranks[0] as number]);
        expect(name[1]).toBe(RANKS[ranks[1] as number]);
        if (name.length === 3) {
          expect(name[2]).toBe(cardSuit(hi) === cardSuit(lo) ? 's' : 'o');
        } else {
          expect(ranks[0]).toBe(ranks[1]);
        }
      }
      // 방어적 복사본이어야 한다
      combos.length = 0;
      expect(handClassCombos(h).length).toBeGreaterThan(0);
    }
    expect(total).toBe(COMBO_COUNT);
  });

  it('4.1 parseHandClass 잘못된 입력 throw', () => {
    for (const bad of ['', 'A', 'AKx', 'AAs', 'KAs', 'aa', 'AKso', '10s', 'A2', 'T9']) {
      expect(() => parseHandClass(bad), bad).toThrow();
    }
  });
});
