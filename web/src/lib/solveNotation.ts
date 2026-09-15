/**
 * 사용자의 **슈트 표기** 보관 (P5.md 1.2, D26).
 *
 * 서버 행(`config_json`)은 정규 보드 기준 hex 라 "사용자가 `Ks7h2h` 라고 쳤다" 는 사실을
 * 되살릴 수 없다. 그 사실의 출처는 **폼뿐**이고, URL 에 넣기에는 레인지 텍스트 두 개가
 * 최대 8KB 라 상한을 넘는다. 그래서 `localStorage` 에 해시별로 둔다. URL 은 `hash`·`line`
 * 둘뿐이다 (공유 URL 이 남의 브라우저에서 400 이 되는 것보다 정규 표기로 열리는 것이 낫다).
 *
 * 해시는 **클라이언트가 계산하지 않는다** — `@ggto/solver` 는 `node:` 의존이라 웹에 못
 * 들어온다. 표기가 이 솔브의 것인지 판정하는 것은 서버다 (`HashMismatch`).
 */

import type { SizingPresetName } from '@ggto/protocol';

export interface SolveNotation {
  /** 사용자가 폼에 친 그대로 ("Ks7h2h") */
  board: string;
  oop: string;
  ip: string;
  potBb: number;
  stackBb: number;
  sizings: SizingPresetName;
  compressed: boolean;
  rake: { mode: 'none' } | { mode: 'pot'; pct: number; capBb: number };
}

const PREFIX = 'ggto.solve.notation.';

const isPreset = (v: unknown): v is SizingPresetName =>
  v === 'simple' || v === 'standard' || v === 'river-heavy';

/** 저장된 값이 우리가 쓴 모양인지. 아니면 **없는 것으로 친다** (정규 모드로 연다). */
function parse(raw: string): SolveNotation | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.board !== 'string' || typeof o.oop !== 'string' || typeof o.ip !== 'string') return null;
  if (typeof o.potBb !== 'number' || typeof o.stackBb !== 'number') return null;
  if (!isPreset(o.sizings) || typeof o.compressed !== 'boolean') return null;
  const rake = o.rake as SolveNotation['rake'] | undefined;
  const okRake =
    rake !== undefined &&
    typeof rake === 'object' &&
    (rake.mode === 'none' || (rake.mode === 'pot' && typeof rake.pct === 'number' && typeof rake.capBb === 'number'));
  if (!okRake) return null;
  return {
    board: o.board,
    oop: o.oop,
    ip: o.ip,
    potBb: o.potBb,
    stackBb: o.stackBb,
    sizings: o.sizings,
    compressed: o.compressed,
    rake,
  };
}

function storage(): Storage | null {
  // 사생활 모드/비활성화 스토리지에서 접근 자체가 던진다. 표기를 못 쓰는 것은 치명적이지
  // 않다 (정규 모드로 열린다) — 그러나 조용히 삼키지 않고 콘솔에 남긴다.
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch (e) {
    console.error(`[ggto] localStorage is unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export function loadNotation(hash: string): SolveNotation | null {
  const s = storage();
  if (s === null) return null;
  const raw = s.getItem(PREFIX + hash);
  return raw === null ? null : parse(raw);
}

export function saveNotation(hash: string, notation: SolveNotation): void {
  const s = storage();
  if (s === null) return;
  s.setItem(PREFIX + hash, JSON.stringify(notation));
}

export function clearNotation(hash: string): void {
  const s = storage();
  if (s === null) return;
  s.removeItem(PREFIX + hash);
}

/**
 * 표기 → `node`/`runouts` 쿼리 문자열 (P5.md 1.1 표기 모드).
 *
 * 다섯 파라미터는 **전부** 보낸다 (부분집합은 서버가 400 이다). `encodeURIComponent` 로
 * 인코딩한다 — `URLSearchParams` 는 form-urlencoded 규칙이라 리터럴 `+` 를 공백으로 바꿔
 * `22+,A2s+` 를 조용히 다른 레인지로 만든다 (D13).
 */
export function notationQuery(notation: SolveNotation | null): string {
  if (notation === null) return '';
  const parts = [
    `board=${encodeURIComponent(notation.board)}`,
    `oop=${encodeURIComponent(notation.oop)}`,
    `ip=${encodeURIComponent(notation.ip)}`,
    `potBb=${encodeURIComponent(String(notation.potBb))}`,
    `stackBb=${encodeURIComponent(String(notation.stackBb))}`,
    `sizings=${encodeURIComponent(notation.sizings)}`,
  ];
  // 서버는 `1`·`true` 를 참으로 읽는다 (P5 12절 R2-2). 거짓이면 아예 보내지 않는다.
  if (notation.compressed) parts.push('compressed=1');
  if (notation.rake.mode === 'pot') {
    parts.push(`rakePct=${encodeURIComponent(String(notation.rake.pct))}`);
    parts.push(`rakeCapBb=${encodeURIComponent(String(notation.rake.capBb))}`);
  }
  return parts.join('&');
}

/** TanStack 쿼리 키용 — 표기가 바뀌면 다른 키가 된다 */
export function notationKey(notation: SolveNotation | null): string {
  return notation === null ? '' : notationQuery(notation);
}
