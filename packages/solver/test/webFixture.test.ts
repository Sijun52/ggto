/**
 * P5.md 8.1 — 커밋된 웹 픽스처가 **지금 코드의 산출물**인가.
 *
 * 웹 쪽 대조 테스트(`web/test/solveAggregate.test.ts`)는 정적 파일을 읽는다. 그래서
 * `view.ts` 의 순열 방향을 뒤집는 뮤턴트(`const inv = perm`)를 심어도 **픽스처가 낡을 뿐**
 * 웹 테스트는 통과한다. 여기서 다시 만들어 바이트로 비교하면 그 뮤턴트가 여기서 죽는다.
 *
 * (`packages/trainer/test/fixtures.test.ts`·`web/test/fixtures.test.ts` 와 같은 규칙이다:
 * 생성기가 있는 픽스처는 생성기로 재현 가능해야 한다.)
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- .mjs 생성기에는 타입 선언이 없다 (스크립트다)
import { FIXTURE_PATH, buildFixtureDoc, serializeFixture } from '../scripts/make-web-fixture.mjs';

describe('P5 8.1 web 집계 픽스처', () => {
  it('P5 8.1 생성기를 다시 돌리면 커밋된 파일과 바이트가 같다', () => {
    const rebuilt = serializeFixture(buildFixtureDoc()) as string;
    const committed = readFileSync(FIXTURE_PATH as string, 'utf8');
    expect(
      rebuilt === committed
        ? true
        : `web/test/fixtures/solve-node.json drifted — rerun node packages/solver/scripts/make-web-fixture.mjs`,
    ).toBe(true);
  });

  it('P5 8.1 픽스처의 perm 은 3-cycle 이다 (involution 이면 방향을 못 잡는다)', () => {
    const doc = buildFixtureDoc() as { perm: number[] };
    const perm = doc.perm;
    // involution = 자기 자신이 역: perm[perm[i]] === i. 3-cycle 은 그렇지 않다.
    const involution = perm.every((_v, i) => perm[perm[i] as number] === i);
    expect(involution).toBe(false);
    // 순열이긴 하다 (0..3 의 치환).
    expect([...perm].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });
});
