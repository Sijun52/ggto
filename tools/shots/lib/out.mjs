import { resolve } from 'node:path';
import { REPO_ROOT } from './server.mjs';

/**
 * 스크린샷 출력 디렉터리 (P3M R1 MINOR 5 / R2 MINOR 5).
 *
 * 기본은 gitignore 된 `tools/shots/out/` 다. 예전 기본값은 `docs/reviews/assets` 여서
 * `check:*` 를 한 번 돌릴 때마다 **리뷰에 첨부된 커밋된 PNG 8장을 덮어썼고**, 매 라운드
 * `git checkout` 으로 되돌려야 했다. 리뷰에 새 그림을 올릴 때만 `--publish` 를 준다.
 */
export function outDir(argv) {
  return resolve(REPO_ROOT, argv.includes('--publish') ? 'docs/reviews/assets' : 'tools/shots/out');
}
