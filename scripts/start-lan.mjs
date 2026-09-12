/**
 * `npm run start:lan` — LAN 바인드로 서버를 띄운다 (P3M 7절 / D19).
 *
 * `GGTO_HOST=0.0.0.0 npm start` 를 Windows cmd 가 이해하지 못하고 `cross-env` 는
 * 새 의존성이라 (P3M 2절: 새 npm 의존성 0) node 래퍼로 환경변수를 주입한다.
 *
 * **인증이 없다.** 이 스크립트는 같은 Wi-Fi 의 모든 기기에 트레이너 기록 읽기/쓰기를
 * 연다. 신뢰하는 네트워크에서만 쓰라.
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(repoRoot, 'packages/server/dist/main.js');

const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, GGTO_HOST: process.env.GGTO_HOST ?? '0.0.0.0' },
});

child.on('exit', (code, signal) => {
  process.exit(signal === null ? (code ?? 0) : 1);
});
