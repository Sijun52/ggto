/**
 * `cargo tree -i windows-sys --locked` 3분기 게이트 (P4.md 1절 / 스파이크 3절 R3).
 *
 * **왜 exit 코드만 보면 안 되나**: 패키지가 의존 그래프에 없으면 cargo 는 빈 출력이 아니라
 * **에러**(exit 101 + `did not match any packages`)를 낸다. `cargo tree -i X; [ $? -ne 0 ]`
 * 처럼 exit 코드만 보는 게이트는 매니페스트 오류·네트워크 실패까지 "통과"로 새게 한다.
 *
 * | 결과 | 의미 | 판정 |
 * |---|---|---|
 * | exit != 0 **이고** stderr 에 `did not match any packages` | 그래프에 없음 | 통과 |
 * | exit 0 (역의존 트리 출력) | 실제로 끌어온다 | 실패 — MSYS2 binutils 전제 발동 |
 * | 그 밖의 exit != 0 | 판정 불능 | 게이트 오류로 빌드 중단 |
 *
 * `windows-sys` 가 들어오면 GNU 호스트의 번들 `dlltool` 이 import library 를 만들지 못해
 * 빌드가 깨진다 (스파이크 3절 실측). 그러니 `clap`·`tokio` 류를 넣는 순간 이 게이트가 잡는다.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CRATE_DIR = join(REPO_ROOT, 'solver/ggto-solver-cli');

export const VERDICT = {
  /** 의존 그래프에 없다 — 빌드해도 된다 */
  ABSENT: 'absent',
  /** 실제로 끌어온다 — 빌드 중단 */
  PRESENT: 'present',
  /** 판정 불능 — 빌드 중단 (조용히 통과시키지 않는다) */
  UNDECIDED: 'undecided',
};

/**
 * `cargo tree` 의 (status, stderr) 를 판정한다. 순수 함수라 표 테스트가 가능하다
 * — 실제 cargo 를 돌리지 않고도 세 분기를 전부 검사한다 (P4.md 8.2).
 */
export function classify({ status, stderr }) {
  const text = stderr ?? '';
  if (status === 0) return { verdict: VERDICT.PRESENT, reason: 'cargo tree -i windows-sys 가 역의존 트리를 출력했다' };
  if (text.includes('did not match any packages')) {
    return { verdict: VERDICT.ABSENT, reason: 'did not match any packages' };
  }
  return {
    verdict: VERDICT.UNDECIDED,
    reason: `cargo tree 가 exit ${String(status)} 로 실패했는데 "did not match any packages" 가 아니다`,
  };
}

/** rustup 을 PATH 를 건드리지 않고 깔았을 수 있다 (P4 설치 기록). 홈의 표준 위치도 본다. */
export function cargoBin() {
  const fromEnv = process.env.GGTO_CARGO;
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  const home = join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
  if (existsSync(home)) return home;
  return 'cargo';
}

export function runGate() {
  const r = spawnSync(cargoBin(), ['tree', '-i', 'windows-sys', '--locked'], {
    cwd: CRATE_DIR,
    encoding: 'utf8',
  });
  if (r.error !== undefined && r.error !== null) {
    return {
      verdict: VERDICT.UNDECIDED,
      reason: `cargo 를 실행할 수 없다: ${r.error.message}`,
      stdout: '',
      stderr: '',
      status: null,
    };
  }
  return { ...classify(r), stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

function main() {
  const r = runGate();
  console.log(`$ cargo tree -i windows-sys --locked   (cwd ${CRATE_DIR})`);
  console.log(`exit=${String(r.status)}`);
  if (r.stdout.trim() !== '') console.log(r.stdout.trim());
  if (r.stderr.trim() !== '') console.log(r.stderr.trim());
  console.log(`verdict=${r.verdict}  (${r.reason})`);
  if (r.verdict === VERDICT.ABSENT) {
    console.log('gate OK — windows-sys 는 의존 그래프에 없다');
    return 0;
  }
  if (r.verdict === VERDICT.PRESENT) {
    console.error(
      'gate FAIL — windows-sys 가 들어왔다. GNU 호스트의 번들 dlltool 이 import library 를 만들지 못한다\n' +
        '            (스파이크 3절). clap/tokio 류 의존을 빼거나 MSYS2 mingw-w64-x86_64-binutils 를 전제로 삼아라.',
    );
    return 1;
  }
  console.error('gate ERROR — 판정 불능이라 빌드를 중단한다 (조용한 통과 금지)');
  return 1;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('solver-gate.mjs')) {
  process.exit(main());
}
