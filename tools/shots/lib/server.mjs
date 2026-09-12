/**
 * 검사용 서버 확보. 이미 떠 있으면 그것을 쓰고, 아니면 직접 띄운다.
 *
 * `GGTO_BASE_URL` 로 다른 주소를 지정할 수 있다. 직접 띄울 때는 레포의 `data/` 를 그대로
 * 쓴다 — 차트가 없으면 격자를 검사할 수 없으므로 `npm run seed` 가 선행 조건이다.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

async function health(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ensureServer() {
  const fromEnv = process.env.GGTO_BASE_URL;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    if (!(await health(fromEnv))) throw new Error(`GGTO_BASE_URL 이 응답하지 않는다: ${fromEnv}`);
    return { baseUrl: fromEnv, stop: () => undefined };
  }

  const existing = 'http://127.0.0.1:7777';
  if (await health(existing)) return { baseUrl: existing, stop: () => undefined };

  const entry = resolve(REPO_ROOT, 'packages/server/dist/main.js');
  const webDist = resolve(REPO_ROOT, 'web/dist');
  if (!existsSync(entry)) throw new Error(`서버가 빌드되지 않았다 (${entry}). npm run build 를 먼저.`);
  if (!existsSync(webDist)) throw new Error(`web/dist 가 없다. npm run build 를 먼저.`);
  if (!existsSync(resolve(REPO_ROOT, 'data/ggto.db'))) {
    throw new Error('data/ggto.db 가 없다. npm run seed 를 먼저.');
  }

  const port = Number(process.env.GGTO_SHOTS_PORT ?? '7791');
  const child = spawn(process.execPath, [entry], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port), GGTO_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => logs.push(d));
  child.stderr.on('data', (d) => logs.push(d));

  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (await health(baseUrl)) break;
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`서버 기동 실패:\n${logs.join('')}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    baseUrl,
    stop: () => {
      child.kill();
    },
  };
}

/** 첫 차트셋 id (뷰어 URL 에 필요) */
export async function firstChartSetId(baseUrl) {
  const res = await fetch(`${baseUrl}/api/charts`);
  if (!res.ok) throw new Error(`GET /api/charts ${String(res.status)}`);
  const body = await res.json();
  const id = body.sets?.[0]?.id;
  if (id === undefined) throw new Error('차트셋이 없다. npm run seed 를 먼저.');
  return id;
}
