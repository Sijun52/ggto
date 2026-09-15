/**
 * 진입점. 기본은 `127.0.0.1` 바인드다 — 개인용 로컬 앱이고 **인증이 없다** (P1.md 3.1).
 *
 * 휴대폰에서 쓰려면 같은 Wi-Fi 의 다른 기기가 이 서버에 닿아야 하므로 `GGTO_HOST` 로
 * **명시적으로** 열 수 있다 (D19 / P3M 7절). 기본값은 바꾸지 않는다: 인증이 없는 서버를
 * 기본으로 LAN 에 내놓으면 같은 네트워크의 누구나 기록을 읽고 쓸 수 있다.
 *
 * **"LAN" 은 코드가 판정한다** (P3M 7절 R1 / R1 MAJOR 1): 개발 PC 의 유일한 IPv4 가
 * 공인 주소일 수 있다. 그런 PC 에서 `0.0.0.0` 바인드는 LAN 개방이 아니라 인터넷 개방이다.
 * 공인 노출은 `GGTO_ALLOW_PUBLIC=1` 이라는 두 번째 명시 opt-in 없이는 거부한다.
 */

import { serve } from '@hono/node-server';
import { openRepository } from '@ggto/preflop';
import { openTrainer } from '@ggto/trainer';
import {
  DEFAULT_CACHE_BYTES,
  DEFAULT_MEMORY_BYTES,
  JobQueue,
  PostflopSolverCli,
  SolveCache,
  resolveBin,
} from '@ggto/solver';
import { existsSync, mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { decideBind, describe, isReachableLan, lanCandidates, type InterfaceAddr } from './netAddr.js';

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

/** `os.networkInterfaces()` 평탄화. 분류는 `netAddr.ts` 의 순수 함수가 한다 (표 테스트). */
function interfaceAddrs(): InterfaceAddr[] {
  const out: InterfaceAddr[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' || a.family === 'IPv6') {
        out.push({ address: a.address, family: a.family, internal: a.internal });
      }
    }
  }
  return out;
}

function allowPublic(): boolean {
  return process.env['GGTO_ALLOW_PUBLIC'] === '1';
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

/**
 * 솔버 (P4 / D24). 바이너리가 없으면 `/api/solve*` 만 503 이고 나머지는 그대로다 —
 * Rust 툴체인이 없는 PC 에서도 앱은 뜬다. **데몬은 부팅 시 띄우지 않는다** (P4.md 5.1):
 * 첫 조회 요청이 띄운다.
 */
function openSolver(): { solver: PostflopSolverCli; queue: JobQueue; cache: SolveCache } | null {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const bin = resolveBin(repoRoot);
  if (bin === null) return null;
  const solver = new PostflopSolverCli({ bin });
  const cache = new SolveCache({
    dir: join(dataDir, 'solves'),
    capBytes: envBytes('GGTO_SOLVE_CACHE_BYTES', DEFAULT_CACHE_BYTES),
    // 무효화 훅은 `solveRoutes` 가 건다 (P4 R1 MAJOR 3) — 라우트가 캐시와 솔버를 둘 다 안다.
  });
  // 기동 정리는 여기서만 한다 (P4.md 7절). 데몬은 안 띄운다.
  const report = cache.repair();
  const cleaned = report.partsRemoved.length + report.orphanBinsRemoved.length + report.orphanRowsRemoved.length;
  if (cleaned > 0) {
    console.log(
      `[ggto] solve cache repair: .part ${String(report.partsRemoved.length)} · orphan .bin ${String(report.orphanBinsRemoved.length)} · orphan rows ${String(report.orphanRowsRemoved.length)}`,
    );
  }
  const queue = new JobQueue({ solver, memoryBytes: envBytes('GGTO_SOLVE_MEMORY_BYTES', DEFAULT_MEMORY_BYTES) });
  return { solver, queue, cache };
}

function envBytes(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number of bytes, got ${JSON.stringify(raw)}`);
  return n;
}

const solve = openSolver();
const app = createApp({ webDist, repo, trainer, solve });

// 바인드 **전에** 대역을 판정한다. 거부는 exit 1 — 열린 뒤에 경고해 봐야 늦다.
const decision = decideBind({ host, addrs: interfaceAddrs(), allowPublic: allowPublic() });
if (!decision.ok) {
  console.error(`[ggto] 기동 거부: ${decision.reason}`);
  for (const line of decision.detail) console.error(`[ggto]   ${line}`);
  console.error('[ggto] 이 서버에는 인증이 없다 — 기록 읽기/쓰기가 그대로 열린다 (D19).');
  console.error('[ggto] 휴대폰에서 쓰려면 `npm run start:lan` (사설 주소에만 바인드).');
  console.error('[ggto] 정말 공인 IP 에 열려면 GGTO_ALLOW_PUBLIC=1 을 명시하라 — 권장하지 않는다.');
  process.exit(1);
}

serve({ fetch: app.fetch, port: resolvePort(), hostname: host }, (info) => {
  const port = String(info.port);
  console.log(`[ggto] listening on http://${host}:${port}`);
  if (!isLoopback(host)) {
    console.log('[ggto] 경고: 인증이 없다 — 신뢰하는 LAN 에서만 쓰라 (GGTO_HOST, D19)');
    if (decision.exposedPublic.length > 0 && allowPublic()) {
      console.warn('[ggto] !!! GGTO_ALLOW_PUBLIC=1 로 공인 IP 노출을 허용했다 !!!');
      for (const line of decision.exposedPublic) console.warn(`[ggto] !!!   ${line} — 인터넷에서 닿을 수 있다`);
      console.warn('[ggto] !!! 인증이 없다. 지금 이 PC 의 트레이너 기록은 누구나 읽고 쓸 수 있다 !!!');
    }
    // 안내 주소는 **사설 대역만**. 공인 IP 를 "휴대폰에서:" 로 찍으면 사용자가 그것을
    // LAN 주소로 믿는다 (R1 MAJOR 1).
    const lan = isReachableLan(decision.kind)
      ? [{ address: host, family: host.includes(':') ? ('IPv6' as const) : ('IPv4' as const) }]
      : lanCandidates(interfaceAddrs()).map((a) => ({ address: a.address, family: a.family }));
    if (lan.length === 0) {
      console.log('[ggto] 안내할 사설 LAN 주소가 없다 — 발견된 주소:');
      for (const line of describe(interfaceAddrs())) console.log(`[ggto]   ${line}`);
    } else {
      for (const a of lan) {
        const shown = a.family === 'IPv6' ? `[${a.address}]` : a.address;
        console.log(`[ggto] 휴대폰에서: http://${shown}:${port}`);
      }
    }
  }
  console.log(`[ggto] web dist: ${webDist ?? '(not built — run npm run build)'}`);
  console.log(`[ggto] data dir: ${dataDir}`);
  console.log(`[ggto] trainer db: ${join(dataDir, 'trainer.db')}`);
  console.log(
    solve === null
      ? '[ggto] solver: (not built — npm run build:solver). /api/solve is 503, everything else works'
      : `[ggto] solver: ${solve.solver.id} · cache ${join(dataDir, 'solves')} · memory cap ${String(Math.round(solve.queue.memoryCap / 1024 ** 3))}GB`,
  );
});

// 상주 조회 데몬을 남기지 않는다 (P3M R2 MINOR 6 의 교훈: 잔여 프로세스는 낡은 빌드를 검사하게 만든다).
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void (async (): Promise<void> => {
      if (solve !== null) await solve.solver.shutdown();
      process.exit(0);
    })();
  });
}
