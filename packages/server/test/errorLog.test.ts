/**
 * P3 R1 MINOR 5 (P4 12절 이월) — 500 로그 스로틀.
 *
 * 기댓값은 구현이 아니라 규칙에서 온다: "같은 `code+message` 의 **스택**은 분당 한 번".
 * 스택이 찍혔는지는 `console.error` 의 두 번째 인자가 Error 객체인지로 판정한다
 * (한 줄 로그는 인자가 하나다).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createErrorLogger, ERROR_STACK_THROTTLE_MS } from '../src/app.js';

function capture(): { calls: unknown[][]; restore: () => void } {
  const calls: unknown[][] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    calls.push(args);
  });
  return { calls, restore: () => { spy.mockRestore(); } };
}

const withStack = (calls: unknown[][]): unknown[][] => calls.filter((c) => c.length > 1 && c[1] instanceof Error);

afterEach(() => { vi.restoreAllMocks(); });

describe('P4 12 (P3 R1 MINOR 5) 500 로그 스로틀', () => {
  it('P4 12 같은 code+message 는 분당 한 번만 스택을 찍는다', () => {
    const cap = capture();
    let t = 1_000_000;
    const log = createErrorLogger(() => t);
    for (let i = 0; i < 50; i += 1) {
      t += 100;
      log(new Error('same failure'));
    }
    expect(cap.calls.length).toBe(50); // 전부 한 줄은 남는다 — 삼키지 않는다
    expect(withStack(cap.calls).length).toBe(1);
    cap.restore();
  });

  it('P4 12 임계를 넘기면 다시 스택을 찍고 억제 횟수를 남긴다', () => {
    const cap = capture();
    let t = 0;
    const log = createErrorLogger(() => t);
    log(new Error('same failure'));
    t += ERROR_STACK_THROTTLE_MS - 1;
    log(new Error('same failure'));
    t += 2;
    log(new Error('same failure'));
    expect(withStack(cap.calls).length).toBe(2);
    expect(String(cap.calls[2]?.[0])).toContain('suppressed 1');
    cap.restore();
  });

  it('P4 12 메시지가 다르면 각각 스택을 찍는다', () => {
    const cap = capture();
    const log = createErrorLogger(() => 0);
    log(new Error('a'));
    log(new Error('b'));
    log(new Error('a'));
    expect(withStack(cap.calls).length).toBe(2);
    cap.restore();
  });

  it('P4 12 Error 가 아닌 것도 삼키지 않는다', () => {
    const cap = capture();
    const log = createErrorLogger(() => 0);
    log('plain string');
    expect(withStack(cap.calls).length).toBe(1);
    cap.restore();
  });
});
