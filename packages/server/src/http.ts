/**
 * 요청 본문 읽기 + 형식 검증. P1.md 3.1 / 3.3.
 *
 * zod 같은 검증 라이브러리를 쓰지 않는다 (P1.md 1절). 스키마가 4개뿐이라
 * 손으로 쓰는 편이 의존성보다 싸고, 에러 문구를 우리가 직접 정한다.
 */

import { API_LIMITS } from '@ggto/protocol';
import type { Context } from 'hono';
import { badRequest, payloadTooLarge } from './errors.js';

export async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  const declared = c.req.header('content-length');
  if (declared !== undefined) {
    const n = Number(declared);
    // 헤더를 믿어서가 아니라, 큰 본문을 메모리에 올리기 전에 끊기 위해 먼저 본다.
    if (Number.isFinite(n) && n > API_LIMITS.bodyBytes) {
      throw payloadTooLarge(`request body exceeds ${String(API_LIMITS.bodyBytes)} bytes`);
    }
  }
  const raw = await c.req.text();
  // 헤더가 없거나 거짓말이어도 실제 바이트 수로 다시 막는다.
  if (new TextEncoder().encode(raw).length > API_LIMITS.bodyBytes) {
    throw payloadTooLarge(`request body exceeds ${String(API_LIMITS.bodyBytes)} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw badRequest('request body must be valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw badRequest('request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function requireString(body: Record<string, unknown>, field: string, maxChars: number): string {
  const v = body[field];
  if (typeof v !== 'string') {
    throw badRequest(`field ${JSON.stringify(field)} must be a string`);
  }
  if (v.length > maxChars) {
    throw badRequest(`field ${JSON.stringify(field)} exceeds ${String(maxChars)} characters`);
  }
  return v;
}

export function optionalInt(
  body: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number | undefined {
  const v = body[field];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw badRequest(
      `field ${JSON.stringify(field)} must be an integer in [${String(min)}, ${String(max)}]`,
    );
  }
  return v;
}
