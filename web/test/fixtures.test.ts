/**
 * `web/test/fixtures/*.json` 이 **진짜 시드 산출물**인지 (P3 R1 MINOR 4).
 *
 * 이 디렉터리는 `npm run seed` 가 `data/charts` 에 쓴 파일의 복사본이다 (`data/` 는
 * .gitignore 대상이라 레포에 없다). trainer 쪽에는 같은 가드가 있었는데 web 쪽에는
 * 없어서, 생성기를 고치면 web 테스트만 옛 데이터를 기준으로 조용히 통과했다.
 *
 * 규칙은 `packages/trainer/test/fixtures.test.ts` 와 같다: `data/charts` 가 있을 때만
 * 바이트로 비교하고, 없으면 (fresh clone) 건너뛴다 — 없는 것을 있는 척 검사하지 않는다.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures');
const REPO_CHARTS = resolve(import.meta.dirname, '../../data/charts');

/**
 * **차트** 픽스처만. `solve-*.json` 은 P5 솔브 응답 픽스처이고 생성기·대조 테스트가 따로
 * 있다 (`packages/solver/scripts/make-web-fixture.mjs`, `packages/solver/test/webFixture.test.ts`).
 */
function fixtureFiles(): string[] {
  return readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('solve-'));
}

describe('P3M 8.1 web 픽스처 = 시드 산출물', () => {
  it('P3M 8.1 픽스처가 비어 있지 않고 EV 를 담은 생성 차트다', () => {
    const files = fixtureFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const doc = JSON.parse(readFileSync(resolve(FIXTURE_DIR, file), 'utf8')) as {
        evBasis: string;
        source: { kind: string };
        nodes: { seq: string; ev?: unknown }[];
      };
      expect(doc.evBasis).toBe('stack_delta_from_node');
      expect(doc.source.kind).toBe('generated');
      for (const n of doc.nodes) expect(n.ev).toBeDefined();
    }
  });

  it('P3M 8.1 data/charts 가 있으면 바이트 단위로 같다 (있을 때만)', () => {
    if (!existsSync(REPO_CHARTS)) return;
    let compared = 0;
    for (const file of fixtureFiles()) {
      const repoPath = resolve(REPO_CHARTS, file);
      if (!existsSync(repoPath)) continue;
      expect(readFileSync(resolve(FIXTURE_DIR, file), 'utf8'), `${file} drifted from data/charts`).toBe(
        readFileSync(repoPath, 'utf8'),
      );
      compared++;
    }
    // data/charts 가 있는 개발 머신에서는 실제로 하나 이상을 비교했어야 한다
    // (파일명이 바뀌어 조용히 0건 비교되는 것을 막는다).
    expect(compared).toBeGreaterThan(0);
  });
});
