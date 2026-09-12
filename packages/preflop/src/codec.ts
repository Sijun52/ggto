/**
 * ggto-json 정규화·해시·해상도 전개·익스포트. P2.md 5.3 / 5.4.
 *
 * `content_hash = sha256(formatGgtoJson(doc))` 이므로 이 파일의 직렬화 규칙이
 * "같은 차트인가" 의 정의다. 규칙을 바꾸면 기존 DB 의 해시가 전부 달라진다.
 */

import { createHash } from 'node:crypto';
import { CLASS_COMBOS, CLASS_KEYS, COMBO_KEYS, keysFor } from './keys.js';
import type { ChartSetMeta, GgtoJson, GgtoJsonNode, NodeData } from './types.js';

/**
 * 5.4 정규화: 객체 키 사전순, 노드 seq 사전순, 숫자는 Math.fround, 공백 없음.
 *
 * `Math.fround` 를 **모든** 숫자에 거는 것은 스펙 5.4 의 문언 그대로다. 저장 정밀도(f32)와
 * 해시 입력을 일치시키는 것이 목적이고, DB 에 들어가는 config/rake 값은 원본 f64 그대로
 * 저장된다 (여기서 바뀌는 것은 해시용 직렬화뿐이다). 그래서 익스포트 → 재해시가 항등이다.
 */
function canonical(value: unknown): unknown {
  if (typeof value === 'number') return Math.fround(value);
  if (Array.isArray(value)) return value.map((v: unknown) => canonical(v));
  if (typeof value === 'object' && value !== null) {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = canonical(src[k]);
    return out;
  }
  return value;
}

/** 정규화된 문서 문자열. JSON.stringify 는 기본이 공백 없음이고 숫자 표기는 String() 과 같다. */
export function formatGgtoJson(doc: GgtoJson): string {
  const nodes = [...doc.nodes].sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
  return JSON.stringify(canonical({ ...doc, nodes }));
}

export function contentHash(doc: GgtoJson): string {
  return createHash('sha256').update(formatGgtoJson(doc), 'utf8').digest('hex');
}

/** 임의 문자열의 sha256 (equity 표 등 부속 파일 해시에 쓴다) */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 169 해상도 문서 → 1326 해상도 문서. 클래스의 모든 콤보에 같은 행을 복사한다 (P2.md 3.2).
 * 이미 1326 이면 그대로 돌려준다.
 */
export function expandTo1326(doc: GgtoJson): GgtoJson {
  if (doc.resolution === '1326') return doc;
  const nodes: GgtoJsonNode[] = doc.nodes.map((n) => {
    const strategy: Record<string, number[]> = {};
    const ev: Record<string, number[]> = {};
    for (let h = 0; h < CLASS_KEYS.length; h++) {
      const key = CLASS_KEYS[h] as string;
      const srow = n.strategy[key];
      const erow = n.ev?.[key];
      for (const combo of CLASS_COMBOS[h] as readonly number[]) {
        const comboKey = COMBO_KEYS[combo] as string;
        if (srow !== undefined) strategy[comboKey] = [...srow];
        if (erow !== undefined) ev[comboKey] = [...erow];
      }
    }
    const out: GgtoJsonNode = { seq: n.seq, actions: [...n.actions], strategy };
    if (n.ev !== undefined) out.ev = ev;
    return out;
  });
  return { ...doc, resolution: '1326', nodes };
}

/**
 * 저장된 차트셋 → ggto-json (익스포트). 왕복 테스트(6.4)의 한쪽 끝이다.
 *
 * `resolution='169'` 이면 클래스의 첫 콤보 값을 대표로 쓴다 — 임포터가 클래스 안의 모든
 * 콤보에 같은 행을 복사했으므로 어느 콤보를 골라도 같다 (그 성질은 6.4 테스트가 고정한다).
 */
export function toGgtoJson(set: ChartSetMeta, nodes: readonly NodeData[]): GgtoJson {
  const keys = keysFor(set.resolution);
  const docNodes: GgtoJsonNode[] = nodes.map((n) => {
    const strategy: Record<string, number[]> = {};
    const ev: Record<string, number[]> = {};
    for (let k = 0; k < keys.length; k++) {
      const combo = set.resolution === '169' ? ((CLASS_COMBOS[k] as readonly number[])[0] as number) : k;
      const key = keys[k] as string;
      strategy[key] = n.strategy.map((row) => row[combo] as number);
      if (n.ev !== null) ev[key] = n.ev.map((row) => row[combo] as number);
    }
    const out: GgtoJsonNode = { seq: n.seq, actions: [...n.actions], strategy };
    if (n.ev !== null) out.ev = ev;
    return out;
  });
  return {
    format: 'ggto-json',
    version: set.formatVersion,
    name: set.name,
    gameType: set.gameType,
    config: set.config,
    rake: set.rake,
    resolution: set.resolution,
    evBasis: set.evBasis,
    source: set.source,
    nodes: docNodes,
  };
}
