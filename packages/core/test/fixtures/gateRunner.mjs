/**
 * 하네스 게이트 논리 테스트용 러너 (P2.md 10.2 / 10.3, R3 MINOR 2).
 *
 * `os.cpus` 를 덮어써 부하를 결정적으로 만든다. 하네스는 모듈 로드 시점(SPAN_START)과
 * runCases 끝에서 한 번씩 `os.cpus()` 를 부르므로, 호출 순번에 따라 busy/idle 틱을 더하면
 * 실제 머신 상태와 무관하게 load 를 1.0 또는 0.0 으로 고정할 수 있다. 그래서 이 테스트는
 * 유휴 머신 없이도 "초과 + 저부하 → exit 1" 분기를 실행한다.
 *
 * 사용: node gateRunner.mjs <busy|idle> <over|wrong|pass> [--strict]
 */

import os from 'node:os';

const [mode, kind] = process.argv.slice(2);
const NCPU = 6; // 코어 수도 고정한다 — selfLoadShare 가 리뷰어 머신에 따라 달라지지 않도록
const TICK = 1e9;

let call = 0;
os.cpus = () => {
  // 첫 호출 = 기준점(전부 0), 이후 호출마다 busy 또는 idle 만 증가.
  const k = call++;
  const times = {
    user: mode === 'busy' ? k * TICK : 0,
    nice: 0,
    sys: 0,
    irq: 0,
    idle: mode === 'idle' ? k * TICK : 0,
  };
  return Array.from({ length: NCPU }, () => ({ model: 'fake', speed: 1, times: { ...times } }));
};

const { runCases } = await import('../../bench/harness.mjs');

const cases = [
  {
    name: 'gate case',
    // over/wrong 은 예산 0 으로 반드시 초과시킨다. pass 는 넉넉한 예산.
    budgetMs: kind === 'pass' ? 60_000 : 0.0001,
    run: () => 42,
    check: (v) => (kind === 'wrong' ? 'deliberately wrong' : v === 42 ? true : `got ${String(v)}`),
  },
];

runCases(cases, { suite: 'gate', argv: process.argv.slice(2) });
