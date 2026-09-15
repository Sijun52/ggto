/**
 * `npm run build:solver` — 게이트 → `cargo build --locked --release` (P4.md 1절).
 *
 * `--locked` 가 필수다: 상류 `postflop-solver` 에는 `Cargo.lock` 이 없고 `bincode = "2.0.0-rc.3"`
 * 의 caret 요구가 stable 2.0.1 을 포함해서, lock 없이 풀면 오늘의 crates.io 인덱스에서
 * 2.0.1 이 뽑히고 `E0107` 로 깨진다 (스파이크 2.1). 우리 `Cargo.lock` 이 커밋돼 있으므로
 * `--locked` 는 **네트워크 인덱스 갱신 없이** 그 해석을 그대로 쓴다.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cargoBin, CRATE_DIR, runGate, VERDICT } from './solver-gate.mjs';

const LOCK = join(CRATE_DIR, 'Cargo.lock');

function main() {
  if (!existsSync(LOCK)) {
    console.error(`Cargo.lock 이 없다: ${LOCK}\n` + '커밋된 lock 없이 빌드하면 bincode 가 2.0.1 로 풀려 깨진다 (스파이크 2.1).');
    return 1;
  }

  const gate = runGate();
  console.log(`[gate] cargo tree -i windows-sys --locked → exit=${String(gate.status)} verdict=${gate.verdict}`);
  if (gate.stderr.trim() !== '') console.log(`[gate] ${gate.stderr.trim()}`);
  if (gate.verdict !== VERDICT.ABSENT) {
    console.error(`[gate] 빌드 중단: ${gate.reason}`);
    return 1;
  }

  const args = ['build', '--locked', '--release'];
  console.log(`$ cargo ${args.join(' ')}   (cwd ${CRATE_DIR})`);
  const r = spawnSync(cargoBin(), args, { cwd: CRATE_DIR, stdio: 'inherit' });
  if (r.error !== undefined && r.error !== null) {
    console.error(`cargo 를 실행할 수 없다: ${r.error.message}\nrustup GNU 호스트를 설치하고 GGTO_CARGO 또는 PATH 를 맞춰라.`);
    return 1;
  }
  return r.status ?? 1;
}

process.exit(main());
