/**
 * /api/trainer/* 클라이언트. P3.md 7·8.
 *
 * `next` 응답에는 `strategy`/`ev`/`reach` 가 **없다** — 답하기 전에는 정답이 브라우저에
 * 존재하지 않는다. 그 세 배열은 `answer` 응답에서 처음 나타나고, 받는 즉시 뷰어와 같은
 * `ChartNodeView`(Float32Array) 표현으로 바꾼다.
 */

import type {
  Category,
  ReportDto,
  TrainerAnswerRequest,
  TrainerAnswerResponse,
  TrainerNextResponse,
  TrainerPoolResponse,
  TrainerSessionRequest,
  TrainerSessionResponse,
  TrainerSessionStatusResponse,
} from '@ggto/protocol';
import type { ChartNodeView } from './charts';
import { getJson, postJson } from './client';

export interface AnsweredNode {
  grade: TrainerAnswerResponse['grade'];
  node: ChartNodeView;
}

export async function fetchTrainerPool(): Promise<TrainerPoolResponse> {
  return await getJson<TrainerPoolResponse>('/api/trainer/pool');
}

export async function createTrainerSession(req: TrainerSessionRequest): Promise<TrainerSessionResponse> {
  return await postJson<TrainerSessionRequest, TrainerSessionResponse>('/api/trainer/session', req);
}

export async function fetchTrainerNext(sessionId: number): Promise<TrainerNextResponse> {
  return await getJson<TrainerNextResponse>(`/api/trainer/next?session=${String(sessionId)}`);
}

export async function fetchTrainerSession(sessionId: number): Promise<TrainerSessionStatusResponse> {
  return await getJson<TrainerSessionStatusResponse>(`/api/trainer/session/${String(sessionId)}`);
}

export async function fetchTrainerReport(days: number): Promise<ReportDto> {
  return await getJson<ReportDto>(`/api/trainer/report?days=${String(days)}`);
}

export async function answerTrainer(req: TrainerAnswerRequest): Promise<AnsweredNode> {
  const res = await postJson<TrainerAnswerRequest, TrainerAnswerResponse>('/api/trainer/answer', req);
  const n = res.node;
  return {
    grade: res.grade,
    node: {
      seq: n.seq,
      heroPos: n.heroPos,
      potBb: n.potBb,
      actions: n.actions,
      hasEv: n.hasEv,
      strategy: n.strategy.map((r) => Float32Array.from(r)),
      ev: n.ev === null ? null : n.ev.map((r) => Float32Array.from(r)),
      reach: Float32Array.from(n.reach),
    },
  };
}

/** 카테고리 표시 이름. 상태 기계가 정한 값을 사람 말로 옮기는 유일한 지점이다. */
export const CATEGORY_LABEL: Record<Category, string> = {
  open: 'open (첫 레이즈)',
  vs_limp: 'vs limp',
  vs_jam: 'vs jam (올인 대면)',
  vs_open: 'vs open',
  vs_3bet: 'vs 3bet',
  vs_4bet_plus: 'vs 4bet+',
};
