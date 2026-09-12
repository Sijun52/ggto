import { describe, expect, it } from 'vitest';
import { canonicalBoard } from '../../src/index.js';

describe('4.6 slow — 리버 전수', () => {
  it('4.6 리버 2,598,960개 → 134,459 정규 보드', () => {
    const classes = new Set<number>();
    let n = 0;
    const t0 = performance.now();
    for (let a = 0; a < 52; a++) {
      for (let b = a + 1; b < 52; b++) {
        for (let c = b + 1; c < 52; c++) {
          for (let d = c + 1; d < 52; d++) {
            for (let e = d + 1; e < 52; e++) {
              const { board } = canonicalBoard([a, b, c, d, e]);
              // 정렬된 5장 → 고유 정수 키 (각 자리 < 52)
              let k = 0;
              for (let i = 0; i < 5; i++) k = k * 52 + (board[i] as number);
              classes.add(k);
              n++;
            }
          }
        }
      }
    }
    console.log(
      `river exhaustive: ${String(n)} boards -> ${String(classes.size)} classes in ${(
        (performance.now() - t0) / 1000
      ).toFixed(1)}s`,
    );
    expect(n).toBe(2598960);
    expect(classes.size).toBe(134459);
  });
});
