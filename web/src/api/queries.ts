import { useMutation, useQueries, useQuery, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type {
  ChartSetDto,
  ReportDto,
  TrainerAnswerRequest,
  TrainerNextResponse,
  TrainerPoolResponse,
  TrainerSessionRequest,
  TrainerSessionResponse,
  TrainerSessionStatusResponse,
} from '@ggto/protocol';
import type { SolveListResponse, SolvePostResponse, SolveRequestDto } from '@ggto/protocol';
import { parseRangeApi, type ApiError, type ParsedRange } from './client';
import {
  fetchSolveNode,
  fetchSolveRunouts,
  fetchSolves,
  postSolve,
  type SolveNodeResult,
  type SolveRunoutsView,
} from './solve';
import { notationKey, type SolveNotation } from '../lib/solveNotation';
import {
  fetchChart,
  fetchChartNode,
  fetchChartRange,
  fetchChartSets,
  type ChartDetailView,
  type ChartNodeView,
} from './charts';
import {
  answerTrainer,
  createTrainerSession,
  fetchTrainerNext,
  fetchTrainerPool,
  fetchTrainerReport,
  fetchTrainerSession,
  type AnsweredNode,
} from './trainer';

/** 텍스트 → 1326 가중치. 캐시 정책은 P1 에선 기본값 (제출할 때마다 서버에 묻는다). */
export function useParseRange(
  onSuccess?: (data: ParsedRange) => void,
): UseMutationResult<ParsedRange, ApiError, string> {
  return useMutation<ParsedRange, ApiError, string>({
    mutationFn: parseRangeApi,
    ...(onSuccess === undefined ? {} : { onSuccess }),
  });
}

/** 차트 목록. 시드 후에는 거의 바뀌지 않으므로 오래 신선한 것으로 본다. */
export function useChartSets(): UseQueryResult<ChartSetDto[], ApiError> {
  return useQuery<ChartSetDto[], ApiError>({ queryKey: ['charts'], queryFn: fetchChartSets, staleTime: 60_000 });
}

export function useChart(id: number | null): UseQueryResult<ChartDetailView, ApiError> {
  return useQuery<ChartDetailView, ApiError>({
    queryKey: ['chart', id],
    queryFn: async () => await fetchChart(id as number),
    enabled: id !== null,
    staleTime: 60_000,
  });
}

/** 노드 하나 (전략·EV·도달 레인지). 키에 seq 가 들어가므로 브레드크럼 왕복은 캐시 적중이다. */
export function useChartNode(id: number | null, seq: string): UseQueryResult<ChartNodeView, ApiError> {
  return useQuery<ChartNodeView, ApiError>({
    queryKey: ['node', id, seq],
    queryFn: async () => await fetchChartNode(id as number, seq),
    enabled: id !== null,
    staleTime: 60_000,
  });
}

/** 특정 포지션의 도달 레인지 (reach 모드에서 히어로가 아닌 탭을 볼 때). */
export function useChartRange(id: number | null, seq: string, pos: string | null): UseQueryResult<Float32Array, ApiError> {
  return useQuery<Float32Array, ApiError>({
    queryKey: ['range', id, seq, pos],
    queryFn: async () => await fetchChartRange(id as number, seq, pos as string),
    enabled: id !== null && pos !== null,
    staleTime: 60_000,
  });
}

/**
 * reach 모드 우측 패널용: 포지션 전부의 도달 레인지 (P2 R1 MINOR 3).
 * `useQueries` 라서 포지션 수가 달라져도 훅 순서가 깨지지 않는다.
 */
export function useChartRanges(
  id: number | null,
  seq: string,
  positions: readonly string[],
  enabled: boolean,
): { pos: string; weights: Float32Array | null }[] {
  const results = useQueries({
    queries: positions.map((pos) => ({
      queryKey: ['range', id, seq, pos],
      queryFn: async () => await fetchChartRange(id as number, seq, pos),
      enabled: enabled && id !== null,
      staleTime: 60_000,
    })),
  });
  return positions.map((pos, i) => ({ pos, weights: results[i]?.data ?? null }));
}

// --- P3 트레이너 (P3.md 8.2) ------------------------------------------------

/** 세션 시작 폼이 고를 수 있는 카테고리 (풀에 실제로 있는 것만). */
export function useTrainerPool(): UseQueryResult<TrainerPoolResponse, ApiError> {
  return useQuery<TrainerPoolResponse, ApiError>({
    queryKey: ['trainer', 'pool'],
    queryFn: fetchTrainerPool,
    staleTime: 60_000,
  });
}

export function useCreateSession(): UseMutationResult<TrainerSessionResponse, ApiError, TrainerSessionRequest> {
  return useMutation<TrainerSessionResponse, ApiError, TrainerSessionRequest>({ mutationFn: createTrainerSession });
}

/**
 * 다음 스팟. 키에 `index` 가 들어가므로 답할 때마다 새 질의가 되고, 같은 index 를 다시
 * 물으면 캐시가 답한다 (서버도 `pending_key` 로 멱등이다 — 새로고침 안전).
 */
export function useTrainerNext(sessionId: number | null, index: number): UseQueryResult<TrainerNextResponse, ApiError> {
  return useQuery<TrainerNextResponse, ApiError>({
    queryKey: ['trainer', 'next', sessionId, index],
    queryFn: async () => await fetchTrainerNext(sessionId as number),
    enabled: sessionId !== null,
    staleTime: Infinity,
  });
}

export function useTrainerSession(sessionId: number | null): UseQueryResult<TrainerSessionStatusResponse, ApiError> {
  return useQuery<TrainerSessionStatusResponse, ApiError>({
    queryKey: ['trainer', 'session', sessionId],
    queryFn: async () => await fetchTrainerSession(sessionId as number),
    enabled: sessionId !== null,
  });
}

export function useTrainerReport(days: number, enabled: boolean): UseQueryResult<ReportDto, ApiError> {
  return useQuery<ReportDto, ApiError>({
    queryKey: ['trainer', 'report', days],
    queryFn: async () => await fetchTrainerReport(days),
    enabled,
  });
}

export function useAnswerSpot(): UseMutationResult<AnsweredNode, ApiError, TrainerAnswerRequest> {
  return useMutation<AnsweredNode, ApiError, TrainerAnswerRequest>({ mutationFn: answerTrainer });
}


// --- P5 솔브 탐색기 (P5.md 4절) ---------------------------------------------
//
// 솔브 결과는 **불변**이라 `staleTime` 이 길다. 같은 세션에서 재솔브(REPLACE)하면
// `done` 에서 `queryClient.invalidateQueries(['solve-node', hash])` 를 부른다 (SolvePage).

const SOLVE_STALE_MS = 5 * 60_000;

export function useSolves(enabled = true): UseQueryResult<SolveListResponse, ApiError> {
  return useQuery<SolveListResponse, ApiError>({
    queryKey: ['solves'],
    queryFn: fetchSolves,
    enabled,
    staleTime: 10_000,
    // 솔버가 없는 PC 는 503 이다. 재시도는 배너를 늦출 뿐이다 (D24).
    retry: false,
  });
}

/**
 * 노드 하나. `ChanceNode`·`NoSuchLine` 은 **데이터**로 돌아온다 (`kind`) — 오류로 두면
 * `retry` 가 돌고 `useSolveRunouts` 로 이어지는 분기를 쓸 수 없다 (P5.md 4절).
 */
export function useSolveNode(
  hash: string | null,
  line: string,
  notation: SolveNotation | null,
): UseQueryResult<SolveNodeResult, ApiError> {
  return useQuery<SolveNodeResult, ApiError>({
    queryKey: ['solve-node', hash, line, notationKey(notation)],
    queryFn: async () => await fetchSolveNode(hash as string, line, notation),
    enabled: hash !== null,
    staleTime: SOLVE_STALE_MS,
    retry: false,
  });
}

export function useSolveRunouts(
  hash: string | null,
  line: string,
  notation: SolveNotation | null,
  enabled: boolean,
): UseQueryResult<SolveRunoutsView, ApiError> {
  return useQuery<SolveRunoutsView, ApiError>({
    queryKey: ['solve-runouts', hash, line, notationKey(notation)],
    queryFn: async () => await fetchSolveRunouts(hash as string, line, notation),
    enabled: enabled && hash !== null,
    staleTime: SOLVE_STALE_MS,
    retry: false,
  });
}

/** `confirm` 없으면 추정만, 있으면 큐에 넣는다 (P4.md 5.2). 같은 훅이 둘 다 한다. */
export function useSolveMutation(): UseMutationResult<SolvePostResponse, ApiError, SolveRequestDto> {
  return useMutation<SolvePostResponse, ApiError, SolveRequestDto>({ mutationFn: postSolve });
}
