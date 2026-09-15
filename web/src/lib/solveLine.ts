/**
 * 포스트플랍 `line` 문법 — 클라이언트 측 (P5.md 1.3, D3).
 *
 * ```text
 * line := "" | seg ('/' seg)*
 * seg  := action ('-' action)*  |  card
 * ```
 * 액션 토큰의 정본은 **`@ggto/core`** 다 (`parseActionSequence`) — 여기서 정규식을 다시
 * 쓰지 않는다. 이 파일이 덧붙이는 것은 **카드 세그먼트** 하나뿐이다 (턴/리버로 깔린 카드).
 *
 * 프리플랍의 `breadcrumbSeqs`(`ChartsPage`) 를 재사용하지 않는 이유: 그쪽은 `-` 만 알고
 * 카드 세그먼트가 없다. 액션 토큰 `A`(올인) 와 카드 `Ah` 는 **길이**로 갈린다.
 *
 * P6 가 `Solve{hash, line}` 스팟 키에 이 문자열을 그대로 쓴다.
 */

import { ActionSyntaxError, parseActionSequence, parseCard } from '@ggto/core';

export type StreetName = 'flop' | 'turn' | 'river';

export const STREET_ORDER: readonly StreetName[] = ['flop', 'turn', 'river'];

export const STREET_LABEL: Readonly<Record<StreetName, string>> = {
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
};

export type LineSegment = { street: StreetName; actions: string[] } | { card: string };

export function isCardSegment(seg: LineSegment): seg is { card: string } {
  return 'card' in seg;
}

/** 두 글자이고 core 가 카드로 읽으면 카드 토큰이다 (`A` 는 1글자라 액션). */
export function isCardToken(token: string): boolean {
  if (token.length !== 2) return false;
  try {
    parseCard(token);
    return true;
  } catch (e) {
    // 카드 문법 오류만 "카드가 아니다" 로 읽는다. 다른 예외는 삼키지 않는다.
    if (e instanceof Error && e.name === 'CardSyntaxError') return false;
    throw e;
  }
}

/**
 * core 의 토크나이저로 **액션 토큰 하나**를 검사한다 (`b33`·`x` 같은 비정규형은 거짓).
 *
 * 빈 문자열은 core 에서 "빈 시퀀스"(루트) 라 통과한다 — 토큰으로는 거짓이다.
 * `-`·`/` 가 들어간 것은 토큰이 아니라 시퀀스다.
 */
export function isActionToken(token: string): boolean {
  if (token === '' || token.includes('-') || token.includes('/')) return false;
  try {
    parseActionSequence(token);
    return true;
  } catch (e) {
    if (e instanceof ActionSyntaxError) return false;
    throw e;
  }
}

/**
 * 자식 노드의 `line`.
 *
 * - 카드 토큰은 **항상 `/`** 로 붙는다 (세그먼트 하나를 통째로 차지한다).
 * - 액션 토큰은 같은 스트리트 안이면 `-`, 카드 뒤의 첫 액션이면 `/` 다.
 */
export function childLine(line: string, token: string): string {
  if (isCardToken(token)) return line === '' ? token : `${line}/${token}`;
  if (line === '') return token;
  const segs = line.split('/');
  const last = segs[segs.length - 1] as string;
  return isCardToken(last) ? `${line}/${token}` : `${line}-${token}`;
}

/** 토큰 하나 뒤로. 카드 세그먼트도 토큰 하나다. 루트의 부모는 루트다. */
export function parentLine(line: string): string {
  if (line === '') return '';
  const segs = line.split('/');
  const last = segs.pop() as string;
  if (isCardToken(last)) return segs.join('/');
  const tokens = last.split('-');
  tokens.pop();
  if (tokens.length === 0) return segs.join('/');
  return [...segs, tokens.join('-')].join('/');
}

/**
 * 세그먼트 분해. `startStreet` 는 **솔브의 시작 스트리트**다 (턴 솔브면 `'turn'`) —
 * 카드 세그먼트를 지날 때마다 한 칸 내려간다. 클라이언트가 보드 길이로 추측하지 않는다.
 */
export function segments(line: string, startStreet: StreetName = 'flop'): LineSegment[] {
  if (line === '') return [];
  let street = startStreet;
  const out: LineSegment[] = [];
  for (const seg of line.split('/')) {
    if (isCardToken(seg)) {
      out.push({ card: seg });
      street = nextStreet(street);
      continue;
    }
    out.push({ street, actions: seg.split('-') });
  }
  return out;
}

export function nextStreet(street: StreetName): StreetName {
  const i = STREET_ORDER.indexOf(street);
  return (STREET_ORDER[Math.min(i + 1, STREET_ORDER.length - 1)] as StreetName);
}

/**
 * 응답의 `street`(현재 노드) 과 `line` 에서 **솔브의 시작 스트리트**를 되돌린다.
 * 라인 안의 카드 세그먼트 수만큼 거슬러 올라간다.
 */
export function rootStreetOf(currentStreet: StreetName, line: string): StreetName {
  const dealt = line === '' ? 0 : line.split('/').filter(isCardToken).length;
  const i = STREET_ORDER.indexOf(currentStreet) - dealt;
  return (STREET_ORDER[Math.max(0, i)] as StreetName);
}

/** 브레드크럼 칩: 루트부터 각 토큰까지의 접두 라인과 라벨 */
export interface LineCrumb {
  line: string;
  label: string;
  /** 카드 토큰인가 (칩 색을 가른다) */
  card: boolean;
  street: StreetName;
}

export function crumbs(line: string, startStreet: StreetName = 'flop'): LineCrumb[] {
  const out: LineCrumb[] = [];
  let acc = '';
  let street = startStreet;
  for (const seg of segments(line, startStreet)) {
    if (isCardSegment(seg)) {
      acc = childLine(acc, seg.card);
      street = nextStreet(street);
      out.push({ line: acc, label: seg.card, card: true, street });
      continue;
    }
    for (const a of seg.actions) {
      acc = childLine(acc, a);
      out.push({ line: acc, label: a, card: false, street });
    }
  }
  return out;
}
