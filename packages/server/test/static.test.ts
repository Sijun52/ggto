import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { resolveWithin } from '../src/static.js';
import type { ErrorEnvelope } from '@ggto/protocol';

const dist = mkdtempSync(join(tmpdir(), 'ggto-webdist-'));
mkdirSync(join(dist, 'assets'));
writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
writeFileSync(join(dist, 'assets', 'x.js'), 'export const x = 1326;\n');

const missing = join(tmpdir(), 'ggto-webdist-does-not-exist');

afterAll(() => {
  rmSync(dist, { recursive: true, force: true });
});

describe('3.4 정적 서빙 + SPA 폴백', () => {
  const app = createApp({ webDist: dist });

  it('3.4 GET / → index.html (text/html)', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<div id="root">');
  });

  it('3.4 GET /assets/x.js → 파일 내용, text/javascript', async () => {
    const res = await app.request('/assets/x.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toBe('export const x = 1326;\n');
  });

  it('3.4 GET /some/spa/route → index.html (SPA 폴백)', async () => {
    const res = await app.request('/some/spa/route');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  it('3.4 GET /api/nope → 404 JSON NotFound (SPA 폴백으로 새지 않는다)', async () => {
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe('NotFound');

    const post = await app.request('/api/range/nope', { method: 'POST' });
    expect(post.status).toBe(404);
  });

  it('3.4 webDist 가 없는 디렉터리면 / → 503 WebNotBuilt', async () => {
    const broken = createApp({ webDist: missing });
    const res = await broken.request('/');
    expect(res.status).toBe(503);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('WebNotBuilt');
    expect(body.error.message).toBe('run npm run build');
    // webDist 를 아예 안 준 경우도 같다 (조용한 빈 페이지 금지)
    const none = createApp();
    expect((await none.request('/')).status).toBe(503);
  });

  it('3.4 webDist 밖으로 나가는 경로는 파일을 주지 않는다 (폴백으로만 응답)', () => {
    expect(resolveWithin(dist, '/../../secret.txt')).toBeNull();
    expect(resolveWithin(dist, '/assets/../index.html')).toBe(join(dist, 'index.html'));
    expect(resolveWithin(dist, '/assets/x.js')).toBe(join(dist, 'assets', 'x.js'));
  });

  it('3.4 디렉터리 요청은 파일이 아니므로 index.html 로 떨어진다', async () => {
    const res = await app.request('/assets');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });
});

describe('3.4 에러 매핑', () => {
  it('3.4 예상 못 한 예외 → 500 Internal, 메시지 고정 (내부 정보 유출 없음)', async () => {
    const app = createApp({ testRoutes: true });
    const res = await app.request('/api/__boom');
    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({ error: { code: 'Internal', message: 'internal error' } });
    expect(raw).not.toContain('passwd');
  });

  it('3.4 HttpError 는 상태/코드를 그대로 낸다', async () => {
    const app = createApp({ testRoutes: true });
    const res = await app.request('/api/__http-error');
    expect(res.status).toBe(418);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe('Teapot');
  });
});
