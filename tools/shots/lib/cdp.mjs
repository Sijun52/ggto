/**
 * headless Chrome + CDP 최소 클라이언트. 새 npm 의존성 없이 Node 24 내장
 * `WebSocket`/`fetch` 만 쓴다 (P3M 2절). puppeteer 를 넣지 않는 이유는 그것 하나가
 * 200MB 짜리 Chromium 을 또 받기 때문이다 — 이 PC 에는 이미 Chrome 이 있다.
 *
 * Chrome 경로: `GGTO_CHROME` 환경변수 → Windows 표준 경로 → PATH 의 `chrome`.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WINDOWS_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

export function findChrome() {
  const fromEnv = process.env.GGTO_CHROME;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    if (!existsSync(fromEnv)) throw new Error(`GGTO_CHROME not found: ${fromEnv}`);
    return fromEnv;
  }
  for (const p of WINDOWS_CANDIDATES) if (existsSync(p)) return p;
  throw new Error(
    'Chrome 을 찾지 못했다. GGTO_CHROME 에 chrome.exe 경로를 주라 (P3M 2절).',
  );
}

/** DevTools WebSocket URL 이 나올 때까지 stderr 를 읽는다 */
export async function launchChrome() {
  const exe = findChrome();
  const profile = mkdtempSync(join(tmpdir(), 'ggto-shots-'));
  const proc = spawn(
    exe,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-gpu',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      reject(new Error(`Chrome 이 DevTools 주소를 내놓지 않았다:\n${buf}`));
    }, 30_000);
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => {
      buf += chunk;
      const m = /ws:\/\/[^\s]+/.exec(buf);
      if (m !== null) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome 이 종료됐다 (code ${String(code)}):\n${buf}`));
    });
  });

  const close = () => {
    proc.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch (err) {
      // 프로필 삭제 실패는 검사 결과와 무관하다. 삼키지 않고 알린다.
      console.warn(`[shots] 임시 프로필 삭제 실패: ${String(err)}`);
    }
  };

  return { wsUrl, close };
}

/** 단일 탭에 붙은 CDP 세션 */
export class Cdp {
  #ws;
  #id = 0;
  #pending = new Map();
  #handlers = new Map();
  #sessionId = null;

  static async connect(wsUrl) {
    const cdp = new Cdp();
    await cdp.#open(wsUrl);
    return cdp;
  }

  #open(wsUrl) {
    this.#ws = new WebSocket(wsUrl);
    this.#ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      if (msg.id !== undefined) {
        const p = this.#pending.get(msg.id);
        if (p === undefined) return;
        this.#pending.delete(msg.id);
        if (msg.error !== undefined) p.reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error)})`));
        else p.resolve(msg.result);
        return;
      }
      const fns = this.#handlers.get(msg.method);
      if (fns !== undefined) for (const fn of [...fns]) fn(msg.params);
    });
    return new Promise((resolve, reject) => {
      this.#ws.addEventListener('open', () => {
        resolve();
      });
      this.#ws.addEventListener('error', () => {
        reject(new Error(`CDP 연결 실패: ${wsUrl}`));
      });
    });
  }

  on(method, fn) {
    const fns = this.#handlers.get(method) ?? [];
    fns.push(fn);
    this.#handlers.set(method, fns);
    return () => {
      this.#handlers.set(
        method,
        (this.#handlers.get(method) ?? []).filter((f) => f !== fn),
      );
    };
  }

  once(method, predicate = () => true) {
    return new Promise((resolve) => {
      const off = this.on(method, (params) => {
        if (!predicate(params)) return;
        off();
        resolve(params);
      });
    });
  }

  send(method, params = {}) {
    const id = ++this.#id;
    const payload = { id, method, params };
    if (this.#sessionId !== null) payload.sessionId = this.#sessionId;
    this.#ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
  }

  /** 새 탭을 만들고 그 탭의 세션으로 고정한다 (flatten 모드) */
  async attachNewTab() {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    this.#sessionId = sessionId;
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    return targetId;
  }

  close() {
    this.#ws.close();
  }
}

/** 뷰포트/DPR/모바일 에뮬레이션 */
export async function emulate(cdp, { width, height, dpr = 2, mobile = false }) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: dpr,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
  // maxTouchPoints 는 1..16 만 받는다. 끌 때는 아예 보내지 않는다.
  await cdp.send('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
}

export async function goto(cdp, url) {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
}

/** 페이지 컨텍스트에서 식을 평가한다. 던지면 여기서도 던진다 (조용한 실패 금지). */
export async function evaluate(cdp, expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails !== undefined) {
    throw new Error(`page eval 실패: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ''}`);
  }
  return res.result.value;
}

/** 조건이 참이 될 때까지 기다린다 (식은 boolean 을 돌려줘야 한다) */
export async function waitFor(cdp, expression, { timeout = 15_000, label = expression } = {}) {
  const started = Date.now();
  for (;;) {
    if (await evaluate(cdp, `!!(${expression})`)) return;
    if (Date.now() - started > timeout) throw new Error(`waitFor 시간 초과: ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function screenshot(cdp, path, { fullPage = false } = {}) {
  const { writeFileSync } = await import('node:fs');
  const params = { format: 'png' };
  if (fullPage) params.captureBeyondViewport = true;
  const { data } = await cdp.send('Page.captureScreenshot', params);
  writeFileSync(path, Buffer.from(data, 'base64'));
  return path;
}
