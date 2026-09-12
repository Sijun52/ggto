/**
 * 픽스처가 **진짜 시드 산출물**인지 확인한다.
 *
 * `test/fixtures/*.json` 은 `npm run seed` 가 `data/charts` 에 쓴 파일의 복사본이다
 * (`data/` 는 .gitignore 대상이라 레포에 없다). 개발 머신에 `data/charts` 가 있으면
 * 바이트 단위로 비교해 둘이 갈라지는 것을 잡는다. 없으면 (fresh clone) 건너뛴다 —
 * 없는 것을 있는 척 검사하지 않는다.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR, fixtureDocs, fixtureFiles } from './helpers.js';

const REPO_CHARTS = resolve(import.meta.dirname, '../../../data/charts');

describe('P3 테스트 픽스처 = 시드 산출물', () => {
  it('시드 6개가 전부 있고 EV 를 담고 있다', () => {
    const docs = fixtureDocs();
    expect(docs).toHaveLength(6);
    for (const doc of docs) {
      expect(doc.evBasis).toBe('stack_delta_from_node');
      expect(doc.source.kind).toBe('generated');
      expect(doc.nodes.map((n) => n.seq).sort()).toEqual(['', 'A']);
      for (const n of doc.nodes) expect(n.ev).toBeDefined();
    }
  });

  it('data/charts 가 있으면 바이트 단위로 같다 (있을 때만)', () => {
    if (!existsSync(REPO_CHARTS)) return;
    for (const file of fixtureFiles()) {
      const repoPath = resolve(REPO_CHARTS, file);
      if (!existsSync(repoPath)) continue;
      expect(readFileSync(resolve(FIXTURE_DIR, file), 'utf8'), `${file} drifted from data/charts`).toBe(
        readFileSync(repoPath, 'utf8'),
      );
    }
  });
});
