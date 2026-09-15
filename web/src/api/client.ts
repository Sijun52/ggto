/**
 * fetch 래퍼. 에러 봉투 → ApiError. P1.md 4절.
 *
 * 1326 배열은 받는 즉시 Float32Array 로 바꾼다 — number[] 를 격자까지 끌고 가면
 * 계산 표현(f32)과 전송 표현(JSON number)이 화면에서 섞인다 (P0.md 2절 규약).
 */

import { API_ROUTES } from '@ggto/protocol';
import type {
  EquityRequest,
  EquityResponse,
  ErrorEnvelope,
  HealthResponse,
  ParseRangeRequest,
  ParseRangeResponse,
} from '@ggto/protocol';
import type { Range } from '@ggto/core';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function isErrorEnvelope(v: unknown): v is ErrorEnvelope {
  if (typeof v !== 'object' || v === null) return false;
  const e = (v as { error?: unknown }).error;
  if (typeof e !== 'object' || e === null) return false;
  return typeof (e as { code?: unknown }).code === 'string' && typeof (e as { message?: unknown }).message === 'string';
}

/** GET + 에러 봉투 → ApiError. P2 차트 조회는 전부 GET 이다. */
export async function getJson<TRes>(path: string): Promise<TRes> {
  const res = await fetch(path);
  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError(res.status, 'BadResponse', `server sent non-JSON (${String(res.status)})`);
  }
  if (!res.ok) {
    if (isErrorEnvelope(parsed)) throw new ApiError(res.status, parsed.error.code, parsed.error.message);
    throw new ApiError(res.status, 'BadResponse', `request failed with status ${String(res.status)}`);
  }
  return parsed as TRes;
}

export async function postJson<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError(res.status, 'BadResponse', `server sent non-JSON (${String(res.status)})`);
  }
  if (!res.ok) {
    if (isErrorEnvelope(parsed)) throw new ApiError(res.status, parsed.error.code, parsed.error.message);
    throw new ApiError(res.status, 'BadResponse', `request failed with status ${String(res.status)}`);
  }
  return parsed as TRes;
}

/**
 * DELETE. 204(본문 없음) 와 202(JSON 본문) 를 둘 다 받는다 — 본문은 쓰지 않는다.
 * `postJson` 을 쓰면 204 의 빈 본문에서 `JSON.parse('')` 가 터져 성공이 실패로 보인다.
 */
export async function deleteRequest(path: string): Promise<void> {
  const res = await fetch(path, { method: 'DELETE' });
  if (res.ok) return;
  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError(res.status, 'BadResponse', `server sent non-JSON (${String(res.status)})`);
  }
  if (isErrorEnvelope(parsed)) throw new ApiError(res.status, parsed.error.code, parsed.error.message);
  throw new ApiError(res.status, 'BadResponse', `request failed with status ${String(res.status)}`);
}

/** 서버 응답을 화면이 쓰는 표현으로 옮긴 것. weights 는 여기서만 number[] 였다. */
export interface ParsedRange {
  /** 정규형 에코 */
  text: string;
  comboCount: number;
  totalWeight: number;
  weights: Range;
}

export async function parseRangeApi(text: string): Promise<ParsedRange> {
  const res = await postJson<ParseRangeRequest, ParseRangeResponse>(API_ROUTES.rangeParse, { text });
  return {
    text: res.text,
    comboCount: res.comboCount,
    totalWeight: res.totalWeight,
    weights: Float32Array.from(res.weights),
  };
}

export async function equityApi(req: EquityRequest): Promise<EquityResponse> {
  return await postJson<EquityRequest, EquityResponse>(API_ROUTES.rangeEquity, req);
}

export async function healthApi(): Promise<HealthResponse> {
  const res = await fetch(API_ROUTES.health);
  if (!res.ok) throw new ApiError(res.status, 'BadResponse', 'health check failed');
  return (await res.json()) as HealthResponse;
}
