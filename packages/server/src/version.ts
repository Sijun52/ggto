import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * packages/server/package.json 의 version.
 * src/version.ts 와 dist/version.js 둘 다 패키지 루트의 한 단계 아래라 같은 상대 경로가 맞는다.
 */
export function serverVersion(): string {
  const url = new URL('../package.json', import.meta.url);
  const raw = readFileSync(fileURLToPath(url), 'utf8');
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== 'string') {
    throw new Error('packages/server/package.json has no string "version"');
  }
  return parsed.version;
}
