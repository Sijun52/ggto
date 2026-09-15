/**
 * 페이지 안에서 도는 측정식들 (P3M 8.2/8.3). 전부 문자열이다 — CDP `Runtime.evaluate`
 * 로 그대로 넘긴다. 여기서 재는 것은 **실제 레이아웃**이지 CSS 클래스가 아니다.
 */

export const VIEWPORT = `(() => ({
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
  scrollWidth: document.documentElement.scrollWidth,
  dpr: window.devicePixelRatio,
}))()`;

export const CANVAS = `(() => {
  const c = document.querySelector('canvas[role="grid"]');
  if (c === null) return null;
  const r = c.getBoundingClientRect();
  return {
    cssWidth: Math.round(r.width),
    cssHeight: Math.round(r.height),
    attrWidth: c.width,
    top: Math.round(r.top),
    left: Math.round(r.left),
    right: Math.round(r.right),
    bottom: Math.round(r.bottom),
  };
})()`;

export const AXIS_FONT = `(() => {
  const els = [...document.querySelectorAll('[data-axis]')];
  if (els.length === 0) return null;
  return { count: els.length, fontPx: Math.min(...els.map((e) => parseFloat(getComputedStyle(e).fontSize))) };
})()`;

/**
 * 44x44 미만인 대화 요소. 렌더되지 않은 것(면적 0)은 탭할 수 없으므로 제외한다.
 *
 * `data-tap="cell"` 은 격자 셀류 예외다 (P3M 4절 / P5.md 5절): 런아웃 히트맵의 25px 칸은
 * **2단계 탭**이라 오탭이 상태를 바꾸지 않고, 확정은 44px 버튼(`runout-go`)이 받는다.
 */
export const SMALL_TARGETS = `(() => {
  const sel = 'button, a, input, select, [role="button"]';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.tagName === 'CANVAS') continue;
    if (el.getAttribute('data-tap') === 'cell') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.width < 44 || r.height < 44) {
      out.push({
        tag: el.tagName.toLowerCase(),
        testid: el.getAttribute('data-testid'),
        text: (el.textContent || '').trim().slice(0, 24),
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
      });
    }
  }
  return out;
})()`;

/**
 * 뷰포트 오른쪽으로 삐져나온 요소 (layout viewport 를 넓히는 원인).
 *
 * **가로 스크롤 컨테이너 안은 제외한다** (P5.md 3.2 라인 바): `overflow-x: auto` 는 넘치는
 * 내용을 **스크롤로** 담는 것이지 뷰포트를 넓히지 않는다. 진짜 게이트는 여전히
 * `document.scrollWidth === innerWidth` 이고, 그것은 `VIEWPORT` 가 본다.
 */
export const OVERFLOWING = `(() => {
  const out = [];
  const limit = window.innerWidth + 0.5;
  const inScroller = (el) => {
    for (let p = el.parentElement; p !== null && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > limit) {
      if (inScroller(el)) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        testid: el.getAttribute('data-testid'),
        cls: String(el.className).slice(0, 60),
        right: Math.round(r.right),
      });
    }
  }
  return out.slice(0, 10);
})()`;

export function rectOf(testId) {
  return `(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      left: Math.round(r.left), right: Math.round(r.right),
      w: Math.round(r.width), h: Math.round(r.height),
      disabled: el.disabled === true,
    };
  })()`;
}

export const ANSWER_BUTTON_RECTS = `(() => {
  const bar = document.querySelector('[data-testid="answer-buttons"]');
  if (bar === null) return [];
  return [...bar.querySelectorAll('button')].map((b) => {
    const r = b.getBoundingClientRect();
    return { testid: b.getAttribute('data-testid'), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
  });
})()`;

export function click(testId) {
  return `(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (el === null) throw new Error('없는 요소: ${testId}');
    el.click();
    return true;
  })()`;
}

/** React 제어 입력에 값을 넣는다 (네이티브 setter + input 이벤트) */
export function setInput(testId, value) {
  return `(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (el === null) throw new Error('없는 입력: ${testId}');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(String(value))});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`;
}

/** 런아웃 히트맵: 칸 수와 한 행의 폭 합 (P5.md 8.3: 52칸 폭 합 <= 343) */
export const RUNOUT_GRID = `(() => {
  const root = document.querySelector('[data-testid="runouts"]');
  if (root === null) return null;
  const cells = [...root.querySelectorAll('[data-tap="cell"], [data-testid^="runout-empty-"]')];
  if (cells.length === 0) return null;
  const rows = new Map();
  for (const el of cells) {
    const r = el.getBoundingClientRect();
    const key = Math.round(r.top);
    rows.set(key, (rows.get(key) ?? 0) + r.width);
  }
  const widths = [...rows.values()].map((w) => Math.round(w));
  const rootRect = root.getBoundingClientRect();
  return {
    cells: cells.length,
    rows: rows.size,
    maxRowWidth: Math.max(...widths),
    rootWidth: Math.round(rootRect.width),
    cellWidth: Math.round(cells[0].getBoundingClientRect().width * 10) / 10,
  };
})()`;

export const GRID_LABEL_SAMPLE = `(() => {
  const c = document.querySelector('canvas[role="grid"]');
  if (c === null) return null;
  return { step: Math.round((c.getBoundingClientRect().width / 13) * 10) / 10 };
})()`;
