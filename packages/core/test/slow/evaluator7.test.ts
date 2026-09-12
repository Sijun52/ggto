import { describe, expect, it } from 'vitest';
import { createRng, evaluate7, handCategory } from '../../src/index.js';
// evaluateMasks 는 공개 API 가 아니다 (P0 R1 MINOR 5).
import { evaluateMasks } from '../../src/internal.js';

/**
 * 7장 전수 분포 (133,784,560 핸드).
 *
 * evaluate7(cards) 를 1.3억 번 호출하면 배열 접근/장수 검증 비용이 지배적이라
 * 바깥 6개 레벨의 랭크/슈트 마스크를 증분으로 누적하고 안쪽에서 evaluateMasks 를 부른다.
 * 이건 evaluate7 과 같은 평가 코어이며, 아래 "일치" 테스트로 그 사실을 못박는다.
 */
describe('4.4 slow — 7장 전수', () => {
  it('4.4 evaluateMasks 경로가 evaluate7 과 100,000개 무작위 핸드에서 동일', () => {
    const rng = createRng(31337);
    const cards = [0, 0, 0, 0, 0, 0, 0];
    for (let t = 0; t < 100_000; t++) {
      const used = new Set<number>();
      for (let i = 0; i < 7; i++) {
        let c = rng.nextInt(52);
        while (used.has(c)) c = rng.nextInt(52);
        used.add(c);
        cards[i] = c;
      }
      let m1 = 0;
      let m2 = 0;
      let m3 = 0;
      let m4 = 0;
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let s3 = 0;
      for (const c of cards) {
        const b = 1 << (c >> 2);
        m4 |= m3 & b;
        m3 |= m2 & b;
        m2 |= m1 & b;
        m1 |= b;
        const s = c & 3;
        if (s === 0) s0 |= b;
        else if (s === 1) s1 |= b;
        else if (s === 2) s2 |= b;
        else s3 |= b;
      }
      expect(evaluateMasks(m1, m2, m3, m4, s0, s1, s2, s3)).toBe(evaluate7(cards));
    }
  });

  it('4.4 7장 전수 분포 (133,784,560)', () => {
    const counts = new Float64Array(9);

    const M1 = new Int32Array(8);
    const M2 = new Int32Array(8);
    const M3 = new Int32Array(8);
    const M4 = new Int32Array(8);
    const S0 = new Int32Array(8);
    const S1 = new Int32Array(8);
    const S2 = new Int32Array(8);
    const S3 = new Int32Array(8);

    let n = 0;
    const t0 = performance.now();
    for (let a = 0; a < 52; a++) {
      push(0, a);
      for (let b = a + 1; b < 52; b++) {
        push(1, b);
        for (let c = b + 1; c < 52; c++) {
          push(2, c);
          for (let d = c + 1; d < 52; d++) {
            push(3, d);
            for (let e = d + 1; e < 52; e++) {
              push(4, e);
              for (let f = e + 1; f < 52; f++) {
                push(5, f);
                const p1 = M1[6] as number;
                const p2 = M2[6] as number;
                const p3 = M3[6] as number;
                const p4 = M4[6] as number;
                const q0 = S0[6] as number;
                const q1 = S1[6] as number;
                const q2 = S2[6] as number;
                const q3 = S3[6] as number;
                for (let g = f + 1; g < 52; g++) {
                  const bit = 1 << (g >> 2);
                  const n4 = p4 | (p3 & bit);
                  const n3 = p3 | (p2 & bit);
                  const n2 = p2 | (p1 & bit);
                  const n1 = p1 | bit;
                  const s = g & 3;
                  const v = evaluateMasks(
                    n1,
                    n2,
                    n3,
                    n4,
                    s === 0 ? q0 | bit : q0,
                    s === 1 ? q1 | bit : q1,
                    s === 2 ? q2 | bit : q2,
                    s === 3 ? q3 | bit : q3,
                  );
                  const k = handCategory(v);
                  counts[k] = (counts[k] as number) + 1;
                  n++;
                }
              }
            }
          }
        }
      }
    }
    // eslint 없음: 콘솔 출력은 slow 테스트 결과 보고용
    console.log(`7-card exhaustive: ${String(n)} hands in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    console.log([...counts].map(String).join(', '));

    expect(n).toBe(133784560);
    expect([...counts]).toEqual([
      23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 41584,
    ]);

    function push(level: number, card: number): void {
      const bit = 1 << (card >> 2);
      const p1 = M1[level] as number;
      const p2 = M2[level] as number;
      const p3 = M3[level] as number;
      const p4 = M4[level] as number;
      M4[level + 1] = p4 | (p3 & bit);
      M3[level + 1] = p3 | (p2 & bit);
      M2[level + 1] = p2 | (p1 & bit);
      M1[level + 1] = p1 | bit;
      const s = card & 3;
      S0[level + 1] = (S0[level] as number) | (s === 0 ? bit : 0);
      S1[level + 1] = (S1[level] as number) | (s === 1 ? bit : 0);
      S2[level + 1] = (S2[level] as number) | (s === 2 ? bit : 0);
      S3[level + 1] = (S3[level] as number) | (s === 3 ? bit : 0);
    }
  });
});
