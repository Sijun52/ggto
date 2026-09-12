/**
 * /api/charts/* 클라이언트. P2.md 8.
 *
 * 1326 배열은 받는 즉시 Float32Array 로 바꾼다 (P1 과 같은 규약: 전송 표현 number[] 를
 * 화면까지 끌고 가지 않는다).
 */

import type {
  ChartDetailResponse,
  ChartListResponse,
  ChartNodeResponse,
  ChartRangeResponse,
  ChartSetDto,
  NodeMetaDto,
} from '@ggto/protocol';
import { getJson } from './client';

export interface ChartNodeView extends NodeMetaDto {
  strategy: Float32Array[];
  ev: Float32Array[] | null;
  /** 히어로 포지션의 도달 레인지 */
  reach: Float32Array;
}

export interface ChartDetailView extends ChartSetDto {
  nodes: NodeMetaDto[];
}

const rows = (xs: number[][]): Float32Array[] => xs.map((r) => Float32Array.from(r));

export async function fetchChartSets(): Promise<ChartSetDto[]> {
  return (await getJson<ChartListResponse>('/api/charts')).sets;
}

export async function fetchChart(id: number): Promise<ChartDetailView> {
  return await getJson<ChartDetailResponse>(`/api/charts/${String(id)}`);
}

export async function fetchChartNode(id: number, seq: string): Promise<ChartNodeView> {
  const res = await getJson<ChartNodeResponse>(
    `/api/charts/${String(id)}/node?seq=${encodeURIComponent(seq)}`,
  );
  return {
    seq: res.seq,
    heroPos: res.heroPos,
    potBb: res.potBb,
    actions: res.actions,
    hasEv: res.hasEv,
    strategy: rows(res.strategy),
    ev: res.ev === null ? null : rows(res.ev),
    reach: Float32Array.from(res.reach),
  };
}

export async function fetchChartRange(id: number, seq: string, pos: string): Promise<Float32Array> {
  const res = await getJson<ChartRangeResponse>(
    `/api/charts/${String(id)}/range?seq=${encodeURIComponent(seq)}&pos=${encodeURIComponent(pos)}`,
  );
  return Float32Array.from(res.weights);
}
