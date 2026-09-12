import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/slow/**'],
    // 전수 열거 테스트(5장 2.6M, 턴 270k)가 기본 스위트에 있으므로 넉넉히 잡는다.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
