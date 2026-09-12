/**
 * 벤치 하네스의 **게이트 논리** 테스트 (P2 R3 MINOR 2).
 *
 * `runCases` 는 `process.exit` 를 부르므로 자식 프로세스로만 검사할 수 있다. 부하는
 * `fixtures/gateRunner.mjs` 가 `os.cpus` 를 덮어써 결정적으로 만든다 — 이 게이트가
 * `npm run ci` 의 exit 코드를 정하는데, 논리가 깨져도 아무것도 잡지 못하던 상태였다.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RUNNER = fileURLToPath(new URL('./fixtures/gateRunner.mjs', import.meta.url));

interface GateJson {
  suite: string;
  load: number;
  loadExternal: number;
  cpus: number;
  loadExternalThreshold: number;
  enforced: boolean;
  strict: boolean;
  ok: boolean;
  results: { name: string; withinBudget: boolean; correct: boolean }[];
}

function run(args: string[]): { status: number; json: GateJson; stderr: string } {
  const r = spawnSync(process.execPath, [RUNNER, ...args], { encoding: 'utf8' });
  if (r.error !== undefined && r.error !== null) throw r.error;
  const json = JSON.parse(r.stdout) as GateJson;
  return { status: r.status ?? -1, json, stderr: r.stderr };
}

describe('P2 10.2 부하 인지 집행', () => {
  it('(a) 예산 초과 + 고부하 → exit 0, enforced:false (ok 는 사실대로 false)', () => {
    const { status, json, stderr } = run(['busy', 'over']);
    expect(json.load).toBe(1);
    expect(json.loadExternal).toBe(0.833); // 1 - 1/6, JSON 은 소수 3자리로 반올림한다
    expect(json.enforced).toBe(false);
    expect(json.ok).toBe(false); // P2 10.7: ok 는 측정 사실, exit 은 집행 결과
    expect(stderr).toContain('not enforced');
    expect(status).toBe(0);
  });

  it('(b) 같은 조건 + --strict → exit 1', () => {
    const { status, json } = run(['busy', 'over', '--strict']);
    expect(json.strict).toBe(true);
    expect(json.enforced).toBe(true);
    expect(status).toBe(1);
  });

  it('(d) 예산 초과 + 저부하 → exit 1 (집행)', () => {
    const { status, json, stderr } = run(['idle', 'over']);
    expect(json.load).toBe(0);
    expect(json.loadExternal).toBe(0);
    expect(json.enforced).toBe(true);
    expect(stderr).toContain('budget failure');
    expect(status).toBe(1);
  });

  it('예산 내 + 저부하 → exit 0, ok:true', () => {
    const { status, json } = run(['idle', 'pass']);
    expect(json.ok).toBe(true);
    expect(status).toBe(0);
  });
});

describe('P2 10.3 정확성 실패는 부하와 무관하게 치명적', () => {
  it('(c) check 실패 + 고부하 → exit 1', () => {
    const { status, json, stderr } = run(['busy', 'wrong']);
    expect(json.enforced).toBe(false); // 집행은 꺼져 있는데도
    expect(json.results[0]?.correct).toBe(false);
    expect(stderr).toContain('always fatal');
    expect(status).toBe(1);
  });
});

describe('P2 R3 MINOR 1 외부 부하 임계', () => {
  it('임계는 코어 수와 무관한 외부 부하 기준 0.43 이다', () => {
    const { json } = run(['idle', 'pass']);
    expect(json.loadExternalThreshold).toBe(0.43);
    expect(json.cpus).toBe(6);
  });
});
