/**
 * `npm run start:lan` — **사설 LAN 주소 하나에** 바인드해 서버를 띄운다 (P3M 7절 R1 / D19).
 *
 * `GGTO_HOST=… npm start` 를 Windows cmd 가 이해하지 못하고 `cross-env` 는 새 의존성이라
 * (P3M 2절: 새 npm 의존성 0) node 래퍼로 환경변수를 주입한다.
 *
 * **`0.0.0.0` 을 쓰지 않는다** (R1 MAJOR 1): 이 레포를 만든 PC 의 유일한 IPv4 가 공인
 * `61.82.129.232/26` 이었고, 와일드카드 바인드는 그 주소까지 열어 인증 없는 트레이너
 * 기록을 인터넷에 내놓았다. 사설 주소(10/8 · 172.16/12 · 192.168/16 · fc00::/7 ·
 * 100.64/10 오버레이) 가 없으면 **기동을 거부**한다.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(repoRoot, 'packages/server/dist/main.js');
// 분류는 서버와 **같은 함수**를 쓴다 — 두 벌로 관리하면 갈라진다.
const netAddrUrl = new URL('../packages/server/dist/netAddr.js', import.meta.url);

if (!existsSync(entry)) {
  console.error(`[ggto] 서버가 빌드되지 않았다: ${entry}`);
  console.error('[ggto] npm run build 를 먼저 실행하라.');
  process.exit(1);
}

const { chooseLanHost, describe } = await import(netAddrUrl.href);

function flatAddrs() {
  const out = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' || a.family === 'IPv6') {
        out.push({ address: a.address, family: a.family, internal: a.internal });
      }
    }
  }
  return out;
}

const addrs = flatAddrs();
const choice = chooseLanHost(addrs, process.env.GGTO_HOST);

if (!choice.ok) {
  console.error('[ggto] start:lan 기동 거부.');
  console.error(`[ggto] 이유: ${choice.reason}`);
  console.error('[ggto] 이 PC 의 인터페이스 주소:');
  for (const line of choice.detail) console.error(`[ggto]   ${line}`);
  console.error('[ggto]');
  console.error('[ggto] 이 서버에는 **인증이 없다**. 공인 IP 에 바인드하면 트레이너 기록');
  console.error('[ggto] 읽기/쓰기가 인터넷의 누구에게나 열린다 (D19).');
  console.error('[ggto] 휴대폰에서 쓰려면 PC 를 사설 대역의 Wi-Fi 공유기 뒤에 두거나,');
  console.error('[ggto] Tailscale 류 오버레이(100.64/10) 를 쓰라.');
  console.error('[ggto] 그래도 강행하려면: GGTO_HOST=<주소> GGTO_ALLOW_PUBLIC=1 npm start');
  process.exit(1);
}

if (choice.candidates.length > 1) {
  console.log('[ggto] 사설 주소가 여러 개다 — GGTO_HOST 로 고를 수 있다:');
  for (const a of choice.candidates) console.log(`[ggto]   ${a.address} (${a.family}, ${a.kind})`);
}
const hidden = describe(addrs).filter((line) => line.includes('public'));
if (hidden.length > 0) {
  console.log('[ggto] 참고: 이 PC 의 공인 주소는 바인드하지 않는다 —');
  for (const line of hidden) console.log(`[ggto]   ${line}`);
}
console.log(`[ggto] start:lan → ${choice.host} (${choice.kind}) 에만 바인드한다.`);

const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, GGTO_HOST: choice.host },
});

child.on('exit', (code, signal) => {
  process.exit(signal === null ? (code ?? 0) : 1);
});
