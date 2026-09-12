/**
 * 페이지별 `document.title` (P2 R1 MINOR 2).
 *
 * 라우터 라이브러리가 없으므로 각 페이지가 마운트 시 직접 설정한다. `index.html` 의
 * 정적 제목은 첫 페인트 전까지만 보이는 값이다.
 */

import { useEffect } from 'react';

export function usePageTitle(title: string): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = title;
  }, [title]);
}
