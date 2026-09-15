/**
 * P4.md 8.2 — `windows-sys` 게이트의 **3분기 판정** (스파이크 3절 R3).
 *
 * `cargo tree` 를 실제로 돌리지 않고 (status, stderr) 를 직접 준다. 요점은
 * "exit 코드만 보면 매니페스트 오류·네트워크 실패가 **통과로 샌다**" 는 것이다.
 */

import { describe, expect, it } from 'vitest';
import { classify, VERDICT } from '../../../scripts/solver-gate.mjs';

describe('P4 1 windows-sys 게이트', () => {
  it('P4 1 exit != 0 + "did not match any packages" → 통과', () => {
    const r = classify({ status: 101, stderr: 'error: package ID specification `windows-sys` did not match any packages\n' });
    expect(r.verdict).toBe(VERDICT.ABSENT);
  });

  it('P4 1 exit 0 (역의존 트리 출력) → 실패', () => {
    const r = classify({ status: 0, stderr: '' });
    expect(r.verdict).toBe(VERDICT.PRESENT);
  });

  it('P4 1 그 밖의 exit != 0 → 게이트 오류 (조용한 통과 금지)', () => {
    for (const stderr of [
      'error: failed to parse manifest at `Cargo.toml`',
      'error: failed to get `postflop-solver` as a dependency (network)',
      '',
    ]) {
      const r = classify({ status: 101, stderr });
      expect(r.verdict).toBe(VERDICT.UNDECIDED);
    }
  });

  it('P4 1 exit 코드만 보는 게이트였다면 세 번째 분기가 통과로 샌다', () => {
    // 이 테스트가 게이트의 존재 이유다. `[ $? -ne 0 ]` 로는 아래 둘이 구분되지 않는다.
    // 두 입력은 **종료 코드가 같다** (101). 판정이 갈리는 것은 stderr 를 읽기 때문이다.
    const absent = classify({ status: 101, stderr: 'did not match any packages' });
    const broken = classify({ status: 101, stderr: 'error: failed to parse manifest' });
    expect(absent.verdict).toBe(VERDICT.ABSENT);
    expect(broken.verdict).toBe(VERDICT.UNDECIDED);
  });
});
