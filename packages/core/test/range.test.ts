import { describe, expect, it } from 'vitest';
import {
  COMBO_COUNT,
  EmptyRangeError,
  HAND_CLASS_COUNT,
  HandClassKind,
  RangeSyntaxError,
  comboCount,
  comboIndex,
  createRng,
  emptyRange,
  formatRange,
  fullRange,
  handClassCombos,
  handClassKind,
  handClassName,
  intersect,
  normalize,
  parseCards,
  parseHandClass,
  parseRange,
  rangeFromCombos,
  removeBoard,
  scale,
  toHandClassView,
  totalWeight,
  type Range,
} from '../src/index.js';

function weightsOf(r: Range): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < COMBO_COUNT; i++) if ((r[i] as number) > 0) m.set(String(i), r[i] as number);
  return m;
}

describe('4.2 range 연산', () => {
  it('4.2 removeBoard(parseRange("AA"), "As") → 3 콤보, normalize 후 각 1/3', () => {
    const r = removeBoard(parseRange('AA'), parseCards('As'));
    expect(comboCount(r)).toBe(3);
    const ac = parseCards('Ac')[0] as number;
    const ad = parseCards('Ad')[0] as number;
    const ah = parseCards('Ah')[0] as number;
    for (const [a, b] of [
      [ah, ad],
      [ah, ac],
      [ad, ac],
    ] as const) {
      expect(r[comboIndex(a, b)]).toBe(1);
    }
    const n = normalize(r);
    expect(totalWeight(n)).toBeCloseTo(1, 6);
    expect(n[comboIndex(ah, ad)]).toBeCloseTo(1 / 3, 6);
  });

  it('4.2 removeBoard(fullRange(), 플랍) → comboCount = C(49,2) = 1176', () => {
    const r = removeBoard(fullRange(), parseCards('Ks7h2d'));
    expect(comboCount(r)).toBe((49 * 48) / 2);
    expect(comboCount(r)).toBe(1176);
  });

  it('4.2 normalize(removeBoard(parseRange("AsKs"), ["As"])) → EmptyRangeError', () => {
    const r = removeBoard(parseRange('AsKs'), parseCards('As'));
    expect(comboCount(r)).toBe(0);
    expect(() => normalize(r)).toThrow(EmptyRangeError);
  });

  it('4.2 API 사용 순서: 카드 제거 → 정규화. 결과 합 = 1', () => {
    const board = parseCards('Ks7h2d');
    const opened = parseRange('22+,A2s+,KTo+');
    const afterRemoval = removeBoard(opened, board);
    const normalized = normalize(afterRemoval);
    expect(totalWeight(normalized)).toBeCloseTo(1, 6);
    // 보드 카드를 쥔 콤보는 정규화 이후에도 0이어야 한다 (순서를 뒤집으면 이게 깨진다)
    for (const c of board) {
      for (let other = 0; other < 52; other++) {
        if (other === c) continue;
        expect(normalized[comboIndex(c, other)]).toBe(0);
      }
    }
  });

  it('4.2 toHandClassView(fullRange()) count 가 4.1 분포와 같다', () => {
    const view = toHandClassView(fullRange());
    let total = 0;
    for (let h = 0; h < HAND_CLASS_COUNT; h++) {
      const expected = handClassKind(h) === HandClassKind.Pair ? 6 : handClassKind(h) === HandClassKind.Suited ? 4 : 12;
      expect(view.count[h], handClassName(h)).toBe(expected);
      expect(view.weight[h], handClassName(h)).toBeCloseTo(expected, 5);
      total += view.count[h] as number;
    }
    expect(total).toBe(COMBO_COUNT);
  });

  it('4.2 intersect / scale / rangeFromCombos / 불변성', () => {
    const a = parseRange('AA,KK');
    const b = parseRange('KK:0.5,QQ');
    const x = intersect(a, b);
    expect(comboCount(x)).toBe(6);
    expect(x[handClassCombos(parseHandClass('KK'))[0] as number]).toBeCloseTo(0.5, 6);
    // 입력은 변하지 않는다
    expect(comboCount(a)).toBe(12);
    expect(comboCount(b)).toBe(12);

    const s = scale(a, 0.25);
    expect(totalWeight(s)).toBeCloseTo(3, 6);
    expect(totalWeight(a)).toBeCloseTo(12, 6);

    const fromCombos = rangeFromCombos([
      [0, 1],
      [1325, 0.5],
    ]);
    expect(fromCombos[0]).toBe(1);
    expect(fromCombos[1325]).toBe(0.5);
    expect(comboCount(fromCombos)).toBe(2);
  });
});

describe('4.3 range 파서/포매터', () => {
  it('4.3 전개 콤보 수', () => {
    expect(comboCount(parseRange('22+'))).toBe(78);
    expect(comboCount(parseRange('A2s+'))).toBe(48);
    expect(comboCount(parseRange('KTo+'))).toBe(36);
    expect(comboCount(parseRange('AJs-A9s'))).toBe(12);
    expect(comboCount(parseRange('AA+'))).toBe(6);
    expect(comboCount(parseRange('AhKh'))).toBe(1);
    // 원갭 이상은 정상 키커 런: T8s+ = T8s,T9s = 8 (커넥터가 아니다)
    expect(comboCount(parseRange('T8s+'))).toBe(8);
    // QT+ = QTs(4) + QTo(12) + QJs(4) + QJo(12) = 32
    expect(comboCount(parseRange('QT+'))).toBe(32);
  });

  it('4.3 "QQ:0.5" → 6개 각 0.5', () => {
    const r = parseRange('QQ:0.5');
    expect(comboCount(r)).toBe(6);
    for (const c of handClassCombos(parseHandClass('QQ'))) expect(r[c]).toBeCloseTo(0.5, 6);
    expect(totalWeight(r)).toBeCloseTo(3, 6);
  });

  it('4.3 "TT-66" === "66-TT" → 30 콤보', () => {
    const a = parseRange('TT-66');
    const b = parseRange('66-TT');
    expect(comboCount(a)).toBe(30);
    expect(weightsOf(a)).toEqual(weightsOf(b));
    for (const name of ['66', '77', '88', '99', 'TT']) {
      for (const c of handClassCombos(parseHandClass(name))) expect(a[c], name).toBe(1);
    }
    for (const name of ['55', 'JJ']) {
      for (const c of handClassCombos(parseHandClass(name))) expect(a[c], name).toBe(0);
    }
  });

  it('4.3 같은 콤보가 여러 item 에 걸리면 마지막 item 이 이긴다', () => {
    const ah = parseCards('Ah')[0] as number;
    const kh = parseCards('Kh')[0] as number;
    const ahkh = comboIndex(ah, kh);

    const a = parseRange('AhKh:0.3,AKs');
    expect(a[ahkh]).toBe(1);
    expect(comboCount(a)).toBe(4);

    const b = parseRange('AKs,AhKh:0.3');
    expect(b[ahkh]).toBeCloseTo(0.3, 6);
    let others = 0;
    for (const c of handClassCombos(parseHandClass('AKs'))) {
      if (c === ahkh) continue;
      expect(b[c]).toBe(1);
      others++;
    }
    expect(others).toBe(3);
  });

  it('4.3 표준 6max 오픈 레인지의 콤보 수 (손으로 센 값 354)', () => {
    // 손 계산:
    //   22+   : 13 페어 x 6                                 = 78
    //   A2s+  : 키커 2..K = 12 클래스 x 4                    = 48
    //   K5s+  : 키커 5..Q = 8 x 4                            = 32
    //   Q8s+  : 키커 8..J = 4 x 4                            = 16
    //   J8s+  : 키커 8..T = 3 x 4                            = 12
    //   T8s+  : 키커 8..9 = 2 x 4                            = 8
    //   97s+  : 키커 7..8 = 2 x 4                            = 8
    //   86s+  : 키커 6..7 = 2 x 4                            = 8
    //   75s+  : 키커 5..6 = 2 x 4                            = 8
    //   65s   : 1 x 4                                        = 4
    //   A9o+  : 키커 9..K = 5 x 12                           = 60
    //   KTo+  : 키커 T..Q = 3 x 12                           = 36
    //   QTo+  : 키커 T..J = 2 x 12                           = 24
    //   JTo   : 1 x 12                                       = 12
    //   ------------------------------------------------------------
    //   페어 78 + 수티드 144 + 오프수트 132                  = 354
    const text = '22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,86s+,75s+,65s,A9o+,KTo+,QTo+,JTo';
    const r = parseRange(text);
    expect(comboCount(r)).toBe(354);
    expect(totalWeight(r)).toBeCloseTo(354, 4);

    // 클래스 수로도 교차 검증: 13 페어 + 36 수티드 + 11 오프수트 = 60 클래스
    const view = toHandClassView(r);
    let classes = 0;
    for (let h = 0; h < HAND_CLASS_COUNT; h++) if ((view.count[h] as number) > 0) classes++;
    expect(classes).toBe(13 + 36 + 11);

    // 이 문자열은 포매터 정규형이기도 하다
    expect(formatRange(r)).toBe(text);
  });

  it('4.3 잘못된 입력은 전부 throw', () => {
    const bad = [
      '2s+',
      'AKx',
      'AA:1.5',
      'AA:-1',
      'A2s-',
      ',',
      'A K',
      'aa',
      '10',
      '1010',
      'TT-',
      '-TT',
      'AJs-K9s',
      'AJs-A9o',
      'AA:',
      ':0.5',
      'AAs',
      'KAs',
      'AA+s',
      'AA-KK-QQ',
      'AhKh+',
      'T9s+',
      '76o+',
      '32+',
      'AKs+',
      'AhAh',
      'AA::1',
      'AA,,KK',
      'QQ:0.5:0.5',
    ];
    for (const t of bad) {
      expect(() => parseRange(t), t).toThrow(RangeSyntaxError);
    }
  });

  it('4.3 커넥터 "+" 는 RangeSyntaxError (P0.md 3.5 R1)', () => {
    // 이 표기는 도구마다 뜻이 다르다: PokerStove/Equilab 계열은 T9s+ = T9s,JTs,QJs,KQs
    // (커넥터 런), 키커 규칙으로는 T9s 하나 (no-op). 조용히 한쪽을 고르면 한쪽 사용자에게
    // 틀린 레인지가 되므로 거부한다. AKs+ 도 예외가 아니다.
    for (const t of ['T9s+', '76o+', '32+', 'AKs+', 'AKo+', 'AK+', '76s+', 'JTo+']) {
      expect(() => parseRange(t), t).toThrow(RangeSyntaxError);
    }
    // 갭이 1 이상이면(원갭부터) 키커 런으로 정상 동작한다
    expect(comboCount(parseRange('T8s+'))).toBe(8); // T8s,T9s
    expect(comboCount(parseRange('A2s+'))).toBe(48);
    expect(comboCount(parseRange('QT+'))).toBe(32);
    // "-" 로 쓴 커넥터 런은 여전히 합법 (모호하지 않다)
    expect(comboCount(parseRange('AKs-AQs'))).toBe(8);
    // 명시적 나열도 물론 합법
    expect(comboCount(parseRange('T9s,JTs,QJs,KQs'))).toBe(16);
  });

  // P0 R2 MINOR 2
  it('4.3 커넥터 에러 메시지의 예시가 실제로 따라 할 수 있는 것이어야 한다', () => {
    const msg = (t: string): string => {
      try {
        parseRange(t);
      } catch (e) {
        if (e instanceof RangeSyntaxError) return e.message;
        throw e;
      }
      throw new Error(`expected ${t} to throw`);
    };
    // 하이카드가 A 면 커넥터 런의 시작=끝이라 "AKs,...,AKs" 는 무의미한 안내였다
    expect(msg('AKs+')).not.toContain('AKs,...,AKs');
    expect(msg('AKs+')).toContain('connector');
    expect(msg('AKs+')).toContain('"AKs"');
    // 하이카드가 A 가 아니면 런 예시를 준다. 예시의 접미사는 입력과 같아야 한다
    expect(msg('T9o+')).toContain('"T9o,...,AKo"');
    expect(msg('T9s+')).toContain('"T9s,...,AKs"');
    // 메시지의 예시가 진짜로 파싱되는지 확인한다 (안내가 거짓말이면 안 된다)
    const quoted = /"([^"]+)"/g;
    let checkedHints = 0;
    for (const t of ['AKs+', 'T9s+', 'T9o+', '32+']) {
      for (const m of msg(t).matchAll(quoted)) {
        const raw = m[1] as string;
        if (raw === t) continue; // 입력 자체를 인용한 부분
        if (!/^[2-9TJQKA]/.test(raw)) continue; // '+' 같은 토큰 인용
        const example = raw.replace(',...,', ',');
        expect(() => parseRange(example), `${t} hint: ${example}`).not.toThrow();
        checkedHints++;
      }
    }
    expect(checkedHints).toBeGreaterThan(4);
  });

  it('4.3 잘못된 입력은 절대 조용히 빈 레인지를 돌려주지 않는다', () => {
    // 빈 문자열만 빈 레인지 (formatRange(emptyRange()) 와의 왕복을 위해)
    expect(comboCount(parseRange(''))).toBe(0);
    expect(formatRange(emptyRange())).toBe('');
    expect(comboCount(parseRange('   '))).toBe(0);
  });

  it('4.3 공백은 "," 전후에서 무시된다', () => {
    expect(weightsOf(parseRange('AA, KK ,QQ'))).toEqual(weightsOf(parseRange('AA,KK,QQ')));
  });

  it('4.3 포매터 정규형: 정규 문자열 20개에 대해 format(parse(t)) === t', () => {
    const canonical = [
      '22+',
      'A2s+',
      'KTo+',
      'AJs-A9s',
      'QQ:0.5',
      'AhKh',
      'AA,QQ',
      'TT-66',
      'AKs,AKo',
      'AsAh',
      '22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,86s+,75s+,65s,A9o+,KTo+,QTo+,JTo',
      '77+,ATs+,KJs+,QJs,AQo+',
      'JJ+:0.5',
      '99,88:0.25',
      'A5s-A2s',
      'T9s,98s,87s',
      '72o',
      'AhKh:0.3',
      'AKs:0.5,AKo:0.25',
      '55-33:0.75',
      'AsKs,AhKh:0.5',
    ];
    expect(canonical.length).toBeGreaterThanOrEqual(20);
    for (const t of canonical) {
      expect(formatRange(parseRange(t)), t).toBe(t);
    }
  });

  it('4.3 왕복: 무작위 Range 200개에 대해 parse(format(r)) ≈ r (1e-4)', () => {
    const rng = createRng(20260911);
    const weights = [0, 0.25, 0.5, 1];
    for (let trial = 0; trial < 200; trial++) {
      const r = emptyRange();
      // 클래스 단위와 콤보 단위를 섞는다
      for (let h = 0; h < HAND_CLASS_COUNT; h++) {
        if (rng.nextFloat() < 0.7) continue;
        const combos = handClassCombos(h);
        if (rng.nextFloat() < 0.6) {
          const w = weights[rng.nextInt(weights.length)] as number;
          for (const c of combos) r[c] = w;
        } else {
          for (const c of combos) r[c] = weights[rng.nextInt(weights.length)] as number;
        }
      }
      const text = formatRange(r);
      const back = parseRange(text);
      for (let i = 0; i < COMBO_COUNT; i++) {
        expect(Math.abs((back[i] as number) - (r[i] as number)), `${text} @${String(i)}`).toBeLessThanOrEqual(1e-4);
      }
      // 정규형은 멱등이어야 한다
      expect(formatRange(back)).toBe(text);
    }
  });

  it('4.3 fullRange 왕복', () => {
    const t = formatRange(fullRange());
    const r = parseRange(t);
    expect(comboCount(r)).toBe(COMBO_COUNT);
    expect(formatRange(r)).toBe(t);
  });
});
