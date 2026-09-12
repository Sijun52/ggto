/**
 * 대비 게이트 (P3M 5절 / P3 R1 MINOR 8). WCAG 2.x AA = 14px 이하 텍스트 4.5:1.
 *
 * 동어반복이 아니다: 기대값을 `palette.ts` 에서 가져오지 않고, **클래스 문자열에서 hex 를
 * 뽑아** sRGB 상대 휘도 공식으로 직접 계산한다. 누가 `bg-[#f59e0b] text-[#fffbeb]` 로
 * 되돌리면 여기서 2.07 이 나와 깨진다.
 */

import { describe, expect, it } from 'vitest';
import { actionColors } from '../src/lib/chartGrid';
import {
  BADGE_NEUTRAL,
  BADGE_WARN,
  BTN_ACTIVE,
  BTN_DISABLED,
  BTN_NEUTRAL,
  BTN_NEXT,
  BTN_PRIMARY,
  PAGE_BG_HEX,
  TEXT_BODY,
  TEXT_DIM,
  TEXT_ERROR,
  TEXT_LINK,
  TEXT_STRONG,
  TEXT_WARN,
  VERDICT_CHIP,
  bestTextOn,
  contrastRatio,
  relativeLuminance,
} from '../src/lib/palette';

const AA = 4.5;

/** `bg-[#rrggbb] text-[#rrggbb]` → [배경, 글자] */
function pairOf(cls: string): [string, string] {
  const bg = /bg-\[(#[0-9a-f]{6})\]/i.exec(cls);
  const fg = /text-\[(#[0-9a-f]{6})\]/i.exec(cls);
  if (bg === null || fg === null) throw new Error(`색 쌍을 못 읽었다: ${cls}`);
  return [bg[1] as string, fg[1] as string];
}

function fgOf(cls: string): string {
  const fg = /text-\[(#[0-9a-f]{6})\]/i.exec(cls);
  if (fg === null) throw new Error(`글자색을 못 읽었다: ${cls}`);
  return fg[1] as string;
}

describe('P3M 5 대비 (WCAG AA 4.5:1)', () => {
  it('P3M 5 상대 휘도 공식이 WCAG 기준점과 맞는다', () => {
    // 검정 0, 흰색 1, 흰/검 대비 21 — 공식이 틀리면 여기서 먼저 깨진다.
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 10);
    // WCAG 예시값: #777777 on white = 4.48 (AA 경계 바로 아래)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('P3M 5 verdict 칩 6종이 전부 AA 이상이다', () => {
    const measured: Record<string, number> = {};
    for (const [verdict, cls] of Object.entries(VERDICT_CHIP)) {
      const [bg, fg] = pairOf(cls);
      measured[verdict] = contrastRatio(fg, bg);
    }
    for (const [verdict, ratio] of Object.entries(measured)) {
      expect(ratio, `${verdict} ${String(ratio)}`).toBeGreaterThanOrEqual(AA);
    }
    // P3 R1 이 잡은 최악값(Minor 2.07) 이 실제로 개선됐는지 못 박는다
    expect(measured['Minor'] as number).toBeGreaterThan(4.5);
  });

  it('P3M 5 버튼·배지의 글자/배경 쌍이 AA 이상이다', () => {
    for (const cls of [BTN_PRIMARY, BTN_NEXT, BTN_NEUTRAL, BTN_ACTIVE, BTN_DISABLED, BADGE_WARN, BADGE_NEUTRAL]) {
      const [bg, fg] = pairOf(cls);
      expect(contrastRatio(fg, bg), cls).toBeGreaterThanOrEqual(AA);
    }
  });

  it('P3M 5 본문 계열은 페이지 배경 위에서 AA 이상이다 (slate-500/600 퇴출)', () => {
    for (const cls of [TEXT_BODY, TEXT_DIM, TEXT_STRONG, TEXT_LINK, TEXT_WARN, TEXT_ERROR]) {
      expect(contrastRatio(fgOf(cls), PAGE_BG_HEX), cls).toBeGreaterThanOrEqual(AA);
    }
    // 옛 색들이 왜 퇴출됐는지 수치로 남긴다
    expect(contrastRatio('#64748b', PAGE_BG_HEX)).toBeLessThan(AA); // slate-500 4.24
    expect(contrastRatio('#475569', PAGE_BG_HEX)).toBeLessThan(AA); // slate-600 2.66
  });

  it('P3M 5 답 버튼은 **모든 액션 색**에서 AA 이상이다 (bestTextOn)', () => {
    // 시드 차트가 실제로 쓰는 액션 + 사이즈 램프 + 알 수 없는 토큰 폴백
    const actionSets = [
      ['F', 'A'],
      ['F', 'C'],
      ['F', 'X', 'C'],
      ['F', 'C', 'R2.5', 'R8', 'A'],
      ['F', 'B33', 'B75', 'B150'],
    ];
    const seen = new Set<string>(['#a855f7']); // 폴백 (chartGrid 의 기본값)
    for (const actions of actionSets) {
      for (const color of Object.values(actionColors(actions))) seen.add(color);
    }
    expect(seen.size).toBeGreaterThan(5);
    for (const color of seen) {
      expect(contrastRatio(bestTextOn(color), color), color).toBeGreaterThanOrEqual(AA);
    }
    // 고정 `slate-950` 글자였다면 실패했을 색이 실제로 있다 (스펙 5절 표의 구멍)
    expect(contrastRatio('#020617', '#dc2626')).toBeLessThan(AA); // A = 4.18
    expect(contrastRatio('#020617', '#64748b')).toBeLessThan(AA); // F = 4.24
  });

  it('P3M 5 bestTextOn 은 검정/흰 중 더 대비가 큰 쪽을 고른다', () => {
    expect(bestTextOn('#ffffff')).toBe('#000000');
    expect(bestTextOn('#000000')).toBe('#ffffff');
    for (const color of ['#dc2626', '#10b981', '#38bdf8', '#64748b', '#a855f7', '#f59e0b']) {
      const picked = bestTextOn(color);
      const other = picked === '#000000' ? '#ffffff' : '#000000';
      expect(contrastRatio(picked, color)).toBeGreaterThanOrEqual(contrastRatio(other, color));
    }
  });
});
