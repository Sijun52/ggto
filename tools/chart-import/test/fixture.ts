/**
 * CLI 테스트용 문서 생성기. 키 목록은 @ggto/preflop 에서 나온다 (핸드 이름 하드코딩 없음).
 * GTO 차트가 아니라 포맷 계약 검사용이다.
 */

import { CLASS_KEYS, type GgtoJson } from '@ggto/preflop';

export function miniDoc(name = 'cli fixture HU 10bb'): GgtoJson {
  const mk = (seq: string, actions: [string, string], cutoff: number): GgtoJson['nodes'][number] => {
    const strategy: Record<string, number[]> = {};
    const ev: Record<string, number[]> = {};
    CLASS_KEYS.forEach((key, h) => {
      const p = h < cutoff ? 1 : 0;
      strategy[key] = [1 - p, p];
      ev[key] = [0, Number((1.5 - h / 200).toFixed(4))];
    });
    return { seq, actions: [...actions], strategy, ev };
  };
  return {
    format: 'ggto-json',
    version: 1,
    name,
    gameType: 'cash',
    config: {
      positions: ['SB', 'BB'],
      blinds: [
        { pos: 'SB', amount: 0.5 },
        { pos: 'BB', amount: 1 },
      ],
      ante: { mode: 'none' },
      stack: 10,
    },
    rake: { mode: 'none' },
    resolution: '169',
    evBasis: 'stack_delta_from_node',
    source: { kind: 'manual', name: 'chart-import test fixture' },
    nodes: [mk('', ['F', 'A'], 60), mk('A', ['F', 'C'], 40)],
  };
}
