/**
 * 자식 프로세스 러너 (P3.md 13 "답 처리 중 프로세스 kill").
 *
 * `recordAnswer` 의 **트랜잭션 한가운데**, 즉 `attempt` INSERT 는 실행됐고 `srs_state`
 * UPSERT 는 아직인 지점에서 자기 자신을 SIGKILL 한다. 지점을 결정적으로 잡기 위해
 * `srs` 객체의 `ease` 게터를 덫으로 쓴다 — `recordAnswer` 가 srs 문을 실행하려고 인자를
 * 읽는 순간이 곧 그 지점이다. 소스에 테스트용 훅을 심지 않고 진짜 구현을 그대로 돌린다.
 *
 * 사용: node killRunner.mjs <dbPath> <sessionId> <spotKey> <now> <mode>
 *   mode = mid   : 트랜잭션 중간에서 kill (커밋 전)
 *   mode = after : 커밋이 끝난 직후 kill (같은 kill 인데 결과가 반대여야 한다)
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIST = new URL('../../dist/index.js', import.meta.url);
if (!existsSync(fileURLToPath(DIST))) {
  throw new Error('packages/trainer/dist 가 없다. npm run build:libs 를 먼저 돌려라.');
}
const { TrainerStore } = await import(DIST.href);

const [dbPath, sessionIdRaw, spotKey, nowRaw, mode] = process.argv.slice(2);
const sessionId = Number(sessionIdRaw);
const now = Number(nowRaw);

const store = new TrainerStore(dbPath);
const attempt = {
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
  createdAt: now,
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
    process.kill(process.pid, 'SIGKILL');
    return 2.6;
  },
};

store.recordAnswer(attempt, mode === 'mid' ? poisoned : plain, spotKey);
if (mode === 'mid') {
  // 여기 도달했다면 덫이 안 걸린 것이다 — 조용히 성공한 척하면 안 된다.
  process.exit(3);
}
process.kill(process.pid, 'SIGKILL');
