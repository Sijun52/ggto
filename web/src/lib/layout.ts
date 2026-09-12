/**
 * 반응형 레이아웃 원시함수 (P3M 3절).
 *
 * 격자는 **스케일**한다 — 탭 뒤로 숨기지 않는다. 트레이너는 격자를 보면서 답해야 한다.
 * 어떤 요소도 뷰포트 폭을 넘으면 안 된다: 넘는 순간 모바일 브라우저가 layout viewport 를
 * 넓혀(375 → 562) 페이지 전체를 0.67배로 축소한다 (P3M 1절 실측).
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** 축 라벨 열의 폭 (RangeGrid 와 같은 값) */
export const AXIS_WIDTH = 18;
/** 데스크톱(≥ xl) 격자 한 변 */
export const GRID_MAX = 520;
/** 2열 구간(md ~ xl) 상한 — 우측 열에 280px 이상을 남긴다 */
export const GRID_MD_MAX = 420;
/** 셀이 15px 밑으로 내려가면 라벨을 못 읽는다 */
export const GRID_MIN = 13 * 15;

/**
 * 컨테이너 폭 → 격자 한 변. 13 의 배수로 **내림**해 셀 경계가 반픽셀에 걸리지 않게 한다.
 * 375px 화면: 페이지 패딩 16×2 를 뺀 343 이 들어와 343 − 18 = 325 (셀 25px).
 */
export function gridSizeFor(containerWidth: number, max: number = GRID_MAX): number {
  const usable = Math.min(max, Math.floor(containerWidth) - AXIS_WIDTH);
  const snapped = Math.floor(usable / 13) * 13;
  return Math.max(GRID_MIN, snapped);
}

/**
 * 뷰포트 폭 구간별 격자 상한. `md` 구간에서 520 을 쓰면 우측 열이 280 밑으로 눌린다.
 */
export function gridMaxFor(viewportWidth: number): number {
  return viewportWidth >= 1280 || viewportWidth < 768 ? GRID_MAX : GRID_MD_MAX;
}

/**
 * 요소의 실제 폭 (`ResizeObserver`). 잴 수 없으면 `null` — 호출부가 기본값으로 떨어진다.
 *
 * `useLayoutEffect` 로 **첫 페인트 전에** 한 번 잰다: 페인트 후에 줄이면 모바일 브라우저가
 * 이미 layout viewport 를 넓힌 뒤라 축소가 남는다.
 */
export function useContainerWidth<T extends HTMLElement>(): [RefObject<T | null>, number | null] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = (): void => {
      const w = el.getBoundingClientRect().width;
      // jsdom 은 항상 0 을 준다. 0 을 폭으로 믿으면 최소 격자로 떨어지므로 null 로 남긴다.
      setWidth(w > 0 ? w : null);
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  return [ref, width];
}

/**
 * 미디어 쿼리 구독. `matchMedia` 가 없는 환경(jsdom)에서는 `fallback` 을 돌려준다.
 */
export function useMediaQuery(query: string, fallback: boolean): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? fallback
      : window.matchMedia(query).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent): void => {
      setMatches(e.matches);
    };
    mql.addEventListener('change', onChange);
    return () => {
      mql.removeEventListener('change', onChange);
    };
  }, [query]);

  return matches;
}

/** Tailwind `md`. 기본값 true — 테스트(jsdom)와 SSR 은 데스크톱 배치로 본다 */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)', true);
}

/**
 * 손가락 장치인가. 터치에는 호버가 없으므로 `onMouseMove` 를 아예 붙이지 않는다 —
 * 탭 한 번이 "호버 후 클릭" 으로 들어와 상태줄이 깜빡이는 것을 막는다 (P3M 4절).
 */
export function useHoverCapable(): boolean {
  return useMediaQuery('(hover: hover)', true);
}
