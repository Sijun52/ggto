/**
 * 자식 프로세스 러너 (P3.md 13 "답 처리 중 프로세스 kill").
 *
 * `recordAnswer` 의 **트랜잭션 한가운데**, 즉 `attempt` INSERT 는 실행됐고 `srs_state`
 * UPSERT 는 아직인 지점에서 자기 자신을 SIGKILL 한다. 지점을 결정적으로 잡기 위해
 * `srs` 객체의 `ease` 게터를 덫으로 쓴다 — `recordAnswer` 가 srs 문을 실행하려고 인자를
 * 읽는 순간이 곧 그 지점이다. 소스에 테스트용 훅을 심지 않고 진짜 구현을 그대로 돌린다.
 *
 * **왜 종료 코드만으로는 부족한가 (P3 R2 MINOR 1)**: Windows 에서 `process.kill(pid,'SIGKILL')`
 * 은 `TerminateProcess` 라 `status = 1 · signal = null` 로 보인다. 그런데 러너가 그냥
 * 예외를 던져도 `status = 1` 이다. 즉 "덫이 걸려 죽었다" 와 "아무것도 못 하고 터졌다" 가
 * 부모에게 같은 모양으로 보인다 — 테스트가 통과해도 아무것도 증명하지 못한다. 그래서:
 *   - 덫이 걸리기 **직전에 마커 파일**을 동기로 쓴다 (도달 증거),
 *   - attempt 객체의 **마지막으로 읽히는 필드에 게터**를 달아 INSERT 바인딩이 srs 바인딩보다
 *     먼저 일어났음을 순서 플래그로 남긴다,
 *   - 모든 비정상 종료에 **고유 exit 코드**를 준다 (3·4·5).
 *
 * 사용: node killRunner.mjs <dbPath> <sessionId> <spotKey> <now> <mode> <markerPath>
 *   mode = mid   : 트랜잭션 중간에서 kill (커밋 전)
 *   mode = after : 커밋이 끝난 직후 kill (같은 kill 인데 결과가 반대여야 한다)
 *
 * exit 코드: 0 = kill 이 아예 안 일어남 · 3 = 덫 미발동 · 4 = 예외로 죽음 · 5 = 낡은 dist.
 * 정상(= 덫 발동 후 SIGKILL)은 이 중 어느 것도 아니다.
 */

import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 예외로 죽는 것과 SIGKILL 로 죽는 것을 부모가 구분할 수 있게 한다.
process.on('uncaughtException', (e) => {
  process.stderr.write(`killRunner uncaught: ${String(e && e.stack ? e.stack : e)}\n`);
  process.exit(4);
});
process.on('unhandledRejection', (e) => {
  process.stderr.write(`killRunner unhandled rejection: ${String(e)}\n`);
  process.exit(4);
});

const DIST = new URL('../../dist/index.js', import.meta.url);
const distPath = fileURLToPath(DIST);
if (!existsSync(distPath)) {
  process.stderr.write('packages/trainer/dist 가 없다. npm run build:libs 를 먼저 돌려라.\n');
  process.exit(5);
}

// **낡은 dist 로 조용히 통과하지 않는다 (P3 R2 MINOR 2)**: 이 러너는 소스가 아니라
// 빌드 산출물을 부른다. `store.ts` 를 고치고 빌드하지 않으면 이 테스트는 옛 트랜잭션
// 경계를 검사하면서 초록불을 준다 — 회귀 테스트로서 가치가 0 이 된다.
const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));
function newestMtime(dir) {
  let newest = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    newest = Math.max(newest, e.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return newest;
}
const srcMtime = newestMtime(SRC_DIR);
const distMtime = statSync(distPath).mtimeMs;
if (srcMtime > distMtime) {
  process.stderr.write(
    `낡은 dist: src 가 ${String(Math.round((srcMtime - distMtime) / 1000))}s 더 새롭다. npm run build:libs 를 먼저 돌려라.\n`,
  );
  process.exit(5);
}

const { TrainerStore } = await import(DIST.href);

const [dbPath, sessionIdRaw, spotKey, nowRaw, mode, markerPath] = process.argv.slice(2);
const sessionId = Number(sessionIdRaw);
const now = Number(nowRaw);
if (markerPath === undefined) {
  process.stderr.write('markerPath 인자가 없다\n');
  process.exit(5);
}

/** 덫이 어디까지 갔는지의 기록. SIGKILL 직전에 동기로 쓴다 (kill 뒤에는 못 쓴다). */
const trace = { mode, attemptBound: false, srsBound: false };
function writeMarker() {
  writeFileSync(markerPath, JSON.stringify(trace), 'utf8');
}

const baseAttempt = {
  sessionId,
  spotKey,
  contentHash: spotKey.split(':')[1],
  seq: '',
  combo: spotKey.slice(-4),
  heroPos: 'SB',
  category: 'open',
  chosenAction: 'A',
  chosenFreq: 1,
  gradedBy: 'ev',
  evLossBb: 0,
  verdict: 'Perfect',
  mixed: false,
  msTaken: 1234,
};
// `createdAt` 은 attempt 바인딩에서 읽히는 필드다. 게터로 "attempt 가 바인딩됐다" 를 찍어
// 두면 srs 게터가 터질 때 **순서**(INSERT 먼저 → srs 나중)를 마커로 증명할 수 있다.
const attempt = {
  ...baseAttempt,
  get createdAt() {
    trace.attemptBound = true;
    return now;
  },
};
const plain = {
  ease: 2.6,
  intervalDays: 1,
  reps: 1,
  lapses: 0,
  dueAt: now + 86_400_000,
  lastVerdict: 'Perfect',
  updatedAt: now,
};
const poisoned = {
  ...plain,
  get ease() {
    // attempt INSERT 는 이미 실행됐고 COMMIT 은 아직이다. 여기서 프로세스가 사라진다.
    trace.srsBound = true;
    writeMarker();
    process.kill(process.pid, 'SIGKILL');
    return 2.6;
  },
};

new TrainerStore(dbPath).recordAnswer(attempt, mode === 'mid' ? poisoned : plain, spotKey);
if (mode === 'mid') {
  // 여기 도달했다면 덫이 안 걸린 것이다 — 조용히 성공한 척하면 안 된다.
  writeMarker();
  process.exit(3);
}
writeMarker();
process.kill(process.pid, 'SIGKILL');
// SIGKILL 이 안 먹었다 (= kill 이 아예 일어나지 않았다).
process.exit(0);
