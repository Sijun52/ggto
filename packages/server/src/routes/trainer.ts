/**
 * /api/trainer/*. P3.md 7.
 *
 * **답하기 전에 전략/EV 가 나가지 않는다.** `/next` 응답의 `SpotDto` 에는 `strategy`·`ev`·
 * `reach` 가 아예 없고, 그 세 배열은 `/answer` 응답에서 처음 등장한다. 이것이 트레이너의
 * 유일한 보안 요구사항이고 테스트가 응답 전문을 grep 한다.
 *
 * 쿼리 파싱은 차트 라우트의 `queryParam` 을 쓴다 (D13: `URLSearchParams` 금지).
 */

import type {
  Category,
  GradeDto,
  ReportDto,
  SpotDto,
  TrainerAnswerResponse,
  TrainerNextResponse,
  TrainerPoolResponse,
  TrainerSessionResponse,
  TrainerSessionStatusResponse,
} from '@ggto/protocol';
import type { AnswerResult, Report, SpotView, TrainerService } from '@ggto/trainer';
import { CATEGORIES, formatCombo, MAX_SESSION_COUNT } from '@ggto/trainer';
import { Hono } from 'hono';
import { badRequest, trainerUnavailable } from '../errors.js';
import { readJsonBody } from '../http.js';
import { queryParam } from './charts.js';

const MAX_REPORT_DAYS = 365;
const DEFAULT_REPORT_DAYS = 30;
const MAX_MS_TAKEN = 600_000;

function toSpotDto(spot: SpotView): SpotDto {
  return {
    spotKey: spot.key,
    chartSetId: spot.chartSetId,
    chartName: spot.chartName,
    contentHash: spot.contentHash,
    seq: spot.seq,
    heroPos: spot.heroPos,
    potBb: spot.potBb,
    actions: [...spot.actions],
    combo: formatCombo(spot.combo),
    category: spot.category,
    gradedBy: spot.gradedBy,
    config: spot.config,
    resolution: spot.resolution,
  };
}

// 리포트는 순수 JSON 값만 담고 있어 구조가 같다. 두 선언이 갈라지면 여기서 타입체크가 깨진다.
function toReportDto(report: Report): ReportDto {
  return report;
}

function toGradeDto(result: AnswerResult): GradeDto {
  const g = result.grade;
  return {
    gradedBy: g.gradedBy,
    verdict: g.verdict,
    evLossBb: g.evLossBb,
    chosenAction: g.chosenAction,
    chosenFreq: g.chosenFreq,
    bestAction: g.bestAction,
    bestEvBb: g.bestEvBb,
    mixed: g.mixed,
    actions: g.actions,
  };
}

function toNodeDto(result: AnswerResult): TrainerAnswerResponse['node'] {
  const n = result.node;
  return {
    seq: n.seq,
    heroPos: n.heroPos,
    potBb: n.potBb,
    actions: n.actions,
    hasEv: n.hasEv,
    strategy: n.strategy.map((r) => Array.from(r)),
    ev: n.ev === null ? null : n.ev.map((r) => Array.from(r)),
    reach: Array.from(result.reach),
  };
}

function requireInt(body: Record<string, unknown>, field: string, min: number, max: number): number {
  const v = body[field];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw badRequest(`field ${JSON.stringify(field)} must be an integer in [${String(min)}, ${String(max)}]`);
  }
  return v;
}

function optionalIntArray(body: Record<string, unknown>, field: string): number[] | undefined {
  const v = body[field];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'number' || !Number.isInteger(x))) {
    throw badRequest(`field ${JSON.stringify(field)} must be an array of integers`);
  }
  return v as number[];
}

function optionalCategories(body: Record<string, unknown>): Category[] | undefined {
  const v = body['categories'];
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw badRequest('field "categories" must be an array');
  for (const c of v) {
    if (typeof c !== 'string' || !(CATEGORIES as readonly string[]).includes(c)) {
      throw badRequest(`unknown category ${JSON.stringify(c)} (known: ${CATEGORIES.join(', ')})`);
    }
  }
  return v as Category[];
}

function requireStringField(body: Record<string, unknown>, field: string, maxChars: number): string {
  const v = body[field];
  if (typeof v !== 'string' || v.length === 0 || v.length > maxChars) {
    throw badRequest(`field ${JSON.stringify(field)} must be a non-empty string of at most ${String(maxChars)} characters`);
  }
  return v;
}

function sessionIdFromQuery(url: string): number {
  const raw = queryParam(url, 'session');
  const n = raw === null ? Number.NaN : Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw badRequest(`query parameter "session" must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}

export function trainerRoutes(trainer: TrainerService | null): Hono {
  const app = new Hono();

  /**
   * 차트와 달리 "저장소 없음 = 빈 목록" 이 아니다. 세션을 만들 수 없는 것은 장애이므로
   * 503 이고, 화면은 빈 트레이너를 그리는 대신 이유를 보여준다 (P3.md 7).
   */
  const need = (): TrainerService => {
    if (trainer === null) throw trainerUnavailable();
    return trainer;
  };

  app.get('/trainer/pool', (c) => {
    const info = need().poolInfo();
    const body: TrainerPoolResponse = { categories: info.categories, nodes: info.nodes };
    return c.json(body);
  });

  app.post('/trainer/session', async (c) => {
    const t = need();
    const body = await readJsonBody(c);
    const count = requireInt(body, 'count', 1, MAX_SESSION_COUNT);
    const sets = optionalIntArray(body, 'sets');
    const categories = optionalCategories(body);
    const seed = body['seed'] === undefined ? undefined : requireInt(body, 'seed', 0, 2 ** 31 - 1);
    const req: Parameters<TrainerService['createSession']>[0] = { count };
    if (sets !== undefined) req.contentHashes = t.hashesForSetIds(sets);
    if (categories !== undefined) req.categories = categories;
    if (seed !== undefined) req.seed = seed;
    const info = t.createSession(req);
    const res: TrainerSessionResponse = { sessionId: info.sessionId, seed: info.seed, count: info.count };
    return c.json(res);
  });

  app.get('/trainer/next', (c) => {
    const result = need().next(sessionIdFromQuery(c.req.url));
    const body: TrainerNextResponse = result.done
      ? { done: true, report: toReportDto(result.report) }
      : { done: false, index: result.index, count: result.count, spot: toSpotDto(result.spot) };
    return c.json(body);
  });

  app.post('/trainer/answer', async (c) => {
    const t = need();
    const body = await readJsonBody(c);
    const sessionId = requireInt(body, 'sessionId', 1, Number.MAX_SAFE_INTEGER);
    const spotKey = requireStringField(body, 'spotKey', 256);
    const action = requireStringField(body, 'action', 16);
    // 클램프는 서비스가 하지만(DB CHECK 과 같은 규칙) 숫자가 아닌 값은 여기서 거른다.
    const msRaw = body['msTaken'];
    if (typeof msRaw !== 'number' || !Number.isFinite(msRaw)) {
      throw badRequest('field "msTaken" must be a finite number');
    }
    const result = t.answer({ sessionId, spotKey, action, msTaken: Math.min(MAX_MS_TAKEN, Math.max(0, msRaw)) });
    const res: TrainerAnswerResponse = { grade: toGradeDto(result), node: toNodeDto(result) };
    return c.json(res);
  });

  app.get('/trainer/session/:id', (c) => {
    const raw = c.req.param('id');
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1) throw badRequest(`session id must be a positive integer, got ${JSON.stringify(raw)}`);
    const s = need().sessionStatus(id);
    const body: TrainerSessionStatusResponse = {
      sessionId: s.sessionId,
      count: s.count,
      answered: s.answered,
      finished: s.finished,
      report: toReportDto(s.report),
    };
    return c.json(body);
  });

  app.get('/trainer/report', (c) => {
    const raw = queryParam(c.req.url, 'days');
    const days = raw === null ? DEFAULT_REPORT_DAYS : Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > MAX_REPORT_DAYS) {
      throw badRequest(`query parameter "days" must be an integer in [1, ${String(MAX_REPORT_DAYS)}]`);
    }
    return c.json(toReportDto(need().report({ days })));
  });

  return app;
}
