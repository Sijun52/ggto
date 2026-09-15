/**
 * `npm run check:desktop` — 데스크톱 회귀 게이트 (P3M 8.3).
 *
 * P3M 은 모바일 페이즈지만 **데스크톱이 깨지지 않았다**는 것을 같은 방식으로 증명해야
 * 한다. 특히 1280x720: P3 에서는 답 후 채점 박스가 y=805 로 뷰포트 밖이었다
 * (P3 R1 MINOR 1). 1500x1000 개발 화면에서만 보이던 문제라 두 해상도를 다 돈다.
 */

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Cdp, emulate, evaluate, goto, launchChrome, screenshot, waitFor } from './lib/cdp.mjs';
import { ensureServer, firstChartSetId } from './lib/server.mjs';
import { ensureSolve } from './lib/solve-seed.mjs';
import { outDir } from './lib/out.mjs';
import * as P from './lib/probes.mjs';

const OUT_DIR = outDir(process.argv.slice(2));
const SIZES = [
  { w: 1280, h: 720 },
  { w: 1500, h: 1000 },
];

const failures = [];
function check(ok, label, detail) {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`;
  console.log(line);
  if (!ok) failures.push(line);
}

async function startSession(cdp, baseUrl, count) {
  await goto(cdp, `${baseUrl}/trainer`);
  await waitFor(
    cdp,
    `document.querySelector('[data-testid="session-start"]') && !document.querySelector('[data-testid="session-start"]').disabled`,
    { label: '세션 시작 버튼 활성' },
  );
  await evaluate(cdp, P.setInput('session-count', count));
  await evaluate(cdp, P.click('session-start'));
  await waitFor(cdp, `document.querySelector('[data-testid="answer-buttons"]')`, { label: '출제 화면' });
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const server = await ensureServer();
  const setId = await firstChartSetId(server.baseUrl);
  const solve = await ensureSolve(server.baseUrl);
  if (solve === null) console.log('SKIP solve pages (no solver binary)');
  const chrome = await launchChrome();
  const cdp = await Cdp.connect(chrome.wsUrl);
  try {
    await cdp.attachNewTab();

    for (const { w, h } of SIZES) {
      const tag = `${String(w)}x${String(h)}`;
      await emulate(cdp, { width: w, height: h, dpr: 1, mobile: false });

      // --- 트레이너: 답 후 verdict 가 스크롤 0 에서 보인다 -------------------
      await startSession(cdp, server.baseUrl, 20);
      const canvas = await evaluate(cdp, P.CANVAS);
      check(canvas !== null && canvas.cssWidth === 520, `${tag} 트레이너 캔버스 520px`, canvas);

      const btn = await evaluate(
        cdp,
        `(() => document.querySelector('[data-testid="answer-buttons"] button').getAttribute('data-testid'))()`,
      );
      await evaluate(cdp, P.click(btn));
      await waitFor(cdp, `document.querySelector('[data-testid="grade-box"]')`, { label: '채점 박스' });
      await evaluate(cdp, 'window.scrollTo(0, 0)');

      const box = await evaluate(cdp, P.rectOf('grade-box'));
      const verdict = await evaluate(cdp, P.rectOf('grade-verdict'));
      const nextBtn = await evaluate(cdp, P.rectOf('next-spot'));
      const canvasRect = await evaluate(cdp, P.CANVAS);
      check(
        box !== null && canvasRect !== null && box.left > 325,
        `${tag} 채점 박스가 격자 오른쪽 열에 있다`,
        { boxLeft: box?.left, canvasWidth: canvasRect?.cssWidth },
      );
      check(
        verdict !== null && verdict.top >= 0 && verdict.bottom <= h,
        `${tag} 답 후 verdict 가 스크롤 0 에서 뷰포트 안 (P3 R1 MINOR 1)`,
        { verdict, h },
      );
      check(
        nextBtn !== null && nextBtn.top >= 0 && nextBtn.bottom <= h,
        `${tag} 답 후 "다음" 이 스크롤 0 에서 뷰포트 안`,
        { next: nextBtn, h },
      );
      await screenshot(cdp, resolve(OUT_DIR, `P3M-desktop-${tag}-revealed.png`));

      // --- 뷰어: 셀 클릭 → 콤보 패널 접힘 헤더 → 펼치면 격자 아래 ------------
      await goto(cdp, `${server.baseUrl}/charts?set=${String(setId)}`);
      await waitFor(cdp, `document.querySelector('canvas[role="grid"]')`, { label: 'Charts 격자' });
      const viewerCanvas = await evaluate(cdp, P.CANVAS);
      check(viewerCanvas !== null && viewerCanvas.cssWidth === 520, `${tag} 뷰어 캔버스 520px`, viewerCanvas);
      await evaluate(
        cdp,
        `(() => {
          const c = document.querySelector('canvas[role="grid"]');
          const r = c.getBoundingClientRect();
          c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
          return true;
        })()`,
      );
      check(
        (await evaluate(cdp, `document.querySelector('[data-testid="chart-combo-panel"]') === null`)) === true,
        `${tag} 뷰어 콤보 패널은 접힘이 기본 (D20)`,
      );
      await evaluate(cdp, P.click('combo-toggle'));
      const panel = await evaluate(cdp, P.rectOf('chart-combo-panel'));
      check(panel !== null, `${tag} 토글하면 콤보 패널이 열린다`, panel);
      check(
        panel !== null && viewerCanvas !== null && panel.top > viewerCanvas.top + viewerCanvas.cssHeight,
        `${tag} 콤보 패널은 격자 **아래**다 (우측 열이 아니다)`,
        { panelTop: panel?.top, canvasBottom: (viewerCanvas?.top ?? 0) + (viewerCanvas?.cssHeight ?? 0) },
      );

      // reach 모드 패널은 그대로 동작한다 (P2 R1 MINOR 3) **그리고 보인다** (R1 MAJOR 2).
      // 행 수만 세던 옛 검사는 렌더 여부만 봤다 — 패널이 격자 아래로 내려가 1280x720 에서
      // top 813 (화면 밖) 이 된 회귀를 통째로 놓쳤다 (P3M 8.3-3 R1 개정).
      await evaluate(cdp, P.click('mode-reach'));
      await waitFor(cdp, `document.querySelector('[data-testid="reach-panel"]')`, { label: 'reach 패널' });
      await evaluate(cdp, 'window.scrollTo(0, 0)');
      check(
        (await evaluate(cdp, `document.querySelectorAll('[data-testid^="reach-row-"]').length`)) >= 2,
        `${tag} reach 패널에 포지션 행이 있다`,
      );
      const reachCanvas = await evaluate(cdp, P.CANVAS);
      const reachPanel = await evaluate(cdp, P.rectOf('reach-panel'));
      check(
        reachPanel !== null && reachPanel.top >= 0 && reachPanel.bottom <= h,
        `${tag} reach 패널이 스크롤 0 에서 뷰포트 안 (R1 MAJOR 2)`,
        { reachPanel, h },
      );
      check(
        reachPanel !== null && reachCanvas !== null && reachPanel.left > reachCanvas.left + reachCanvas.cssWidth,
        `${tag} reach 패널이 격자 **오른쪽 열**에 있다`,
        { panelLeft: reachPanel?.left, canvasRight: (reachCanvas?.left ?? 0) + (reachCanvas?.cssWidth ?? 0) },
      );
      check(reachCanvas !== null && reachCanvas.cssWidth === 520, `${tag} reach 모드 캔버스도 520px`, reachCanvas);
      await screenshot(cdp, resolve(OUT_DIR, `P3M-desktop-${tag}-charts-reach.png`));

      // --- 솔브 탐색기: >= 1280 은 3열 (좌 트리 · 중앙 격자 · 우 어그리게이트+액션) ---
      if (solve !== null) {
        await goto(cdp, `${server.baseUrl}/solve?hash=${solve.hash}`);
        await waitFor(cdp, `document.querySelector('canvas[role="grid"]')`, { label: '탐색기 격자' });
        await evaluate(cdp, 'window.scrollTo(0, 0)');
        const tree = await evaluate(cdp, P.rectOf('line-tree'));
        const grid = await evaluate(cdp, P.CANVAS);
        const aside = await evaluate(cdp, P.rectOf('explorer-aside'));
        const agg = await evaluate(cdp, P.rectOf('aggregate'));
        const bar = await evaluate(cdp, P.rectOf('action-bar'));
        check(tree !== null && grid !== null && tree.right <= grid.left, `${tag} 솔브: 트리가 격자 왼쪽`, {
          treeRight: tree?.right,
          gridLeft: grid?.left,
        });
        check(aside !== null && grid !== null && aside.left >= grid.right, `${tag} 솔브: 어그리게이트가 격자 오른쪽`, {
          asideLeft: aside?.left,
          gridRight: grid?.right,
        });
        check(
          agg !== null && agg.top >= 0 && agg.bottom <= h,
          `${tag} 솔브: 어그리게이트가 스크롤 0 에서 뷰포트 안`,
          { agg, h },
        );
        check(
          bar !== null && bar.top >= 0 && bar.bottom <= h,
          `${tag} 솔브: 액션 버튼이 스크롤 0 에서 뷰포트 안 (하단 고정 바가 아니다)`,
          { bar, h },
        );
        check(grid !== null && grid.cssWidth % 13 === 0, `${tag} 솔브: 격자가 13의 배수`, grid);
        check(
          grid !== null && grid.top >= 0 && grid.bottom <= h,
          `${tag} 솔브: 격자가 스크롤 0 에서 통째로 보인다 (P5.md 5절 데스크톱 회귀)`,
          { grid, h },
        );
        // 노드 이동 체감 (게이트 아님 — 기록): node 요청 → 격자 페인트.
        const moveMs = await evaluate(
          cdp,
          `(async () => {
            const before = document.querySelectorAll('[data-testid^="crumb-"]').length;
            const t0 = performance.now();
            document.querySelector('[data-testid^="solve-action-"]').click();
            // 새 노드가 그려진 시점 = 라인 바에 칩이 하나 늘어난 프레임 (격자·바가 같은 커밋이다).
            for (let i = 0; i < 600; i++) {
              await new Promise((r) => requestAnimationFrame(r));
              if (document.querySelectorAll('[data-testid^="crumb-"]').length > before) break;
            }
            return Math.round(performance.now() - t0);
          })()`,
        );
        console.log(`NOTE  ${tag} 솔브 노드 이동 체감 ${String(moveMs)}ms (게이트 아님, P5.md 9)`);
        await screenshot(cdp, resolve(OUT_DIR, `P5-desktop-${tag}-solve.png`));
      }
    }
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
  console.log('check:desktop OK');
}

await main();
