/**
 * 테스트 픽스처. **실데이터다**: `test/fixtures/*.json` 은 `npm run seed` 가 낸 시드 차트
 * 6개를 그대로 복사한 것이다 (정확 에퀴티 표로 재생성된 P3 판). 손으로 쓴 1326 배열은
 * 쓰지 않는다 — 3.5 게이트는 진짜 균형 차트에서만 의미가 있다.
 *
 * `fixtures.test.ts` 가 이 파일들이 `data/charts` 와 여전히 같은지 확인한다 (있을 때만).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openRepository, parseGgtoJson, type ChartRepository, type GgtoJson } from '@ggto/preflop';

export const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures');

export function fixtureFiles(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

export function fixtureDocs(): GgtoJson[] {
  return fixtureFiles().map((f) => parseGgtoJson(readFileSync(resolve(FIXTURE_DIR, f), 'utf8')));
}

/** 시드 6개가 들어간 인메모리 차트 저장소. */
export function seededRepo(): ChartRepository {
  const repo = openRepository(':memory:');
  for (const doc of fixtureDocs()) repo.importSet(doc, { source: 'generated' });
  return repo;
}

/** EV 를 지운 사본 (graded_by: 'frequency' 경로를 실데이터로 돌리기 위한 것). */
export function withoutEv(doc: GgtoJson, name: string): GgtoJson {
  return {
    ...doc,
    name,
    evBasis: 'none',
    nodes: doc.nodes.map((n) => ({ seq: n.seq, actions: [...n.actions], strategy: n.strategy })),
  };
}

/** 테스트용 고정 시계. */
export function fixedClock(start: number): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: (): number => t,
    advance: (ms: number): void => {
      t += ms;
    },
  };
}

export const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
