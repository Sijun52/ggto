/**
 * `npm run check:mobile` — 375x812 DPR2 모바일 에뮬레이션으로 세 페이지를 돌며
 * P3M 8.2 의 항목을 **실제 레이아웃으로** 검사하고 스크린샷을 남긴다.
 *
 * assert 하나라도 깨지면 exit 1. `ci` 에는 넣지 않는다 — Chrome 은 개발 환경 의존이다.
 * 선행 조건: `npm run seed && npm run build` (또는 이미 뜬 7777 서버).
 */

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Cdp, emulate, evaluate, goto, launchChrome, screenshot, waitFor } from './lib/cdp.mjs';
import { ensureServer, firstChartSetId, REPO_ROOT } from './lib/server.mjs';
import * as P from './lib/probes.mjs';

const OUT_DIR = resolve(REPO_ROOT, 'docs/reviews/assets');
const W = 375;
const H = 812;

const failures = [];
function check(ok, label, detail) {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`;
  console.log(line);
  if (!ok) failures.push(line);
}

async function commonChecks(cdp, page) {
  const vp = await evaluate(cdp, P.VIEWPORT);
  check(vp.innerWidth === W, `${page}: layout viewport = ${String(W)}`, vp);
  check(vp.scrollWidth === W, `${page}: scrollWidth = ${String(W)} (가로 넘침 없음)`, vp);
  const over = await evaluate(cdp, P.OVERFLOWING);
  check(over.length === 0, `${page}: 뷰포트를 넘는 요소 0`, over);
  const small = await evaluate(cdp, P.SMALL_TARGETS);
  check(small.length === 0, `${page}: 44x44 미만 터치 타겟 0`, small);
}

async function gridChecks(cdp, page) {
  const canvas = await evaluate(cdp, P.CANVAS);
  check(canvas !== null, `${page}: 격자 캔버스가 있다`);
  if (canvas !== null) {
    check(
      canvas.cssWidth === 325,
      `${page}: 캔버스 폭 325 (13의 배수, 셀 25px)`,
      canvas,
    );
    check(canvas.attrWidth === 650, `${page}: 캔버스 물리 픽셀 = CSS x DPR2`, canvas);
  }
  const axis = await evaluate(cdp, P.AXIS_FONT);
  check(axis !== null && axis.count === 26, `${page}: 축 라벨 26개`, axis);
  check(axis !== null && axis.fontPx >= 11, `${page}: 축 라벨 폰트 >= 11px`, axis);
}

async function startSession(cdp, baseUrl, count) {
  await goto(cdp, `${baseUrl}/trainer`);
  await waitFor(cdp, `document.querySelector('[data-testid="session-start"]') && !document.querySelector('[data-testid="session-start"]').disabled`, {
    label: '세션 시작 버튼 활성',
  });
  await evaluate(cdp, P.setInput('session-count', count));
  await evaluate(cdp, P.click('session-start'));
  await waitFor(cdp, `document.querySelector('[data-testid="answer-buttons"]')`, { label: '출제 화면' });
}

async function answerFirst(cdp) {
  const btn = await evaluate(
    cdp,
    `(() => document.querySelector('[data-testid="answer-buttons"] button').getAttribute('data-testid'))()`,
  );
  await evaluate(cdp, P.click(btn));
  await waitFor(cdp, `document.querySelector('[data-testid="grade-box"]')`, { label: '채점 박스' });
  return btn;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const server = await ensureServer();
  const setId = await firstChartSetId(server.baseUrl);
  const chrome = await launchChrome();
  const cdp = await Cdp.connect(chrome.wsUrl);
  try {
    await cdp.attachNewTab();
    await emulate(cdp, { width: W, height: H, dpr: 2, mobile: true });

    // --- 1. Range -------------------------------------------------------
    await goto(cdp, `${server.baseUrl}/`);
    await waitFor(cdp, `document.querySelector('canvas[role="grid"]')`, { label: 'Range 격자' });
    await commonChecks(cdp, 'range');
    await gridChecks(cdp, 'range');
    await screenshot(cdp, resolve(OUT_DIR, 'P3M-mobile-range.png'));

    // --- 2. Charts ------------------------------------------------------
    await goto(cdp, `${server.baseUrl}/charts?set=${String(setId)}`);
    await waitFor(cdp, `document.querySelector('canvas[role="grid"]')`, { label: 'Charts 격자' });
    await commonChecks(cdp, 'charts');
    await gridChecks(cdp, 'charts');
    // 셀을 탭하면 상태줄이 선택을 말한다 (호버가 없다)
    await evaluate(
      cdp,
      `(() => {
        const c = document.querySelector('canvas[role="grid"]');
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
        return true;
      })()`,
    );
    const readout = await evaluate(
      cdp,
      `document.querySelector('[data-testid="chart-hover-readout"]').textContent`,
    );
    check(readout.startsWith('선택: AA'), 'charts: 탭하면 상태줄이 "선택: AA …"', { readout });
    check(
      (await evaluate(cdp, `document.querySelector('[data-testid="combo-toggle"]') !== null`)) === true,
      'charts: 콤보 패널이 접힘 헤더로 있다 (D20)',
    );
    await screenshot(cdp, resolve(OUT_DIR, 'P3M-mobile-charts.png'));

    // --- 3. Trainer 세션 폼 ---------------------------------------------
    await goto(cdp, `${server.baseUrl}/trainer`);
    await waitFor(cdp, `document.querySelector('[data-testid="session-form"]')`, { label: '세션 폼' });
    await commonChecks(cdp, 'trainer-form');
    await screenshot(cdp, resolve(OUT_DIR, 'P3M-mobile-trainer-form.png'));

    // --- 4. 출제 화면 ---------------------------------------------------
    await startSession(cdp, server.baseUrl, 20);
    await commonChecks(cdp, 'trainer-masked');
    await gridChecks(cdp, 'trainer-masked');
    const bar = await evaluate(cdp, P.rectOf('action-bar'));
    check(bar !== null && bar.bottom <= H, '출제: 하단 바가 뷰포트 안', bar);
    check(bar !== null && bar.top >= H * 0.6, '출제: 하단 바가 엄지 범위(하단 40%)', {
      ...bar,
      threshold: H * 0.6,
    });
    const answers = await evaluate(cdp, P.ANSWER_BUTTON_RECTS);
    check(answers.length >= 2 && answers.every((a) => a.h >= 48), '출제: 답 버튼 높이 >= 48', answers);
    await screenshot(cdp, resolve(OUT_DIR, 'P3M-mobile-trainer-masked.png'));

    // --- 5. 답 후 --------------------------------------------------------
    await answerFirst(cdp);
    await evaluate(cdp, 'window.scrollTo(0, 0)');
    await commonChecks(cdp, 'trainer-revealed');
    const verdict = await evaluate(cdp, P.rectOf('grade-verdict'));
    const nextBtn = await evaluate(cdp, P.rectOf('next-spot'));
    check(
      verdict !== null && verdict.top >= 0 && verdict.bottom <= H,
      '답 후: verdict 가 스크롤 0 에서 보인다',
      verdict,
    );
    check(
      nextBtn !== null && nextBtn.top >= 0 && nextBtn.bottom <= H,
      '답 후: "다음" 이 스크롤 0 에서 보인다',
      nextBtn,
    );
    check(nextBtn !== null && nextBtn.h >= 48, '답 후: "다음" 높이 >= 48', nextBtn);
    // 오탭 방지: 공개 직후 "다음" 은 잠겨 있다
    const lockedNow = await evaluate(cdp, `document.querySelector('[data-testid="next-spot"]').disabled`);
    await new Promise((r) => setTimeout(r, 700));
    const lockedLater = await evaluate(cdp, `document.querySelector('[data-testid="next-spot"]').disabled`);
    check(lockedLater === false, '답 후: 500ms 뒤 "다음" 이 풀린다', { lockedNow, lockedLater });
    await screenshot(cdp, resolve(OUT_DIR, 'P3M-mobile-trainer-revealed.png'));

    // --- 6. 세션 리포트 ---------------------------------------------------
    await startSession(cdp, server.baseUrl, 1);
    await answerFirst(cdp);
    await waitFor(cdp, `!document.querySelector('[data-testid="next-spot"]').disabled`, { label: '다음 해제' });
    await evaluate(cdp, P.click('next-spot'));
    await waitFor(cdp, `document.querySelector('[data-testid="report-panel"]')`, { label: '세션 리포트' });
    await commonChecks(cdp, 'session-report');
    const cards = await evaluate(
      cdp,
      `document.querySelectorAll('[data-testid^="report-card-"]').length`,
    );
    check(cards > 0, '세션 리포트: 표가 아니라 카드', { cards });
    check(
      (await evaluate(cdp, `document.querySelectorAll('[data-testid="report-panel"] table').length`)) === 0,
      '세션 리포트: 표 요소 없음',
    );
    await screenshot(cdp, resolve(OUT_DIR, 'P3M-mobile-session-report.png'));

    // --- 7. 30d 리포트 ----------------------------------------------------
    await evaluate(cdp, P.click('tab-report'));
    await waitFor(cdp, `document.querySelector('[data-testid="report-panel"]')`, { label: '30d 리포트' });
    await commonChecks(cdp, 'report-30d');
    await screenshot(cdp, resolve(OUT_DIR, 'P3M-mobile-report-30d.png'));
  } finally {
    cdp.close();
    await chrome.close();
    server.stop();
  }

  console.log('');
  if (failures.length > 0) {
    console.log(`FAILED ${String(failures.length)} 항목:`);
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log('check:mobile OK');
}

await main();
