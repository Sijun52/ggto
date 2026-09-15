/**
 * 사이징 프리셋의 **표시용 역매핑** (P5.md 7절).
 *
 * `GET /api/solves` 의 `sizings` 는 정규화된 사이징 객체의 JSON 문자열이다 (프리셋 이름이
 * 아니다). 목록·탐색기는 그것을 이름으로 되돌려야 표기 쿼리를 만들 수 있고, 되돌리지
 * 못하면 **커스텀**(CLI 로 만든 솔브) 이라 정규 모드로만 연다 (1.1).
 *
 * 이 표는 서버 `@ggto/solver` 의 `SIZING_PRESETS` 와 같아야 한다 — `web/src` 는 그 패키지를
 * import 할 수 없으므로 (2절: `node:` 의존) 표를 복사하고, **테스트가 두 표를 대조한다**
 * (`web/test/sizingPresets.test.ts`). 드리프트는 테스트에서 죽는다.
 */

import type { SizingPresetName } from '@ggto/protocol';

export interface StreetSizing {
  bet: string;
  raise: string;
}
export interface Sizings {
  flop: StreetSizing;
  turn: StreetSizing;
  river: StreetSizing;
}

export const SIZING_PRESETS: Readonly<Record<SizingPresetName, Sizings>> = {
  simple: {
    flop: { bet: '33%,75%', raise: '2.5x' },
    turn: { bet: '75%', raise: '2.5x' },
    river: { bet: '75%', raise: '2.5x' },
  },
  standard: {
    flop: { bet: '33%,66%,125%', raise: '2.5x,4x' },
    turn: { bet: '50%,100%', raise: '2.5x,4x' },
    river: { bet: '50%,100%,200%', raise: '2.5x,4x' },
  },
  'river-heavy': {
    flop: { bet: '50%', raise: '3x' },
    turn: { bet: '75%', raise: '3x' },
    river: { bet: '33%,66%,100%,200%', raise: '3x' },
  },
};

export const PRESET_NAMES: readonly SizingPresetName[] = ['simple', 'standard', 'river-heavy'];

/** 서버와 같은 정규화: 공백 제거 + **문자열 정렬** (P4.md 3.1) */
function normalizeList(s: string): string {
  return s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .sort()
    .join(',');
}

function normalize(s: Sizings): Sizings {
  const street = (n: 'flop' | 'turn' | 'river'): StreetSizing => ({
    bet: normalizeList(s[n].bet),
    raise: normalizeList(s[n].raise),
  });
  return { flop: street('flop'), turn: street('turn'), river: street('river') };
}

function signature(s: Sizings): string {
  const n = normalize(s);
  return (['flop', 'turn', 'river'] as const).map((k) => `${k}:${n[k].bet}|${n[k].raise}`).join(';');
}

/** 목록 행의 `sizings` JSON → 프리셋 이름. 어느 프리셋도 아니면 `null` (= 커스텀) */
export function presetNameOf(sizingsJson: string): SizingPresetName | null {
  if (PRESET_NAMES.includes(sizingsJson as SizingPresetName)) return sizingsJson as SizingPresetName;
  let parsed: unknown;
  try {
    parsed = JSON.parse(sizingsJson);
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
  const s = parsed as Sizings;
  if (typeof s !== 'object' || s === null || typeof s.flop !== 'object') return null;
  const sig = signature(s);
  for (const name of PRESET_NAMES) {
    if (signature(SIZING_PRESETS[name]) === sig) return name;
  }
  return null;
}

/** 폼의 `select` 라벨 — 사이즈 목록을 병기한다 (프리셋 이름만으로는 무엇이 다른지 모른다) */
export function presetLabel(name: SizingPresetName): string {
  const p = SIZING_PRESETS[name];
  return `${name} — flop ${p.flop.bet} · turn ${p.turn.bet} · river ${p.river.bet}`;
}
