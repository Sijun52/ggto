import { describe, expect, it } from 'vitest';
import {
  ActionSyntaxError,
  MAX_AMOUNT,
  createRng,
  formatAmount,
  formatActionSequence,
  parseActionSequence,
  type Action,
  type ActionSequence,
} from '../src/index.js';

describe('4.7 action sequence', () => {
  it('4.7 왕복: format(parse(s)) === s', () => {
    for (const s of ['F-F-R2.5-F-F-R11-C', 'B33-C/B75-R225-C/X-X', 'X-B12.5-R40-A-C', '']) {
      expect(formatActionSequence(parseActionSequence(s)), s).toBe(s);
    }
  });

  it('4.7 formatAmount 상한: MAX_AMOUNT 초과는 ActionSyntaxError (R1 MINOR 7)', () => {
    // 1e9 를 넘으면 String(x) 가 지수 표기/부동소수점 쓰레기를 내서 정규형이 깨진다.
    expect(formatAmount(MAX_AMOUNT)).toBe('1000000000');
    expect(() => formatAmount(MAX_AMOUNT * 10)).toThrow(ActionSyntaxError);
    expect(() => formatAmount(1e21)).toThrow(ActionSyntaxError);
    expect(() => formatAmount(Number.POSITIVE_INFINITY)).toThrow(ActionSyntaxError);
    expect(() => formatAmount(Number.NaN)).toThrow(ActionSyntaxError);
    expect(() => formatAmount(-1)).toThrow(ActionSyntaxError);
    // 파서도 같은 상한을 쓴다 (formatAmount 왕복 검사 경유)
    expect(() => parseActionSequence('R10000000000')).toThrow(ActionSyntaxError);
    expect(parseActionSequence('R1000000000')[0]?.[0]).toEqual({ kind: 'raise', amount: 1e9 });
  });

  it('4.7 빈 문자열은 빈 시퀀스, format([]) === ""', () => {
    expect(parseActionSequence('')).toEqual([]);
    expect(formatActionSequence([])).toBe('');
  });

  it('4.7 파싱 결과 구조', () => {
    const seq = parseActionSequence('F-F-R2.5-F-F-R11-C');
    expect(seq).toHaveLength(1);
    expect(seq[0]).toHaveLength(7);
    expect((seq[0] as Action[])[2]).toEqual({ kind: 'raise', amount: 2.5 });
    expect((seq[0] as Action[])[0]).toEqual({ kind: 'fold' });
    expect((seq[0] as Action[])[6]).toEqual({ kind: 'call' });

    const three = parseActionSequence('B33-C/B75-R225-C/X-X');
    expect(three).toHaveLength(3);
    expect(three.map((s) => s.length)).toEqual([2, 3, 2]);
    expect((three[0] as Action[])[0]).toEqual({ kind: 'bet', amount: 33 });
    expect((three[1] as Action[])[1]).toEqual({ kind: 'raise', amount: 225 });
    expect((three[2] as Action[])[0]).toEqual({ kind: 'check' });

    const allin = parseActionSequence('X-B12.5-R40-A-C');
    expect((allin[0] as Action[])[3]).toEqual({ kind: 'allin' });
  });

  it('4.7 비정규 입력 throw', () => {
    const bad = [
      'F.F.R2.5',
      'f-f',
      'R2.50',
      'R02',
      'F--C',
      '-F',
      'B33-C/',
      'B',
      'R',
      'F C',
      '/F',
      'F//C',
      'R.5',
      'R2.',
      'R-1',
      'R1e2',
      'F1',
      'X2',
      'C3',
      'A5',
      'Z',
      'R2.555',
      'R 2.5',
      'F-',
    ];
    for (const s of bad) {
      expect(() => parseActionSequence(s), s).toThrow(ActionSyntaxError);
    }
  });

  it('4.7 format 은 빈 스트리트를 거부한다 (문자열로 표현 불가 → 왕복이 깨짐)', () => {
    expect(() => formatActionSequence([[]])).toThrow(ActionSyntaxError);
    expect(() => formatActionSequence([[{ kind: 'fold' }], []])).toThrow(ActionSyntaxError);
  });

  it('4.7 무작위 시퀀스 200개 왕복 (깊은 동등)', () => {
    const rng = createRng(13579);
    const kinds = ['fold', 'check', 'call', 'allin', 'bet', 'raise'] as const;
    for (let t = 0; t < 200; t++) {
      const streets = 1 + rng.nextInt(4);
      const seq: ActionSequence = [];
      for (let s = 0; s < streets; s++) {
        const n = 1 + rng.nextInt(6);
        const street: Action[] = [];
        for (let a = 0; a < n; a++) {
          const k = kinds[rng.nextInt(kinds.length)] as (typeof kinds)[number];
          if (k === 'bet' || k === 'raise') {
            // 금액은 2자리 반올림 후 생성
            const amount = Math.round(rng.nextFloat() * 30000) / 100;
            street.push({ kind: k, amount });
          } else {
            street.push({ kind: k });
          }
        }
        seq.push(street);
      }
      const text = formatActionSequence(seq);
      expect(parseActionSequence(text), text).toEqual(seq);
      expect(formatActionSequence(parseActionSequence(text))).toBe(text);
    }
  });

  it('4.7 서로 다른 두 시퀀스는 서로 다른 문자열을 만든다 (캐시 키 유일성)', () => {
    const rng = createRng(2468);
    const seen = new Map<string, string>();
    const kinds = ['fold', 'check', 'call', 'allin', 'bet', 'raise'] as const;
    for (let t = 0; t < 5000; t++) {
      const streets = 1 + rng.nextInt(3);
      const seq: ActionSequence = [];
      for (let s = 0; s < streets; s++) {
        const n = 1 + rng.nextInt(4);
        const street: Action[] = [];
        for (let a = 0; a < n; a++) {
          const k = kinds[rng.nextInt(kinds.length)] as (typeof kinds)[number];
          if (k === 'bet' || k === 'raise') {
            street.push({ kind: k, amount: rng.nextInt(400) / 4 });
          } else {
            street.push({ kind: k });
          }
        }
        seq.push(street);
      }
      const text = formatActionSequence(seq);
      const canon = JSON.stringify(seq);
      const prev = seen.get(text);
      if (prev !== undefined) expect(prev, text).toBe(canon);
      else seen.set(text, canon);
    }
    expect(seen.size).toBeGreaterThan(1000);
  });

  it('4.7 금액 정규화: 소수 2자리 반올림', () => {
    expect(formatActionSequence([[{ kind: 'raise', amount: 2.5 }]])).toBe('R2.5');
    expect(formatActionSequence([[{ kind: 'raise', amount: 2.5001 }]])).toBe('R2.5');
    expect(formatActionSequence([[{ kind: 'bet', amount: 33 }]])).toBe('B33');
    expect(formatActionSequence([[{ kind: 'bet', amount: 0.5 }]])).toBe('B0.5');
    expect(formatActionSequence([[{ kind: 'bet', amount: 1 / 3 }]])).toBe('B0.33');
  });
});
