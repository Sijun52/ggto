/**
 * 세션 필터 JSON 파싱 (P3.md 5.1). `service.ts` 에서 떼어냈다 (P3 R1 MINOR 3).
 *
 * DB 에 저장된 문자열은 **이 빌드가 쓴 것이 아닐 수도 있다** (스키마가 늘어난 뒤 옛 행).
 * 모르는 키와 타입이 틀린 원소는 조용히 버린다 — 필터가 넓어질 뿐 기록은 살아남는다.
 */

import { isCategory, type SessionFilter } from './types.js';

export function parseFilter(json: string): SessionFilter {
  const raw = JSON.parse(json) as { contentHashes?: unknown; categories?: unknown };
  const out: SessionFilter = {};
  if (Array.isArray(raw.contentHashes)) out.contentHashes = raw.contentHashes.filter((h): h is string => typeof h === 'string');
  if (Array.isArray(raw.categories)) out.categories = raw.categories.filter(isCategory);
  return out;
}
