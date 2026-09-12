/**
 * 도메인 에러 → HTTP 매핑. P1.md 3.1.
 *
 * 라우트 핸들러는 core 함수를 그대로 부르고 throw 를 흘려보낸다.
 * 이 모듈 하나만 상태 코드와 봉투 모양을 안다.
 */

import {
  ActionSyntaxError,
  CardSyntaxError,
  EmptyRangeError,
  RangeSyntaxError,
  UnsupportedError,
} from '@ggto/core';
import { ChartValidationError, MissingNodeError, UnknownPositionError } from '@ggto/preflop';
import {
  EmptyPoolError,
  GradeError,
  MissingChartError,
  SessionNotFoundError,
  SpotKeyError,
  SpotMismatchError,
  TrainerInputError,
} from '@ggto/trainer';
import type { ErrorEnvelope } from '@ggto/protocol';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** 서버가 스스로 만드는 에러 (도메인 에러가 아닌 프로토콜/형식 문제). */
export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string): HttpError => new HttpError(400, 'BadRequest', message);
export const notFound = (message: string): HttpError => new HttpError(404, 'NotFound', message);
export const payloadTooLarge = (message: string): HttpError =>
  new HttpError(413, 'PayloadTooLarge', message);
/** 차트 트리에 그 노드가 없다 (P2.md 8). 저장소가 던지는 MissingNodeError 와 같은 코드로 나간다. */
export const missingNode = (seq: string): HttpError =>
  new HttpError(404, 'MissingNode', `no chart node for action sequence ${JSON.stringify(seq)}`);
/**
 * 트레이너가 주입되지 않았다. 차트와 달리 "없음 = 빈 목록" 이 아니다 — 세션을 만들 수
 * 없는 것은 장애다 (P3.md 7).
 */
export const trainerUnavailable = (): HttpError =>
  new HttpError(503, 'TrainerUnavailable', 'the trainer is not available on this server');

/**
 * 400 으로 나가는 도메인 에러들. `err.name` 대신 생성자로 판정하고 코드 문자열은 명시한다 —
 * name/Ctor.name 은 런타임에 덮어쓰이거나 번들러에 의해 바뀔 수 있지만 와이어 계약은 고정이어야 한다.
 * 이 목록이 곧 "사용자 입력 탓(400)" 의 정의다.
 */
const DOMAIN_ERRORS: readonly (readonly [new (...args: never[]) => Error, string])[] = [
  [RangeSyntaxError, 'RangeSyntaxError'],
  [CardSyntaxError, 'CardSyntaxError'],
  [EmptyRangeError, 'EmptyRangeError'],
  [UnsupportedError, 'UnsupportedError'],
  [ActionSyntaxError, 'ActionSyntaxError'],
  // P2: 파일/질의가 도메인 규칙을 어긴 경우. 임포트 API 는 P2 에 없지만 매핑은 미리 둔다.
  [ChartValidationError, 'ChartValidationError'],
  [UnknownPositionError, 'BadRequest'],
  // P3 트레이너. 상태 코드는 이 파일만 안다 (라우트는 도메인 에러를 그대로 흘려보낸다).
  [SpotKeyError, 'SpotKeyError'],
  [EmptyPoolError, 'EmptyPool'],
  [GradeError, 'BadRequest'],
  [TrainerInputError, 'BadRequest'],
];

/** 400 이 아닌 트레이너 에러들. */
const TRAINER_ERRORS: readonly (readonly [new (...args: never[]) => Error, string, ContentfulStatusCode])[] = [
  [SessionNotFoundError, 'SessionNotFound', 404],
  [SpotMismatchError, 'SpotMismatch', 409],
  [MissingChartError, 'MissingChart', 404],
];

export interface MappedError {
  status: ContentfulStatusCode;
  body: ErrorEnvelope;
  /** true 면 호출 측이 스택을 서버 로그에 남긴다 (500 만) */
  log: boolean;
}

export function mapError(err: unknown): MappedError {
  // 부분 트리 질의는 "없다" 이지 "잘못됐다" 가 아니다 → 404 (P2.md 3.4).
  if (err instanceof MissingNodeError) {
    return { status: 404, body: { error: { code: 'MissingNode', message: err.message } }, log: false };
  }
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message } }, log: false };
  }
  for (const [Ctor, code, status] of TRAINER_ERRORS) {
    if (err instanceof Ctor) {
      return { status, body: { error: { code, message: err.message } }, log: false };
    }
  }
  for (const [Ctor, code] of DOMAIN_ERRORS) {
    if (err instanceof Ctor) {
      return { status: 400, body: { error: { code, message: err.message } }, log: false };
    }
  }
  // 예상 못 한 예외는 메시지를 밖으로 내보내지 않는다 (경로/스택 유출 방지).
  return { status: 500, body: { error: { code: 'Internal', message: 'internal error' } }, log: true };
}
