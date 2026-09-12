/**
 * 테스트 픽스처. **GTO 차트가 아니다** — 포맷/저장소 계약을 검사하기 위한, 규칙이 단순하고
 * 사람이 손으로 재계산할 수 있는 문서다 (전략값은 클래스 인덱스의 결정적 함수).
 * 진짜 균형 차트의 성질은 tools/chart-gen 테스트가 본다.
 */

import { CLASS_KEYS, COMBO_KEYS, type GgtoJson, type GgtoJsonNode } from '../src/index.js';

export const HU_CONFIG: GgtoJson['config'] = {
  positions: ['SB', 'BB'],
  blinds: [
    { pos: 'SB', amount: 0.5 },
    { pos: 'BB', amount: 1 },
  ],
  ante: { mode: 'none' },
  stack: 10,
};

/** 클래스 인덱스가 임계값보다 작으면(=강한 핸드 쪽) 공격 100%, 아니면 0% */
export function jamFreq(h: number, cutoff: number): number {
  return h < cutoff ? 1 : 0;
}

export function node169(seq: string, actions: [string, string], cutoff: number, withEv: boolean): GgtoJsonNode {
  const strategy: Record<string, number[]> = {};
  const ev: Record<string, number[]> = {};
  CLASS_KEYS.forEach((key, h) => {
    const p = jamFreq(h, cutoff);
    strategy[key] = [1 - p, p];
    // EV 는 3.3 기준: F 는 정확히 0, 공격은 임의의 결정적 값
    ev[key] = [0, Number((2 - h / 100).toFixed(4))];
  });
  const out: GgtoJsonNode = { seq, actions: [...actions], strategy };
  if (withEv) out.ev = ev;
  return out;
}

export function doc169(opts: { withEv?: boolean; name?: string; cutoff?: number } = {}): GgtoJson {
  const withEv = opts.withEv ?? true;
  const cutoff = opts.cutoff ?? 80;
  return {
    format: 'ggto-json',
    version: 1,
    name: opts.name ?? 'fixture HU 10bb',
    gameType: 'cash',
    config: HU_CONFIG,
    rake: { mode: 'none' },
    resolution: '169',
    evBasis: withEv ? 'stack_delta_from_node' : 'none',
    source: { kind: 'generated', name: 'test fixture', version: '1', license: 'self' },
    nodes: [node169('', ['F', 'A'], cutoff, withEv), node169('A', ['F', 'C'], cutoff + 20, withEv)],
  };
}

/** 1326 해상도 픽스처. 콤보 인덱스의 홀짝으로 갈라 "같은 클래스 안에서 전략이 갈리는" 경우를 만든다 */
export function doc1326(): GgtoJson {
  const mk = (seq: string, actions: [string, string]): GgtoJsonNode => {
    const strategy: Record<string, number[]> = {};
    const ev: Record<string, number[]> = {};
    COMBO_KEYS.forEach((key, c) => {
      const p = c % 2 === 0 ? 1 : 0.25;
      strategy[key] = [1 - p, p];
      ev[key] = [0, c / 1000];
    });
    return { seq, actions: [...actions], strategy, ev };
  };
  return {
    format: 'ggto-json',
    version: 1,
    name: 'fixture HU 10bb 1326',
    gameType: 'cash',
    config: HU_CONFIG,
    rake: { mode: 'none' },
    resolution: '1326',
    evBasis: 'stack_delta_from_node',
    source: { kind: 'manual', name: 'test fixture 1326' },
    nodes: [mk('', ['F', 'A']), mk('A', ['F', 'C'])],
  };
}

/** JSON 텍스트로 만든 뒤 한 군데를 고치는 헬퍼 (구조 결함 주입용) */
export function withPatch(doc: GgtoJson, patch: (d: Record<string, unknown>) => void): string {
  const clone = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  patch(clone);
  return JSON.stringify(clone);
}
