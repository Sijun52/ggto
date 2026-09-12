/**
 * 진입점. 기본은 `127.0.0.1` 바인드다 — 개인용 로컬 앱이고 **인증이 없다** (P1.md 3.1).
 *
 * 휴대폰에서 쓰려면 같은 Wi-Fi 의 다른 기기가 이 서버에 닿아야 하므로 `GGTO_HOST` 로
 * **명시적으로** 열 수 있다 (D19 / P3M 7절). 기본값은 바꾸지 않는다: 인증이 없는 서버를
 * 기본으로 LAN 에 내놓으면 같은 네트워크의 누구나 기록을 읽고 쓸 수 있다.
 */

import { serve } from '@hono/node-server';
import { openRepository } from '@ggto/preflop';
import { openTrainer } from '@ggto/trainer';
import { existsSync, mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const DEFAULT_PORT = 7777;
const DEFAULT_HOST = '127.0.0.1';

/** 바인드 주소. `GGTO_HOST` 가 없으면 루프백 (D19). */
function resolveHost(): string {
  const raw = process.env['GGTO_HOST'];
  return raw === undefined || raw.length === 0 ? DEFAULT_HOST : raw;
}

/** 루프백 밖으로 나가는 바인드인가 (경고를 찍을지 판단) */
function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/** 같은 Wi-Fi 의 휴대폰이 칠 수 있는 주소들 */
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

function resolveWebDist(): string | null {
  const fromEnv = process.env['WEB_DIST'];
  if (fromEnv !== undefined && fromEnv.length > 0) return resolve(fromEnv);
  // dist/main.js → packages/server/dist → packages/server → packages → <repo>/web/dist
  const here = dirname(fileURLToPath(import.meta.url));
  const guess = resolve(here, '../../../web/dist');
  return existsSync(guess) ? guess : null;
}

function resolvePort(): number {
  const raw = process.env['PORT'];
  if (raw === undefined || raw.length === 0) return DEFAULT_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`PORT must be an integer in [0, 65535], got ${JSON.stringify(raw)}`);
  }
  return n;
}

/** 데이터 경로. GGTO_DATA_DIR 환경변수, 기본 <repo>/data (P2.md 1절). */
function resolveDataDir(): string {
  const fromEnv = process.env['GGTO_DATA_DIR'];
  if (fromEnv !== undefined && fromEnv.length > 0) return resolve(fromEnv);
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../data');
}

const webDist = resolveWebDist();
const dataDir = resolveDataDir();
const host = resolveHost();
// 디렉터리와 빈 DB(스키마만)는 서버가 만든다. 차트가 없으면 /api/charts 가 빈 배열을 준다.
mkdirSync(join(dataDir, 'charts'), { recursive: true });
const repo = openRepository(join(dataDir, 'ggto.db'));
// 기록은 `ggto.db` 와 **별도 파일**이다 (D16): `ggto.db` 는 `npm run seed` 로 재생성되는
// 산출물이고 트레이너 기록은 지워지면 안 되는 사용자 데이터라 수명이 다르다.
const trainer = openTrainer({ chartRepo: repo, dbPath: join(dataDir, 'trainer.db') });
const app = createApp({ webDist, repo, trainer });

serve({ fetch: app.fetch, port: resolvePort(), hostname: host }, (info) => {
  const port = String(info.port);
  console.log(`[ggto] listening on http://${host}:${port}`);
  if (!isLoopback(host)) {
    console.log('[ggto] 경고: 인증이 없다 — 신뢰하는 LAN 에서만 쓰라 (GGTO_HOST, D19)');
    for (const ip of lanAddresses()) console.log(`[ggto] 휴대폰에서: http://${ip}:${port}`);
  }
  console.log(`[ggto] web dist: ${webDist ?? '(not built — run npm run build)'}`);
  console.log(`[ggto] data dir: ${dataDir}`);
  console.log(`[ggto] trainer db: ${join(dataDir, 'trainer.db')}`);
});
