import { COMBO_COUNT, HAND_CLASS_COUNT, comboCards, formatCard, handClassCombos, handClassName, parseHandClass } from '@ggto/core';
import { describe, expect, it } from 'vitest';
import {
  CLASS_KEYS,
  COMBO_KEYS,
  contentHash,
  expandTo1326,
  formatGgtoJson,
  parseGgtoJson,
} from '../src/index.js';
import { doc1326, doc169 } from './helpers.js';

describe('5.1 키 규약', () => {
  it('5.1 169 키는 core 의 handClassName 과 1:1 이고 13x13 구조가 맞는다', () => {
    expect(CLASS_KEYS.length).toBe(HAND_CLASS_COUNT);
    expect(new Set(CLASS_KEYS).size).toBe(HAND_CLASS_COUNT);
    // 외부에서 아는 사실: 페어 13 + 수티드 78 + 오프수트 78, 콤보 합 1326
    const pairs = CLASS_KEYS.filter((k) => k.length === 2);
    const suited = CLASS_KEYS.filter((k) => k.endsWith('s'));
    const offsuit = CLASS_KEYS.filter((k) => k.endsWith('o'));
    expect([pairs.length, suited.length, offsuit.length]).toEqual([13, 78, 78]);
    const combos = CLASS_KEYS.reduce((acc, k) => acc + handClassCombos(parseHandClass(k)).length, 0);
    expect(combos).toBe(13 * 6 + 78 * 4 + 78 * 12);
    expect(combos).toBe(COMBO_COUNT);
  });

  it('5.1 1326 키는 formatCard(hi)+formatCard(lo) 이고 전부 다르다', () => {
    expect(COMBO_KEYS.length).toBe(COMBO_COUNT);
    expect(new Set(COMBO_KEYS).size).toBe(COMBO_COUNT);
    for (const c of [0, 1, 665, 1325]) {
      const [hi, lo] = comboCards(c);
      expect(COMBO_KEYS[c]).toBe(formatCard(hi) + formatCard(lo));
    }
  });
});

describe('5.4 정규화와 content_hash', () => {
  it('5.4 키 순서·노드 순서가 달라도 같은 문자열과 같은 해시가 나온다', () => {
    const a = doc169();
    const b = doc169();
    b.nodes = [...b.nodes].reverse();
    // 전략 키 순서를 뒤집어 넣는다
    b.nodes = b.nodes.map((n) => ({
      ...n,
      strategy: Object.fromEntries(Object.entries(n.strategy).reverse()),
    }));
    expect(formatGgtoJson(b)).toBe(formatGgtoJson(a));
    expect(contentHash(b)).toBe(contentHash(a));
  });

  it('5.4 정규화 문자열에 공백이 없고 최상위 키가 사전순이다', () => {
    const text = formatGgtoJson(doc169());
    // 서식 공백이 없다 = 압축 직렬화와 바이트 동일 (문자열 값 안의 공백은 데이터다)
    expect(JSON.stringify(JSON.parse(text))).toBe(text);
    expect(text.includes('\n')).toBe(false);
    expect(text.includes(': ')).toBe(false);
    const keys = Object.keys(JSON.parse(text) as Record<string, unknown>);
    expect(keys).toEqual([...keys].sort());
    expect(keys[0]).toBe('config');
  });

  it('5.4 값이 하나라도 다르면 해시가 달라진다', () => {
    const a = doc169();
    const b = doc169({ cutoff: 81 });
    expect(contentHash(a)).not.toBe(contentHash(b));
  });

  it('5.4 정규화된 텍스트는 다시 파싱해도 같은 해시다 (왕복)', () => {
    const a = doc169();
    const text = formatGgtoJson(a);
    expect(contentHash(parseGgtoJson(text))).toBe(contentHash(a));
  });

  it('5.4 숫자는 f32 로 접힌다 — f32 로 같은 두 값은 같은 해시', () => {
    const a = doc169();
    const b = doc169();
    const key = CLASS_KEYS[0] as string;
    const row = (b.nodes[0] as { ev?: Record<string, number[]> }).ev?.[key] as number[];
    // f64 로는 다르지만 f32 로 접으면 같은 값 (1e-9 는 f32 ULP 아래)
    row[1] = (row[1] as number) + 1e-9;
    expect(row[1]).not.toBe((a.nodes[0]?.ev?.[key] as number[])[1]);
    expect(contentHash(b)).toBe(contentHash(a));
  });
});

describe('5.3 expandTo1326', () => {
  it('5.3 169 문서를 펼치면 클래스의 모든 콤보가 같은 행을 갖는다', () => {
    const expanded = expandTo1326(doc169());
    expect(expanded.resolution).toBe('1326');
    const node = expanded.nodes[0];
    expect(Object.keys(node?.strategy ?? {}).length).toBe(COMBO_COUNT);
    for (const h of [0, 13, 168]) {
      const combos = handClassCombos(h);
      const rows = combos.map((c) => (node?.strategy[COMBO_KEYS[c] as string] as number[]).join(','));
      expect(new Set(rows).size).toBe(1);
      // 원본 169 행과 같아야 한다
      expect(rows[0]).toBe((doc169().nodes[0]?.strategy[handClassName(h)] as number[]).join(','));
    }
  });

  it('5.3 이미 1326 이면 그대로', () => {
    const d = doc1326();
    expect(expandTo1326(d)).toBe(d);
  });
});
