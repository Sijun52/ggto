/**
 * 반응형 치수 (P3M 3절 / 8.1). jsdom 은 레이아웃을 못 재므로 **순수 함수**만 본다 —
 * 실제 픽셀은 `npm run check:mobile` 이 진짜 브라우저에서 잰다.
 */

import { describe, expect, it } from 'vitest';
import { AXIS_WIDTH, GRID_MAX, GRID_MD_MAX, GRID_MIN, gridMaxFor, gridSizeFor } from '../src/lib/layout';

describe('P3M 3 gridSizeFor', () => {
  it('P3M 3 375px 화면(패딩 16x2)에서 325px — 셀 25px', () => {
    expect(gridSizeFor(375 - 32)).toBe(325);
    expect(325 / 13).toBe(25);
  });

  it('P3M 3 768 이상이면 상한 520 (13 x 40)', () => {
    expect(gridSizeFor(768)).toBe(520);
    expect(gridSizeFor(1232)).toBe(520);
    expect(520).toBe(13 * 40);
  });

  it('P3M 3 좁은 컨테이너 300 → 273 (13 x 21)', () => {
    expect(gridSizeFor(300)).toBe(273);
    expect(273).toBe(13 * 21);
  });

  it('P3M 3 항상 13 의 배수이고 컨테이너를 넘지 않는다 (layout viewport 확장 금지)', () => {
    for (let w = 200; w <= 1400; w++) {
      const size = gridSizeFor(w);
      expect(size % 13, `w=${String(w)}`).toBe(0);
      expect(size).toBeLessThanOrEqual(GRID_MAX);
      // 하한(195)에 걸린 경우를 빼면 축 라벨까지 포함해 컨테이너 안에 들어간다
      if (size > GRID_MIN) expect(size + AXIS_WIDTH).toBeLessThanOrEqual(w);
    }
  });

  it('P3M 3 하한은 13 x 15 = 195 (그 밑에서는 라벨을 못 읽는다)', () => {
    expect(gridSizeFor(100)).toBe(GRID_MIN);
    expect(gridSizeFor(0)).toBe(GRID_MIN);
    expect(GRID_MIN).toBe(195);
  });

  it('P3M 3 md 구간(768~1279)은 420 상한 — 우측 열에 280px 을 남긴다', () => {
    expect(gridMaxFor(375)).toBe(GRID_MAX);
    expect(gridMaxFor(767)).toBe(GRID_MAX);
    expect(gridMaxFor(768)).toBe(GRID_MD_MAX);
    expect(gridMaxFor(1279)).toBe(GRID_MD_MAX);
    expect(gridMaxFor(1280)).toBe(GRID_MAX);
    expect(gridSizeFor(900, GRID_MD_MAX)).toBeLessThanOrEqual(420);
  });

  it('P3M 3 375 에서 격자 + 축 라벨이 페이지 폭 안에 들어간다', () => {
    const container = 375 - 32; // p-4 양쪽
    expect(gridSizeFor(container) + AXIS_WIDTH).toBeLessThanOrEqual(container);
  });
});
