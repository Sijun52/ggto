/**
 * 세션 시드 → 문항별 rng 시드 (P3.md 5.3 R2). `service.ts` 에서 떼어냈다 (P3 R1 MINOR 3).
 *
 * 서비스 클래스의 책임(세션 수명·저장소 조율)과 무관한 순수 산술이라 파일이 다르다.
 */

/**
 * splitmix32 의 finalizer 한 스텝. 비선형(곱셈 + xorshift)이라 입력의 1비트 차이가
 * 출력 전체로 번진다.
 */
function mix32(x: number): number {
  let t = x | 0;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
  return (t ^ (t >>> 15)) >>> 0;
}

/**
 * 세션 seed 와 문항 번호를 섞어 draw 별 rng 시드를 만든다 (P3.md 5.3 R2).
 *
 * **seed 를 먼저 비선형으로 섞은 뒤** index 를 더하고 다시 섞는다. R1 의 `(seed ^ C) ^ index`
 * 는 XOR 선형이라 `drawSeed(s, i) = drawSeed(s ^ i, 0)` 이 성립했고, 그래서 인접 시드 세션이
 * 같은 스팟 집합을 뽑았다 (시드 5000/5001 의 50문항 집합 교집합 46). 덧셈은 XOR 과 다른
 * 군이라 이 항등식이 깨진다 (P3 R1 MAJOR 2).
 */
export function drawSeed(seed: number, index: number): number {
  return mix32((mix32(seed) + Math.imul(index + 1, 0x9e3779b9)) | 0);
}
