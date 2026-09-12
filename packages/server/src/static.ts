/**
 * web/dist 정적 서빙 + SPA 폴백. P1.md 3.2.
 *
 * 프레임워크의 serveStatic 대신 직접 읽는다: "파일 없음 → index.html",
 * "web/dist 자체가 없음 → 503 WebNotBuilt" 라는 두 가지 다른 실패를 구분해야 하는데
 * 미들웨어가 조용히 404/빈 응답을 주면 "빌드 안 했음" 을 진단할 수 없다.
 */

import { readFile, stat } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import type { Handler } from 'hono';
import { HttpError } from './errors.js';

const CONTENT_TYPES = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function contentTypeOf(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return CONTENT_TYPES.get(path.slice(dot).toLowerCase()) ?? 'application/octet-stream';
}

const webNotBuilt = (): HttpError => new HttpError(503, 'WebNotBuilt', 'run npm run build');

async function readIfFile(path: string): Promise<Uint8Array | null> {
  try {
    const s = await stat(path);
    if (!s.isFile()) return null;
  } catch (err) {
    // ENOENT/ENOTDIR 는 "없음" 이고 나머지(권한 등)는 진짜 장애라 500 으로 올린다.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
  return await readFile(path);
}

/**
 * 요청 경로 → webDist 안의 절대 경로. 벗어나면 null (경로 탈출 방어).
 * URL 은 이미 디코드된 c.req.path 를 받는다.
 */
export function resolveWithin(root: string, urlPath: string): string | null {
  const decoded = urlPath.replace(/^\/+/, '');
  if (decoded.includes('\0')) return null;
  const candidate = resolve(root, normalize(decoded));
  const rootResolved = resolve(root);
  if (candidate !== rootResolved && !candidate.startsWith(rootResolved + sep)) return null;
  return candidate;
}

export function createStaticHandler(webDist: string | null): Handler {
  return async (c) => {
    if (webDist === null) throw webNotBuilt();

    const indexPath = join(webDist, 'index.html');
    const index = await readIfFile(indexPath);
    // index.html 이 없으면 web 이 빌드되지 않은 것이다. 빈 페이지 대신 진단 가능한 503.
    if (index === null) throw webNotBuilt();

    const target = resolveWithin(webDist, c.req.path);
    if (target !== null && target !== resolve(webDist)) {
      const file = await readIfFile(target);
      if (file !== null) {
        return new Response(c.req.method === 'HEAD' ? null : file, {
          status: 200,
          headers: { 'content-type': contentTypeOf(target) },
        });
      }
    }
    // SPA 폴백: 라우터가 클라이언트에 있으므로 없는 경로는 index.html 이 받는다.
    return new Response(c.req.method === 'HEAD' ? null : index, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };
}
