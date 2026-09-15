/**
 * 노드 경로 `line` 의 문법과 **슈트 순열** (P4.md 5.4).
 *
 * 문법은 `@ggto/core` 의 액션 문자열을 그대로 쓴다 (D3·D9·D10):
 * ```text
 * line := "" | seg ('/' seg)*
 * seg  := action ('-' action)*  |  card
 * action := 'F' | 'X' | 'C' | 'A' | 'B'amount | 'R'amount     // amount 단위 = bb
 * ```
 * `.` 이 구분자가 아닌 이유가 포스트플랍에서 **실제로** 필요하다: 사이즈가 `B6.6` 처럼
 * 소수를 가지므로 `.` 로 쪼개면 `B6` 과 `6` 으로 깨진다 (D3, phase-minus1 CRITICAL 1).
 *
 * 카드 세그먼트는 턴/리버로 깔린 카드다. 요청은 순순열(사용자 → 정규), 응답은
 * 역순열(정규 → 사용자)로 지난다. 이 왕복이 항등임을 테스트가 고정한다 (8.1).
 */

import { applyPermToCard, formatCard, parseCard, type SuitPerm } from '@ggto/core';
import { SolverError } from './types.js';

const ACTION_RE = /^(?:[FXCA]|[BR](?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?)$/;

function isCardToken(s: string): boolean {
  if (s.length !== 2) return false;
  try {
    parseCard(s);
    return true;
  } catch {
    return false;
  }
}

/** 문법 검사만 한다. "그 노드가 실제로 있는가" 는 데몬이 판정한다 (`NoSuchLine`). */
export function assertCanonicalLine(line: string): void {
  if (line === '') return;
  if (line.startsWith('/') || line.endsWith('/') || line.includes('//')) {
    throw new SolverError('NoSuchLine', `line has an empty segment: ${JSON.stringify(line)}`);
  }
  for (const seg of line.split('/')) {
    if (isCardToken(seg)) continue;
    if (seg.startsWith('-') || seg.endsWith('-') || seg.includes('--')) {
      throw new SolverError('NoSuchLine', `line has an empty action: ${JSON.stringify(line)}`);
    }
    for (const token of seg.split('-')) {
      if (!ACTION_RE.test(token)) {
        throw new SolverError('NoSuchLine', `not a canonical action token: ${JSON.stringify(token)}`);
      }
    }
  }
}

/** `line` 안의 카드 세그먼트에만 슈트 순열을 적용한다. 액션 토큰은 슈트를 모른다. */
export function permuteLine(line: string, perm: SuitPerm): string {
  if (line === '') return '';
  return line
    .split('/')
    .map((seg) => (isCardToken(seg) ? formatCard(applyPermToCard(parseCard(seg), perm)) : seg))
    .join('/');
}

/** `"2h7hKs"` 류 보드 문자열에 슈트 순열을 적용한다 (정규 ↔ 원본). */
export function permuteBoardString(board: string, perm: SuitPerm): string {
  let out = '';
  for (let i = 0; i < board.length; i += 2) {
    out += formatCard(applyPermToCard(parseCard(board.slice(i, i + 2)), perm));
  }
  return out;
}
