/**
 * 색 한 곳 모음 (P3M 5절). 흩어진 Tailwind 색 이름 대신 **리터럴 hex** 를 쓴다.
 *
 * 이유: Tailwind v4 의 기본 팔레트는 oklch 로 정의돼 있어 "`amber-500` 의 대비가 얼마인가"
 * 를 소스만 보고 잴 수 없다. 여기에 hex 를 박아 두면 `palette.test.ts` 가 클래스 문자열에서
 * hex 쌍을 뽑아 WCAG 상대 휘도로 직접 계산해 게이트를 건다 (P3M 5절 / P3 R1 MINOR 8).
 *
 * 배경은 페이지 `#020617`. 14px 이하 텍스트는 WCAG AA 4.5:1 이 필요하다.
 */

import type { Verdict } from '@ggto/protocol';

/** 페이지 배경. 대비 계산의 기준점이다. */
export const PAGE_BG_HEX = '#020617';

// --- WCAG 상대 휘도 / 대비 (sRGB, WCAG 2.x) --------------------------------

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n) || hex.length !== 7) throw new Error(`palette: bad hex ${hex}`);
  return (
    0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff)
  );
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * 임의 배경색 위에 올릴 글자색: 검정/흰색 중 대비가 높은 쪽.
 *
 * 액션 색(`actionColors`)은 P2 에서 정한 **의미 색**이라 바꿀 수 없는데, `slate-950` 글자를
 * 고정하면 `A`(`#dc2626`) 4.18 · `F`(`#64748b`) 4.24 로 AA 에 미달한다 (P3M 5절 표는
 * 램프 끝 `#ef4444` 5.36 만 재서 이 둘을 놓쳤다). 글자색을 배경에서 유도하면
 * 최악 4.71 로 올라간다 — 측정은 `palette.test.ts`.
 */
export function bestTextOn(bgHex: string): string {
  return contrastRatio('#000000', bgHex) >= contrastRatio('#ffffff', bgHex) ? '#000000' : '#ffffff';
}

// --- 텍스트 ----------------------------------------------------------------

/** 본문 (14px+). `slate-400` 계열, 7.87:1 */
export const TEXT_BODY = 'text-[#cbd5e1]';
/** 보조·데이터 (12px 이상 어디에나 쓸 수 있다). 7.87:1 — 옛 `slate-500` 4.24 를 대체 */
export const TEXT_DIM = 'text-[#94a3b8]';
/** 강조 본문 */
export const TEXT_STRONG = 'text-[#f1f5f9]';
/** 링크. 9.42:1 */
export const TEXT_LINK = 'text-[#38bdf8]';
/** 경고·주의 문구. 13.99:1 */
export const TEXT_WARN = 'text-[#fcd34d]';
/** 오류. 7.29:1 */
export const TEXT_ERROR = 'text-[#f87171]';

// --- 버튼 ------------------------------------------------------------------

/** 주 동작 (세션 시작 / 새 세션). 7.88:1 */
export const BTN_PRIMARY = 'bg-[#34d399] text-[#022c22]';
/** 다음 스팟. 6.48:1 — 옛 `sky-50/sky-600` 3.84 를 대체 */
export const BTN_NEXT = 'bg-[#38bdf8] text-[#082f49]';
/** 중립 (모드·라인·크럼). 12.02:1 */
export const BTN_NEUTRAL = 'bg-[#0f172a] text-[#cbd5e1]';
/** 눌린 탭. 9.45:1 */
export const BTN_ACTIVE = 'bg-[#334155] text-[#f1f5f9]';
/** 비활성. `opacity` 로 흐리지 않는다 (대비가 같이 떨어진다) — 명시 색 5.71:1 */
export const BTN_DISABLED = 'bg-[#1e293b] text-[#94a3b8]';

/** 빈도 채점 배지. 8.97:1 */
export const BADGE_WARN = 'bg-[#fbbf24] text-[#451a03]';
/** 혼합 스팟 배지. 12.02:1 */
export const BADGE_NEUTRAL = 'bg-[#1e293b] text-[#cbd5e1]';

// --- verdict 칩 (P3M 5절) ---------------------------------------------------

export const VERDICT_CHIP: Record<Verdict, string> = {
  Perfect: 'bg-[#34d399] text-[#022c22]', // 7.88
  Minor: 'bg-[#fbbf24] text-[#451a03]', // 8.97
  Mistake: 'bg-[#fb923c] text-[#431407]', // 6.92
  Blunder: 'bg-[#f87171] text-[#450a0a]', // 5.84
  InStrategy: 'bg-[#38bdf8] text-[#082f49]', // 6.48
  OffStrategy: 'bg-[#94a3b8] text-[#020617]', // 7.87
};

// --- 면 -------------------------------------------------------------------

export const SURFACE = 'bg-[#0f172a]';
export const SURFACE_RAISED = 'bg-[#1e293b]';
export const PAGE = 'bg-[#020617] text-[#e2e8f0]';
export const BORDER = 'border-[#334155]';

/**
 * 터치 타겟 최소 44×44 (P3M 4절).
 *
 * `md:` 로 해제하되 **손가락 장치에서는 폭과 무관하게 유지**한다: `md` 는 정확히 768px
 * 이고 세로 태블릿이 딱 그 폭이라, 폭만 보면 손가락으로 20px 버튼을 누르게 된다
 * (768x1024 `pointer: coarse` 실측에서 10개가 20px 로 줄었다).
 */
export const TOUCH =
  'min-h-11 min-w-11 md:min-h-0 md:min-w-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11';
/** 하단 바의 큰 버튼: 48px */
export const TOUCH_LG = 'min-h-12';
