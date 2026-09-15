/**
 * `npm run test:solver` — `cargo test --locked` + `packages/solver` 통합 테스트 (P4.md 1절).
 *
 * `npm run ci` 와 **분리**한 이유: Rust 툴체인이 없는 PC 에서도 `npm run ci` 가 exit 0 이어야
 * 한다 (P4.md 0절 4). TS 쪽 계약은 `FakeSolver`/`fake-daemon` 이 `ci` 안에서 검사한다.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cargoBin, CRATE_DIR, REPO_ROOT } from './solver-gate.mjs';

function run(label, cmd, args, opts = {}) {
  console.log(`\n$ ${label}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error !== undefined && r.error !== null) {
    console.error(`${label} 를 실행할 수 없다: ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}

function main() {
  const cargoStatus = run('cargo test --locked --release', cargoBin(), ['test', '--locked', '--release'], {
    cwd: CRATE_DIR,
  });
  if (cargoStatus !== 0) return cargoStatus;

  const bin = join(CRATE_DIR, 'target/release', process.platform === 'win32' ? 'ggto-solver-cli.exe' : 'ggto-solver-cli');
  if (!existsSync(bin)) {
    console.error(`빌드된 바이너리가 없다: ${bin}. npm run build:solver 를 먼저.`);
    return 1;
  }
  return run(
    'vitest run (GGTO_SOLVER_INTEGRATION=1)',
    process.execPath,
    [join(REPO_ROOT, 'node_modules/vitest/vitest.mjs'), 'run', 'test/integration.test.ts'],
    {
      cwd: join(REPO_ROOT, 'packages/solver'),
      env: { ...process.env, GGTO_SOLVER_INTEGRATION: '1', GGTO_SOLVER_BIN: bin },
    },
  );
}

process.exit(main());
