/**
 * 스모크. P1.md 5절.
 *
 * 빌드 산출물로 서버를 자식 프로세스로 띄우고 진짜 HTTP 로 두드린다.
 * (인프로세스 테스트가 통과해도 dist 가 깨졌거나 정적 경로가 틀리면 앱은 안 뜬다.)
 */

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, '..');
const repoRoot = resolve(serverRoot, '../..');
const mainJs = resolve(serverRoot, 'dist/main.js');
const webDist = resolve(repoRoot, 'web/dist');

const PORT = 7800 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * 스모크는 **임시 데이터 디렉터리**에서 돈다 (P3.md 7): 트레이너 세션을 실제로 만들기
 * 때문에 사용자의 `data/trainer.db` 에 스모크 기록이 섞이면 안 된다. 차트 DB 는 읽기
 * 전용으로 쓰이므로 복사해 와서 시드가 있는 상태의 경로도 함께 검사한다.
 */
const dataDir = mkdtempSync(join(tmpdir(), 'ggto-smoke-'));
mkdirSync(join(dataDir, 'charts'), { recursive: true });
const realData = resolve(repoRoot, 'data');
if (existsSync(realData)) {
  // WAL 파일까지 같이 복사해야 마지막 커밋이 보인다.
  for (const f of readdirSync(realData).filter((f) => f.startsWith('ggto.db'))) {
    copyFileSync(join(realData, f), join(dataDir, f));
  }
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail ?? '' });
}

async function getJson(path) {
  const res = await fetch(BASE + path);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, text, headers: res.headers };
}

async function postJson(path, payload) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, text };
}

async function waitForHealth(child, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // 아직 리슨 전. 아래에서 재시도한다.
    }
    if (Date.now() > deadline) throw new Error(`server did not become healthy in ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function run() {
  if (!existsSync(mainJs)) throw new Error(`missing ${mainJs} — run npm run build first`);
  if (!existsSync(webDist)) throw new Error(`missing ${webDist} — run npm run build first`);

  const child = spawn(process.execPath, [mainJs], {
    env: { ...process.env, PORT: String(PORT), WEB_DIST: webDist, GGTO_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (b) => (serverLog += b.toString()));
  child.stderr.on('data', (b) => (serverLog += b.toString()));

  try {
    await waitForHealth(child);

    // 1. health
    const health = await getJson('/api/health');
    check('health 200 ok:true', health.status === 200 && health.body?.ok === true, JSON.stringify(health.body));

    // 2. parse
    const parse = await postJson('/api/range/parse', { text: '22+,A2s+,KTo+' });
    check(
      'parse 22+,A2s+,KTo+ → 162 combos / 1326 weights',
      parse.status === 200 && parse.body?.comboCount === 162 && parse.body?.weights?.length === 1326,
      `status=${parse.status} combos=${parse.body?.comboCount} len=${parse.body?.weights?.length}`,
    );

    // 3. parse 에러 봉투
    const bad = await postJson('/api/range/parse', { text: 'T9s+' });
    check(
      'parse T9s+ → 400 RangeSyntaxError',
      bad.status === 400 && bad.body?.error?.code === 'RangeSyntaxError',
      `status=${bad.status} code=${bad.body?.error?.code}`,
    );

    // 4. equity (AA vs KK 프리플랍 = 포커 이론상 81.9%)
    const eq = await postJson('/api/range/equity', {
      hero: 'AA',
      villain: 'KK',
      board: '',
      mode: 'monte-carlo',
      samples: 200000,
      seed: 1,
    });
    check(
      'equity AA vs KK MC seed 1 → hero in [0.814, 0.825]',
      eq.status === 200 && eq.body?.hero > 0.814 && eq.body?.hero < 0.825,
      `status=${eq.status} hero=${eq.body?.hero}`,
    );

    // 5. SPA + 번들
    const index = await getJson('/');
    const isHtml =
      index.status === 200 &&
      (index.headers.get('content-type') ?? '').includes('text/html') &&
      index.text.includes('<div id="root">');
    check('GET / → text/html with <div id="root">', isHtml, `status=${index.status}`);

    const assetMatch = index.text.match(/\/assets\/[A-Za-z0-9._-]+\.js/);
    if (assetMatch === null) {
      check('index.html references an /assets/*.js bundle', false, 'no asset reference found');
    } else {
      const asset = await getJson(assetMatch[0]);
      // 격자 데이터가 core 에서 나온다는 증거: 1326 콤보 공간이 번들에 들어 있어야 한다.
      // (169 하드코딩 격자라면 이 리터럴이 필요 없다.)
      const hasCore = asset.text.includes('HAND_CLASS_COUNT') || asset.text.includes('1326');
      check(
        `GET ${assetMatch[0]} → 200 and contains core combo-space code`,
        asset.status === 200 && hasCore,
        `status=${asset.status} hasCore=${hasCore}`,
      );
    }

    // 6. 차트 API (P2.md 8). 시드 전이면 빈 배열이어야 한다 — 503 이 아니다.
    const charts = await getJson('/api/charts');
    const sets = charts.body?.sets;
    check(
      'GET /api/charts → 200 + 배열 (시드가 없어도 200, 있으면 목록)',
      charts.status === 200 && Array.isArray(sets),
      `status=${charts.status} sets=${JSON.stringify(sets)?.slice(0, 80)}`,
    );
    if (Array.isArray(sets) && sets.length > 0) {
      const id = sets[0].id;
      const node = await getJson(`/api/charts/${id}/node`);
      check(
        `GET /api/charts/${id}/node → strategy[0].length === 1326`,
        node.status === 200 && node.body?.strategy?.[0]?.length === 1326 && node.body?.reach?.length === 1326,
        `status=${node.status} len=${node.body?.strategy?.[0]?.length} reach=${node.body?.reach?.length}`,
      );
      const range = await getJson(`/api/charts/${id}/range?pos=${encodeURIComponent(sets[0].config.positions[0])}`);
      check(
        `GET /api/charts/${id}/range → 1326 weights`,
        range.status === 200 && range.body?.weights?.length === 1326,
        `status=${range.status} len=${range.body?.weights?.length}`,
      );
    } else {
      console.log('NOTE  /api/charts is empty (run npm run seed to exercise the node/range checks)');
    }

    // 7. 트레이너 (P3.md 7). 세션 1문제 → next → answer → done.
    const pool = await getJson('/api/trainer/pool');
    check(
      'GET /api/trainer/pool → 200 + 카테고리 목록',
      pool.status === 200 && Array.isArray(pool.body?.categories),
      `status=${pool.status} categories=${JSON.stringify(pool.body?.categories)}`,
    );
    if (Array.isArray(sets) && sets.length > 0) {
      const session = await postJson('/api/trainer/session', { count: 1, seed: 1 });
      check(
        'POST /api/trainer/session → 200 sessionId',
        session.status === 200 && Number.isInteger(session.body?.sessionId),
        `status=${session.status} body=${JSON.stringify(session.body)?.slice(0, 120)}`,
      );
      const sid = session.body?.sessionId;
      const next = await getJson(`/api/trainer/next?session=${sid}`);
      const spot = next.body?.spot;
      check(
        'GET /api/trainer/next → spot without strategy/ev/reach',
        next.status === 200 &&
          next.body?.done === false &&
          typeof spot?.spotKey === 'string' &&
          !next.text.includes('strategy') &&
          !next.text.includes('"ev":') &&
          !next.text.includes('reach'),
        `status=${next.status} len=${next.text.length}`,
      );
      const answer = await postJson('/api/trainer/answer', {
        sessionId: sid,
        spotKey: spot?.spotKey,
        action: spot?.actions?.[0],
        msTaken: 1500,
      });
      const verdicts = ['Perfect', 'Minor', 'Mistake', 'Blunder', 'InStrategy', 'OffStrategy'];
      check(
        'POST /api/trainer/answer → grade + node.strategy[0].length === 1326',
        answer.status === 200 &&
          verdicts.includes(answer.body?.grade?.verdict) &&
          answer.body?.node?.strategy?.[0]?.length === 1326,
        `status=${answer.status} verdict=${answer.body?.grade?.verdict} len=${answer.body?.node?.strategy?.[0]?.length}`,
      );
      const done = await getJson(`/api/trainer/next?session=${sid}`);
      check(
        'GET /api/trainer/next → done + 세션 리포트 (attempts 1)',
        done.status === 200 && done.body?.done === true && done.body?.report?.totals?.attempts === 1,
        `status=${done.status} attempts=${done.body?.report?.totals?.attempts}`,
      );
    } else {
      console.log('NOTE  /api/charts is empty (run npm run seed to exercise the trainer checks)');
    }

    // 8. SPA 폴백 / API 404
    const spa = await getJson('/no/such/route');
    check(
      'GET /no/such/route → 200 index.html (SPA fallback)',
      spa.status === 200 && spa.text.includes('<div id="root">'),
      `status=${spa.status}`,
    );
    const api404 = await getJson('/api/no');
    check(
      'GET /api/no → 404 JSON NotFound',
      api404.status === 404 && api404.body?.error?.code === 'NotFound',
      `status=${api404.status} code=${api404.body?.error?.code}`,
    );
  } finally {
    child.kill();
    await new Promise((r) => {
      child.on('exit', r);
      setTimeout(r, 2000);
    });
    if (results.some((r) => !r.ok)) process.stderr.write(`--- server log ---\n${serverLog}\n`);
  }
}

let fatal = null;
try {
  await run();
} catch (err) {
  fatal = err instanceof Error ? err.message : String(err);
}

const passed = results.filter((r) => r.ok).length;
const ok = fatal === null && passed === results.length && results.length > 0;
console.log(JSON.stringify({ ok, passed, total: results.length, fatal, results }));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  (${r.detail})`}`);
if (fatal !== null) console.log(`FATAL ${fatal}`);
console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
process.exit(ok ? 0 : 1);
