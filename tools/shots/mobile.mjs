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
import { ensureServer, firstChartSetId } from './lib/server.mjs';
import { ensureSolve } from './lib/solve-seed.mjs';
import { outDir } from './lib/out.mjs';
import * as P from './lib/probes.mjs';

const OUT_DIR = outDir(process.argv.slice(2));
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

    // reach 패널은 `>= md` 에서 격자 오른쪽 열이다 (R1 MAJOR 2). 375 에서는 아래여야 한다.
    await evaluate(cdp, P.click('mode-reach'));
    await waitFor(cdp, `document.querySelector('[data-testid="reach-panel"]')`, { label: 'reach 패널' });
    await commonChecks(cdp, 'charts-reach');
    const mReachCanvas = await evaluate(cdp, P.CANVAS);
    const mReachPanel = await evaluate(cdp, P.rectOf('reach-panel'));
    check(
      mReachPanel !== null && mReachCanvas !== null && mReachPanel.top >= mReachCanvas.bottom,
      'charts-reach: 375 에서 reach 패널은 격자 **아래**다 (P3M 6.2)',
      { panelTop: mReachPanel?.top, canvasBottom: mReachCanvas?.bottom },
    );

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
    // R1 MINOR 3: 짧은 페이지에서 바가 페이지 `p-4` 안에 갇혀 아래 16px 이 남았다.
    check(bar !== null && bar.bottom === H, '출제: 바가 화면 맨 아래에 붙는다 (R1 MINOR 3)', { bar, H });
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
    // R1 MINOR 1: 답 후 바가 157px 이 되어 격자 아래 액션표의 행을 스크롤 0 에서 덮었다.
    // 요약줄만 보이고 정작 액션별 빈도/EV 는 가려졌다.
    const revealedBar = await evaluate(cdp, P.rectOf('action-bar'));
    const gradeTable = await evaluate(cdp, P.rectOf('grade-table'));
    check(
      gradeTable !== null && revealedBar !== null && gradeTable.bottom <= revealedBar.top,
      '답 후: 액션표가 스크롤 0 에서 하단 바에 가리지 않는다 (R1 MINOR 1)',
      { gradeTable, bar: revealedBar },
    );
    check(
      revealedBar !== null && revealedBar.bottom >= H,
      '답 후: 바 아래에 빈 띠가 없다 (R1 MINOR 3)',
      { bar: revealedBar, H },
    );
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

    // --- 7b. 솔브 (P5.md 8.3) --------------------------------------------
    // 실제 바이너리로 만든 결과만 검사한다 — 솔버가 없으면 건너뛴다 (D24).
    await emulate(cdp, { width: W, height: H, dpr: 2, mobile: true });
    const solve = await ensureSolve(server.baseUrl);
    if (solve === null) {
      console.log('SKIP solve pages (no solver binary)');
    } else {
      // 7b-1. 목록
      await goto(cdp, `${server.baseUrl}/solve`);
      await waitFor(cdp, `document.querySelector('[data-testid="solve-list"]')`, { label: '솔브 목록' });
      const rows = await evaluate(cdp, `document.querySelectorAll('[data-testid^="solve-row-"]').length`);
      check(rows >= 1, 'solve-list: 행이 하나 이상', { rows });
      await commonChecks(cdp, 'solve-list');
      await screenshot(cdp, resolve(OUT_DIR, 'P5-mobile-solve-list.png'));

      // 7b-2. 새 솔브 폼
      await evaluate(cdp, P.click('new-solve'));
      await waitFor(cdp, `document.querySelector('[data-testid="solve-form"]')`, { label: '솔브 폼' });
      await commonChecks(cdp, 'solve-form');
      await screenshot(cdp, resolve(OUT_DIR, 'P5-mobile-solve-form.png'));
      await evaluate(cdp, P.click('form-cancel'));

      // 7b-3. 탐색기 루트 (행동 노드)
      await waitFor(cdp, `document.querySelector('[data-testid="solve-open-${solve.hash}"]')`, { label: '목록 복귀' });
      await evaluate(cdp, P.click(`solve-open-${solve.hash}`));
      await waitFor(cdp, `document.querySelector('canvas[role="grid"]')`, { label: '탐색기 격자' });
      await commonChecks(cdp, 'solve-explorer');
      await gridChecks(cdp, 'solve-explorer');
      const sBar = await evaluate(cdp, P.rectOf('action-bar'));
      check(sBar !== null && sBar.bottom === H, '탐색기: 하단 바가 화면 맨 아래', { bar: sBar, H });
      check(sBar !== null && sBar.top >= H * 0.6, '탐색기: 하단 바가 엄지 범위(하단 40%)', {
        ...sBar,
        threshold: H * 0.6,
      });
      check(sBar !== null && sBar.h >= 64, '탐색기: 하단 바 높이 >= 64', sBar);
      const actionRects = await evaluate(
        cdp,
        `(() => [...document.querySelectorAll('[data-testid^="solve-action-"]')].map((b) => {
          const r = b.getBoundingClientRect();
          return { testid: b.getAttribute('data-testid'), w: Math.round(r.width), h: Math.round(r.height) };
        }))()`,
      );
      check(actionRects.length >= 2, '탐색기: 액션 버튼이 둘 이상', actionRects);
      check(actionRects.every((a) => a.h >= 48), '탐색기: 액션 버튼 높이 >= 48', actionRects);
      check(
        (await evaluate(cdp, `document.querySelector('[data-testid="node-ev"]').textContent`)).includes('= 팟'),
        '탐색기: 노드 EV 합 = 팟 줄이 있다',
      );
      await screenshot(cdp, resolve(OUT_DIR, 'P5-mobile-solve-explorer.png'));

      // 7b-4. chance 노드 (스트리트를 닫아 런아웃 히트맵으로)
      await evaluate(cdp, P.click('solve-action-X'));
      await waitFor(cdp, `document.querySelector('[data-testid="solve-action-X"]')`, { label: '두 번째 X' });
      await evaluate(cdp, P.click('solve-action-X'));
      await waitFor(cdp, `document.querySelector('[data-testid="runouts"]')`, { label: '런아웃 히트맵' });
      await commonChecks(cdp, 'solve-chance');
      const heat = await evaluate(cdp, P.RUNOUT_GRID);
      check(heat !== null && heat.cells === 52, '히트맵: 52칸 (보드 카드는 빈 칸)', heat);
      check(heat !== null && heat.maxRowWidth <= 343, '히트맵: 한 행의 폭 합 <= 343', heat);
      check(
        (await evaluate(cdp, `document.querySelector('[data-testid="action-bar-chance"]').textContent`)).includes(
          '카드를 고르세요',
        ),
        'chance: 하단 바가 카드를 고르라고 말한다',
      );
      await screenshot(cdp, resolve(OUT_DIR, 'P5-mobile-solve-chance.png'));

      // 7b-5. 2단계 탭 → 리버 행동 노드
      const firstCard = await evaluate(
        cdp,
        `(() => document.querySelector('[data-testid="runouts"] [data-tap="cell"]').getAttribute('data-testid'))()`,
      );
      await evaluate(cdp, P.click(firstCard));
      const readoutAfterFirstTap = await evaluate(
        cdp,
        `document.querySelector('[data-testid="runout-readout"]').textContent`,
      );
      check(readoutAfterFirstTap.startsWith('선택: '), '히트맵: 첫 탭은 상태줄만 바꾼다', {
        readoutAfterFirstTap,
      });
      check(
        (await evaluate(cdp, `document.querySelector('[data-testid="runouts"]') !== null`)) === true,
        '히트맵: 첫 탭으로는 노드가 바뀌지 않는다',
      );
      await evaluate(cdp, P.click(firstCard));
      await waitFor(cdp, `document.querySelector('canvas[role="grid"]')`, { label: '리버 노드 격자' });
      await commonChecks(cdp, 'solve-river');
      const boardCards = await evaluate(
        cdp,
        `document.querySelectorAll('[data-testid="board-cards"] > span').length`,
      );
      check(boardCards === 5, '리버 노드: 헤더 보드가 5장 (딜된 카드 포함)', { boardCards });
      await screenshot(cdp, resolve(OUT_DIR, 'P5-mobile-solve-river.png'));

      // 7b-6. 터미널 — 리버에서 체크-체크는 쇼다운이다 (더 이상 노드가 없다).
      await evaluate(cdp, P.click('solve-action-X'));
      await waitFor(cdp, `document.querySelector('[data-testid="solve-action-X"]')`, { label: '리버 두 번째 X' });
      await evaluate(cdp, P.click('solve-action-X'));
      await waitFor(cdp, `document.querySelector('[data-testid="action-bar-terminal"]')`, { label: '터미널 바' });
      await commonChecks(cdp, 'solve-terminal');
      check(
        (await evaluate(cdp, `document.querySelector('[data-testid="line-back"]').disabled`)) === false,
        'terminal: `←` 로 이전 노드로 돌아갈 수 있다',
      );
      await screenshot(cdp, resolve(OUT_DIR, 'P5-mobile-solve-terminal.png'));
    }

    // --- 8. 태블릿 768x1024 (여전히 터치다) -------------------------------
    // md 브레이크포인트가 정확히 768 이라 여기서 `md:min-h-0` 이 켜진다. 손가락은
    // 그대로이므로 44px 은 유지돼야 한다 (index.css 의 pointer: coarse 규칙).
    await emulate(cdp, { width: 768, height: 1024, dpr: 2, mobile: true });
    for (const [name, url] of [
      ['tablet-range', '/'],
      ['tablet-charts', `/charts?set=${String(setId)}`],
    ]) {
      await goto(cdp, server.baseUrl + url);
      await waitFor(cdp, `document.querySelector('canvas[role="grid"]')`, { label: `${name} 격자` });
      const vp = await evaluate(cdp, P.VIEWPORT);
      check(vp.innerWidth === 768 && vp.scrollWidth === 768, `${name}: 768 안에 들어간다`, vp);
      check((await evaluate(cdp, P.OVERFLOWING)).length === 0, `${name}: 뷰포트를 넘는 요소 0`);
      const small = await evaluate(cdp, P.SMALL_TARGETS);
      check(small.length === 0, `${name}: 44x44 미만 터치 타겟 0 (pointer: coarse)`, small);
      const canvas = await evaluate(cdp, P.CANVAS);
      check(
        canvas !== null && canvas.cssWidth % 13 === 0 && canvas.cssWidth <= 420,
        `${name}: 격자가 13의 배수이고 420 이하 (우측 열을 남긴다)`,
        canvas,
      );
    }
    // 8b. 태블릿 reach 토글 (P3M R2 MINOR 4). 768~829px 는 좌측 열이 가장 좁은 구간이라
    // 격자가 우측 reach 패널을 덮기 쉽다. 정상 상태뿐 아니라 **전환 과도기**도 본다:
    // rAF 로 매 프레임 재면서 `canvas.right > panel.left` 인 프레임이 2개를 넘으면 실패다.
    for (const tw of [768, 800, 829]) {
      await emulate(cdp, { width: tw, height: 1024, dpr: 2, mobile: true });
      await goto(cdp, `${server.baseUrl}/charts?set=${String(setId)}`);
      await waitFor(cdp, `document.querySelector('canvas[role="grid"]')`, { label: `tablet-${String(tw)} 격자` });
      const rec = await evaluate(
        cdp,
        `(() => {
          window.__reachFrames = [];
          window.__reachDone = false;
          const t0 = performance.now();
          const tick = () => {
            const c = document.querySelector('canvas[role="grid"]');
            const p = document.querySelector('[data-testid="reach-panel"]');
            if (c !== null && p !== null) {
              const cr = c.getBoundingClientRect();
              const pr = p.getBoundingClientRect();
              window.__reachFrames.push({ t: Math.round(performance.now() - t0), overlap: Math.round(cr.right - pr.left) });
            }
            if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
            else window.__reachDone = true;
          };
          requestAnimationFrame(tick);
          document.querySelector('[data-testid="mode-reach"]').click();
          return true;
        })()`,
      );
      void rec;
      await waitFor(cdp, `window.__reachDone === true`, { label: `tablet-${String(tw)} reach 녹화`, timeout: 8000 });
      const frames = await evaluate(cdp, 'window.__reachFrames');
      const bad = frames.filter((f) => f.overlap > 0);
      check(frames.length > 30, `tablet-${String(tw)}-reach: 프레임을 실제로 녹화했다`, { frames: frames.length });
      check(
        bad.length <= 2,
        `tablet-${String(tw)}-reach: 전환 과도기 겹침 <= 2 프레임 (P3M R2 MINOR 4)`,
        { badFrames: bad.length, firstBad: bad[0], lastBad: bad.at(-1) },
      );
      // 프레임 수와 별개로 **언제** 끝났는지도 본다: 리뷰가 관측한 증상은 "1193/1203/1213ms
      // 까지 416 유지" 였다. 느린 머신에서 프레임 수가 적게 잡혀도 이 단언은 걸린다.
      check(
        (bad.at(-1)?.t ?? 0) <= 100,
        `tablet-${String(tw)}-reach: 겹침이 100ms 안에 끝난다`,
        { lastBadAtMs: bad.at(-1)?.t ?? null },
      );
      const settledCanvas = await evaluate(cdp, P.CANVAS);
      const settledPanel = await evaluate(cdp, P.rectOf('reach-panel'));
      check(
        settledPanel !== null && settledCanvas !== null && settledPanel.left > settledCanvas.right,
        `tablet-${String(tw)}-reach: 정상 상태에서 패널이 격자 오른쪽이다`,
        { panelLeft: settledPanel?.left, canvasRight: settledCanvas?.right },
      );
      check(
        (await evaluate(cdp, P.OVERFLOWING)).length === 0,
        `tablet-${String(tw)}-reach: 뷰포트를 넘는 요소 0`,
      );
    }
    await emulate(cdp, { width: 768, height: 1024, dpr: 2, mobile: true });

    await startSession(cdp, server.baseUrl, 20);
    check(
      (await evaluate(cdp, P.SMALL_TARGETS)).length === 0,
      'tablet-trainer: 44x44 미만 터치 타겟 0',
      await evaluate(cdp, P.SMALL_TARGETS),
    );
    await screenshot(cdp, resolve(OUT_DIR, 'P3M-tablet-trainer-masked.png'));
    await answerFirst(cdp);
    await evaluate(cdp, 'window.scrollTo(0, 0)');
    const tVerdict = await evaluate(cdp, P.rectOf('grade-verdict'));
    const tNext = await evaluate(cdp, P.rectOf('next-spot'));
    check(
      tVerdict !== null && tVerdict.top >= 0 && tVerdict.bottom <= 1024,
      'tablet 답 후: verdict 가 스크롤 0 에서 보인다',
      tVerdict,
    );
    check(
      tNext !== null && tNext.top >= 0 && tNext.bottom <= 1024,
      'tablet 답 후: "다음" 이 스크롤 0 에서 보인다',
      tNext,
    );
    await screenshot(cdp, resolve(OUT_DIR, 'P3M-tablet-trainer-revealed.png'));
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
