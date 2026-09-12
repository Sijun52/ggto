import { describe, expect, it } from 'vitest';
import {
  COMBO_COUNT,
  UnsupportedError,
  comboIndex,
  equityHandVsHand,
  equityRangeVsRange,
  fullRange,
  parseCards,
  parseRange,
  type Card,
} from '../src/index.js';
// 테이블은 공개 API 가 아니다 (P0 R1 MINOR 5). 내부 진입점에서 가져온다.
import { COMBO_HI_TABLE, COMBO_LO_TABLE } from '../src/internal.js';

const hand = (s: string): [Card, Card] => parseCards(s) as [Card, Card];

describe('4.5 equity — hand vs hand (전수)', () => {
  it('4.5 AsAh vs KsKd preflop = 0.81946', () => {
    const r = equityHandVsHand(hand('AsAh'), hand('KsKd'), []);
    expect(r.win + r.tie + r.lose).toBe(1712304); // C(48,5)
    expect(r.equity).toBeCloseTo(0.81946, 4);
  });

  it('4.5 AsAh vs KsKh preflop = 0.82637', () => {
    expect(equityHandVsHand(hand('AsAh'), hand('KsKh'), []).equity).toBeCloseTo(0.82637, 4);
  });

  it('4.5 AsKs vs 2c2d preflop = 0.50084', () => {
    expect(equityHandVsHand(hand('AsKs'), hand('2c2d'), []).equity).toBeCloseTo(0.50084, 4);
  });

  it('4.5 AsKh vs QcQd preflop = 0.42835', () => {
    expect(equityHandVsHand(hand('AsKh'), hand('QcQd'), []).equity).toBeCloseTo(0.42835, 4);
  });

  it('4.5 AhKh vs 2c2d on QhJh2s = 335/990, win=335 tie=0', () => {
    const r = equityHandVsHand(hand('AhKh'), hand('2c2d'), parseCards('QhJh2s'));
    expect(r.win).toBe(335);
    expect(r.tie).toBe(0);
    expect(r.win + r.tie + r.lose).toBe(990);
    expect(r.equity).toBe(335 / 990);
  });

  it('4.5 AsAd vs KsKd on Kh7c2d = 85/990, win=85', () => {
    const r = equityHandVsHand(hand('AsAd'), hand('KsKd'), parseCards('Kh7c2d'));
    expect(r.win).toBe(85);
    expect(r.win + r.tie + r.lose).toBe(990);
    expect(r.equity).toBeCloseTo(0.08586, 5);
  });

  it('4.5 AsKs vs QhQd on JsTs2c = 555/990', () => {
    const r = equityHandVsHand(hand('AsKs'), hand('QhQd'), parseCards('JsTs2c'));
    expect(r.win + r.tie + r.lose).toBe(990);
    expect(r.equity).toBeCloseTo(555 / 990, 6);
  });

  it('4.5 AsKs vs QhQd on JsTs2c9d = 13/44', () => {
    const r = equityHandVsHand(hand('AsKs'), hand('QhQd'), parseCards('JsTs2c9d'));
    expect(r.win + r.tie + r.lose).toBe(44);
    expect(r.equity).toBeCloseTo(13 / 44, 6);
  });

  it('4.5 5s4s vs AhAd on 3c2d7h = 236/990', () => {
    const r = equityHandVsHand(hand('5s4s'), hand('AhAd'), parseCards('3c2d7h'));
    expect(r.win + r.tie + r.lose).toBe(990);
    expect(r.equity).toBeCloseTo(236 / 990, 6);
  });

  it('4.5 리버(보드 5장)는 런아웃 1개', () => {
    const r = equityHandVsHand(hand('AsKs'), hand('QhQd'), parseCards('JsTs2c9d3h'));
    expect(r.win + r.tie + r.lose).toBe(1);
  });

  it('4.5 hero/villain 을 뒤집으면 win/lose 가 교환된다', () => {
    const a = equityHandVsHand(hand('AhKh'), hand('2c2d'), parseCards('QhJh2s'));
    const b = equityHandVsHand(hand('2c2d'), hand('AhKh'), parseCards('QhJh2s'));
    expect(b.win).toBe(a.lose);
    expect(b.lose).toBe(a.win);
    expect(b.tie).toBe(a.tie);
    expect(a.equity + b.equity).toBeCloseTo(1, 12);
  });

  it('4.5 중복 카드는 throw', () => {
    expect(() => equityHandVsHand(hand('AsKs'), hand('AsQs'), [])).toThrow();
    expect(() => equityHandVsHand(hand('AsKs'), hand('QhQd'), parseCards('As2c3d'))).toThrow();
  });

  it('4.5 hand-vs-hand 프리플랍 전수 1건 < 5초', () => {
    const t0 = performance.now();
    equityHandVsHand(hand('AsAh'), hand('KsKd'), []);
    const ms = performance.now() - t0;
    expect(ms, `${ms.toFixed(0)}ms`).toBeLessThan(5000);
  });
});

describe('4.5 equity — range vs range', () => {
  const MC = { mode: 'monte-carlo', samples: 200_000, seed: 20260911 } as const;

  it('4.5 AA vs KK mc 200k = 0.81946', () => {
    expect(equityRangeVsRange(parseRange('AA'), parseRange('KK'), [], MC).hero).toBeCloseTo(0.81946, 2);
  });

  it('4.5 AKs vs 22 mc 200k = 0.49893', () => {
    expect(equityRangeVsRange(parseRange('AKs'), parseRange('22'), [], MC).hero).toBeCloseTo(0.49893, 2);
  });

  it('4.5 AKo vs 22 mc 200k = 0.47351', () => {
    expect(equityRangeVsRange(parseRange('AKo'), parseRange('22'), [], MC).hero).toBeCloseTo(0.47351, 2);
  });

  it('4.5 AKo vs QQ mc 200k = 0.43242', () => {
    expect(equityRangeVsRange(parseRange('AKo'), parseRange('QQ'), [], MC).hero).toBeCloseTo(0.43242, 2);
  });

  it('4.5 AKs vs QQ mc 200k = 0.46049', () => {
    expect(equityRangeVsRange(parseRange('AKs'), parseRange('QQ'), [], MC).hero).toBeCloseTo(0.46049, 2);
  });

  it('4.5 72o vs AA mc 200k = 0.11800', () => {
    expect(equityRangeVsRange(parseRange('72o'), parseRange('AA'), [], MC).hero).toBeCloseTo(0.118, 2);
  });

  it('4.5 JTs vs AA mc 200k = 0.21160', () => {
    expect(equityRangeVsRange(parseRange('JTs'), parseRange('AA'), [], MC).hero).toBeCloseTo(0.2116, 2);
  });

  it('4.5 AA vs AKs mc 200k = 0.87859, tie 1.26%', () => {
    const r = equityRangeVsRange(parseRange('AA'), parseRange('AKs'), [], MC);
    expect(r.hero).toBeCloseTo(0.87859, 2);
    expect(r.tie).toBeCloseTo(0.01256, 2);
    expect(r.matchups).toBe(12);
  });

  it('4.5 프리플랍 range-vs-range exact 는 UnsupportedError', () => {
    expect(() => equityRangeVsRange(parseRange('AA'), parseRange('KK'), [], { mode: 'exact' })).toThrow(
      UnsupportedError,
    );
  });

  it('4.5 보드 1~2장 exact 도 UnsupportedError (전수 비용이 프리플랍과 같은 자릿수)', () => {
    expect(() =>
      equityRangeVsRange(parseRange('AA'), parseRange('KK'), parseCards('Kh'), { mode: 'exact' }),
    ).toThrow(UnsupportedError);
    expect(() =>
      equityRangeVsRange(parseRange('AA'), parseRange('KK'), parseCards('Kh7c'), { mode: 'exact' }),
    ).toThrow(UnsupportedError);
    // 같은 상황도 monte-carlo 로는 계산된다
    const r = equityRangeVsRange(parseRange('AA'), parseRange('KK'), parseCards('Kh'), {
      mode: 'monte-carlo',
      samples: 20_000,
      seed: 1,
    });
    expect(r.hero).toBeGreaterThan(0);
    expect(r.hero).toBeLessThan(1);
  });

  it('4.5 exact 단일 콤보: AhKh vs 2c2d on QhJh2s → hero 0.33838, heroPerCombo[AhKh] 동일', () => {
    const r = equityRangeVsRange(parseRange('AhKh'), parseRange('2c2d'), parseCards('QhJh2s'), {
      mode: 'exact',
    });
    const ahkh = comboIndex(...(parseCards('AhKh') as [number, number]));
    const c2c2d = comboIndex(...(parseCards('2c2d') as [number, number]));
    expect(r.matchups).toBe(1);
    expect(r.hero).toBeCloseTo(335 / 990, 9);
    expect(r.heroPerCombo[ahkh]).toBeCloseTo(335 / 990, 6);
    expect(r.villainPerCombo[c2c2d]).toBeCloseTo(655 / 990, 6);
    expect(r.hero + r.villain).toBeCloseTo(1, 9);
    // 레인지 밖 콤보는 NaN
    expect(Number.isNaN(r.heroPerCombo[0] as number)).toBe(true);
  });

  it('4.5 exact AA vs KK on Kh7c2d 집계값 = hand-vs-hand 가중 평균 (1e-6)', () => {
    const board = parseCards('Kh7c2d');
    const heroR = parseRange('AA');
    const vilR = parseRange('KK');
    const r = equityRangeVsRange(heroR, vilR, board, { mode: 'exact' });

    // 테스트 안에서 독립적으로 계산: 유효 쌍마다 전수 hand-vs-hand
    let num = 0;
    let den = 0;
    let pairs = 0;
    for (let i = 0; i < COMBO_COUNT; i++) {
      const hw = heroR[i] as number;
      if (hw <= 0) continue;
      const ih = COMBO_HI_TABLE[i] as number;
      const il = COMBO_LO_TABLE[i] as number;
      if (board.includes(ih) || board.includes(il)) continue;
      for (let j = 0; j < COMBO_COUNT; j++) {
        const vw = vilR[j] as number;
        if (vw <= 0) continue;
        const jh = COMBO_HI_TABLE[j] as number;
        const jl = COMBO_LO_TABLE[j] as number;
        if (board.includes(jh) || board.includes(jl)) continue;
        if (ih === jh || ih === jl || il === jh || il === jl) continue;
        const e = equityHandVsHand([ih, il], [jh, jl], board);
        num += hw * vw * e.equity;
        den += hw * vw;
        pairs++;
      }
    }
    expect(r.matchups).toBe(pairs);
    expect(r.hero).toBeCloseTo(num / den, 6);
  });

  it('4.5 대칭성: heroWin + villainWin + tie = 1, (B,A) 로 뒤집으면 교환', () => {
    const board = parseCards('Kh7c2d');
    const a = parseRange('22+,AJs+,KQs,AQo+');
    const b = parseRange('88+,ATs+,KJs+,AJo+');
    const ab = equityRangeVsRange(a, b, board, { mode: 'exact' });
    const ba = equityRangeVsRange(b, a, board, { mode: 'exact' });

    expect(ab.heroWin + ab.villainWin + ab.tie).toBeCloseTo(1, 6);
    expect(ab.hero + ab.villain).toBeCloseTo(1, 6);
    expect(ba.hero).toBeCloseTo(ab.villain, 6);
    expect(ba.villain).toBeCloseTo(ab.hero, 6);
    expect(ba.tie).toBeCloseTo(ab.tie, 6);
    expect(ba.matchups).toBe(ab.matchups);
  });

  it('4.5 monte-carlo 는 같은 seed 에 같은 결과', () => {
    const o = { mode: 'monte-carlo', samples: 20_000, seed: 7 } as const;
    const a = equityRangeVsRange(parseRange('AA'), parseRange('KK'), [], o);
    const b = equityRangeVsRange(parseRange('AA'), parseRange('KK'), [], o);
    expect(a.hero).toBe(b.hero);
    const c = equityRangeVsRange(parseRange('AA'), parseRange('KK'), [], {
      mode: 'monte-carlo',
      samples: 20_000,
      seed: 8,
    });
    expect(c.hero).not.toBe(a.hero);
  });

  it('4.5 monte-carlo 가 exact 와 일치한다 (플랍, 오차 0.005)', () => {
    const board = parseCards('Kh7c2d');
    const a = parseRange('22+,AJs+,KQs,AQo+');
    const b = parseRange('88+,ATs+,KJs+,AJo+');
    const ex = equityRangeVsRange(a, b, board, { mode: 'exact' });
    const mc = equityRangeVsRange(a, b, board, { mode: 'monte-carlo', samples: 200_000, seed: 3 });
    expect(mc.hero).toBeCloseTo(ex.hero, 2);
  });

  it('4.5 exact 플랍 fullRange vs fullRange < 5초', () => {
    const t0 = performance.now();
    const r = equityRangeVsRange(fullRange(), fullRange(), parseCards('Ks7h2d'), { mode: 'exact' });
    const ms = performance.now() - t0;
    // 완전 대칭이므로 히어로 에퀴티는 정확히 0.5 여야 한다
    expect(r.hero).toBeCloseTo(0.5, 9);
    // C(49,2) 히어로 콤보 x C(47,2) 충돌 없는 빌런 콤보
    expect(r.matchups).toBe(1176 * 1081);
    expect(ms, `${ms.toFixed(0)}ms`).toBeLessThan(5000);
  });
});
