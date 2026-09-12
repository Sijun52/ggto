import { describe, expect, it } from 'vitest';
import {
  ActionSyntaxError,
  COMBO_COUNT,
  RangeSyntaxError,
  createRng,
  formatActionSequence,
  formatRange,
  parseActionSequence,
  parseRange,
} from '../src/index.js';

/**
 * 파서 fuzz: 무작위 입력에 대해 "정상 파싱" 또는 "이름 있는 SyntaxError" 둘 중 하나여야 한다.
 * TypeError / RangeError / undefined 반환 같은 제3의 결과가 나오면 실패다.
 */

const RANGE_ALPHABET = '23456789TJQKAsohcd+-,:.0159 x*';
const ACTION_ALPHABET = 'FXCABR0123456789.-/ fxcabr';

function randomString(rng: { nextInt(n: number): number }, alphabet: string, maxLen: number): string {
  const n = rng.nextInt(maxLen + 1);
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[rng.nextInt(alphabet.length)] as string;
  return s;
}

describe('4.3 / 4.7 파서 fuzz', () => {
  it('4.3 parseRange fuzz 20,000회: 정상 파싱 또는 RangeSyntaxError 만', () => {
    const rng = createRng(555000);
    let ok = 0;
    let threw = 0;
    for (let t = 0; t < 20000; t++) {
      const s = randomString(rng, RANGE_ALPHABET, 14);
      try {
        const r = parseRange(s);
        expect(r).toBeInstanceOf(Float32Array);
        expect(r.length).toBe(COMBO_COUNT);
        // expect() 는 느리므로 핫 루프에서는 직접 검사하고 실패 시에만 assert 한다
        let bad = -1;
        for (let i = 0; i < COMBO_COUNT; i++) {
          const w = r[i] as number;
          if (!(Number.isFinite(w) && w >= 0 && w <= 1)) {
            bad = i;
            break;
          }
        }
        expect(bad, `${JSON.stringify(s)} produced an out-of-range weight`).toBe(-1);
        // 정상 파싱되었다면 정규형 왕복도 성립해야 한다
        expect(() => parseRange(formatRange(r)), s).not.toThrow();
        ok++;
      } catch (e) {
        expect(e, JSON.stringify(s)).toBeInstanceOf(RangeSyntaxError);
        threw++;
      }
    }
    expect(ok + threw).toBe(20000);
    expect(ok).toBeGreaterThan(0);
    expect(threw).toBeGreaterThan(0);
  });

  it('4.3 parseRange fuzz — 문법적으로 그럴듯한 조합 5,000회', () => {
    const rng = createRng(777000);
    const ranks = '23456789TJQKA';
    const sfx = ['', 's', 'o'];
    const mod = ['', '+'];
    let ok = 0;
    let threw = 0;
    let connectorItems = 0;
    for (let t = 0; t < 5000; t++) {
      const items: string[] = [];
      const n = 1 + rng.nextInt(4);
      for (let k = 0; k < n; k++) {
        const a = ranks[rng.nextInt(13)] as string;
        const b = ranks[rng.nextInt(13)] as string;
        let item = a + b + (sfx[rng.nextInt(3)] as string) + (mod[rng.nextInt(2)] as string);
        if (rng.nextInt(4) === 0) item += `:${String(rng.nextInt(5) / 4)}`;
        items.push(item);
      }
      const s = items.join(',');
      // 커넥터 '+' 를 포함하면 반드시 throw 여야 한다 (P0.md 3.5 R1).
      // 판정은 생성기가 만든 랭크 문자로 독립적으로 계산한다 (구현 참조 없음).
      const hasConnectorPlus = items.some((it) => {
        const spec = (it.split(':')[0] as string);
        if (!spec.endsWith('+')) return false;
        const body = spec.slice(0, -1);
        const a = ranks.indexOf(body[0] as string);
        const b = ranks.indexOf(body[1] as string);
        return a >= 0 && b >= 0 && a - b === 1;
      });
      if (hasConnectorPlus) connectorItems++;
      try {
        const r = parseRange(s);
        expect(hasConnectorPlus, `connector "+" must not parse: ${s}`).toBe(false);
        expect(formatRange(parseRange(formatRange(r)))).toBe(formatRange(r));
        ok++;
      } catch (e) {
        expect(e, JSON.stringify(s)).toBeInstanceOf(RangeSyntaxError);
        threw++;
      }
    }
    expect(ok).toBeGreaterThan(100);
    expect(threw).toBeGreaterThan(100);
    // 생성기가 실제로 커넥터 '+' 를 만들어냈는지 확인 (안 만들었으면 위 검사가 공허하다)
    expect(connectorItems).toBeGreaterThan(50);
  });

  it('4.7 parseActionSequence fuzz 20,000회: 정상 파싱 또는 ActionSyntaxError 만', () => {
    const rng = createRng(999000);
    let ok = 0;
    let threw = 0;
    for (let t = 0; t < 20000; t++) {
      const s = randomString(rng, ACTION_ALPHABET, 12);
      try {
        const seq = parseActionSequence(s);
        // 정상 파싱되면 왕복이 항등이어야 한다 (정규형만 받기 때문)
        expect(formatActionSequence(seq), JSON.stringify(s)).toBe(s);
        ok++;
      } catch (e) {
        expect(e, JSON.stringify(s)).toBeInstanceOf(ActionSyntaxError);
        threw++;
      }
    }
    expect(ok + threw).toBe(20000);
    expect(ok).toBeGreaterThan(0);
    expect(threw).toBeGreaterThan(0);
  });
});
