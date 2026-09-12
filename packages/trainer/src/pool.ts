/**
 * 후보 풀 (P3.md 5.1). 필터에 맞는 차트셋의 **비터미널 노드 전부**.
 *
 * 노드마다 `reach_hero` 를 한 번만 읽어 캐시한다. 출제는 이 배열에 **비례**해서 콤보를
 * 뽑는다 — 균등하게 뽑으면 이미 폴드한 핸드로 "폴드 vs 올인" 을 묻게 되고, 그것은
 * 이 노드에 도달할 수 없는 인포셋이다 (P2 3.4: 상대 카드 제거는 하지 않는다).
 */

import { COMBO_COUNT, type ComboIndex, type PreflopConfig, type Rng } from '@ggto/core';
import type { ChartRepository, ChartSetMeta, Resolution } from '@ggto/preflop';
import { categoryOf, preflopStateOf } from './category.js';
import { mixedMassOf } from './grade.js';
import { formatSpotKey } from './spotKey.js';
import { EmptyPoolError, type Category, type GradedBy, type SessionFilter } from './types.js';

export interface PoolNode {
  contentHash: string;
  chartSetId: number;
  chartName: string;
  config: PreflopConfig;
  resolution: Resolution;
  gradedBy: GradedBy;
  seq: string;
  heroPos: string;
  potBb: number;
  actions: readonly string[];
  category: Category;
  /** 히어로 포지션의 도달 레인지 (1326). 콤보 추첨 분포 그 자체다. */
  reachHero: Float32Array;
  /** Σ reachHero / 1326 — 랜덤 핸드가 이 노드에 도달할 확률 (w1) */
  mass: number;
  /** 도달 가중 혼합 콤보 비율 (w2 의 입력) */
  mixedMass: number;
  /** reachHero 의 누적합. 콤보 추첨을 O(log n) 으로 만든다 */
  cumulative: Float64Array;
}

export interface Pool {
  nodes: PoolNode[];
  byKey: Map<string, PoolNode>;
  /** 풀을 만든 시점의 차트셋 해시 집합 (재임포트 감지) */
  hashes: string[];
  categories: Category[];
}

function poolKey(contentHash: string, seq: string): string {
  return `${contentHash}:${seq}`;
}

function cumulativeOf(reach: Float32Array): Float64Array {
  const cum = new Float64Array(reach.length);
  let acc = 0;
  for (let c = 0; c < reach.length; c++) {
    acc += reach[c] as number;
    cum[c] = acc;
  }
  return cum;
}

/** 현재 저장소의 해시 집합 (정렬). 풀 재구성 판단에 쓴다. */
export function setHashes(repo: ChartRepository): string[] {
  return repo
    .listSets()
    .map((s) => s.contentHash)
    .sort();
}

function matchesFilter(set: ChartSetMeta, filter: SessionFilter): boolean {
  return filter.contentHashes === undefined || filter.contentHashes.includes(set.contentHash);
}

/**
 * 풀을 만든다. **비어 있어도 던지지 않는다** — "지금 고를 수 있는 것" 을 묻는 화면
 * (`GET /api/trainer/pool`) 은 시드 전에도 200 이어야 한다. 세션을 만들 때만 비면 장애다.
 */
export function collectPool(repo: ChartRepository, filter: SessionFilter): Pool {
  const nodes: PoolNode[] = [];
  const byKey = new Map<string, PoolNode>();
  const categories = new Set<Category>();

  for (const set of repo.listSets()) {
    if (!matchesFilter(set, filter)) continue;
    for (const meta of repo.listNodes(set.id)) {
      // 터미널 노드는 출제할 수 없다 (답할 사람이 없다). P2 6.2-3 이 이미 보장하지만 다시 본다.
      if (preflopStateOf(set.config, meta.seq).isTerminal) continue;
      const category = categoryOf(set.config, meta.seq);
      categories.add(category);
      if (filter.categories !== undefined && !filter.categories.includes(category)) continue;
      const data = repo.getNode(set.id, meta.seq);
      if (data === null) continue;
      const reachHero = repo.reach(set.id, meta.seq, meta.heroPos);
      let sum = 0;
      for (let c = 0; c < reachHero.length; c++) sum += reachHero[c] as number;
      const node: PoolNode = {
        contentHash: set.contentHash,
        chartSetId: set.id,
        chartName: set.name,
        config: set.config,
        resolution: set.resolution,
        // 차트셋 단위로 정해진다 (P2 3.3 이 "노드 단위 전부 아니면 전무" 를 보장) — D8.
        gradedBy: set.hasEv ? 'ev' : 'frequency',
        seq: meta.seq,
        heroPos: meta.heroPos,
        potBb: meta.potBb,
        actions: meta.actions,
        category,
        reachHero,
        mass: sum / COMBO_COUNT,
        mixedMass: mixedMassOf(data.strategy, reachHero),
        cumulative: cumulativeOf(reachHero),
      };
      // 도달 질량이 0 인 노드는 뽑을 콤보가 없다 (그 라인은 히어로 레인지에서 사라졌다).
      if (sum <= 0) continue;
      nodes.push(node);
      byKey.set(poolKey(node.contentHash, node.seq), node);
    }
  }

  return { nodes, byKey, hashes: setHashes(repo), categories: [...categories].sort() };
}

/** 세션용 풀. 비면 `EmptyPoolError` — 세션을 만들고 나서 next 가 실패하면 이유를 알 수 없다. */
export function buildPool(repo: ChartRepository, filter: SessionFilter): Pool {
  const pool = collectPool(repo, filter);
  if (pool.nodes.length === 0) {
    throw new EmptyPoolError(
      `no non-terminal chart nodes match the filter (sets: ${filter.contentHashes?.join(', ') ?? 'all'}, ` +
        `categories: ${filter.categories?.join(', ') ?? 'all'})`,
    );
  }
  return pool;
}

export function findNode(pool: Pool, contentHash: string, seq: string): PoolNode | null {
  return pool.byKey.get(poolKey(contentHash, seq)) ?? null;
}

/**
 * 스팟 키 문자열 → 풀 노드. **키를 완전히 파싱하지 않는다**: due 큐를 훑을 때 수백 개의
 * 키를 걸러야 하는데 `parseSpotKey` 는 액션 문법·카드까지 검증해 한 건당 수 µs 가 든다.
 * 여기서는 "이 노드가 풀에 있는가" 만 알면 되고, 실제로 출제하기로 정한 키 하나만
 * 나중에 정식으로 파싱된다 (`parseSpotKey` 가 거기서 최종 검증을 한다).
 */
export function findNodeByKey(pool: Pool, spotKey: string): PoolNode | null {
  const first = spotKey.indexOf(':');
  if (first !== 2 || !spotKey.startsWith('pf:')) return null;
  const second = spotKey.indexOf(':', first + 1);
  const third = spotKey.indexOf(':', second + 1);
  if (second < 0 || third < 0) return null;
  return pool.byKey.get(spotKey.slice(first + 1, third)) ?? null;
}

/**
 * `reachHero` 에 비례해 콤보 하나를 뽑는다. reach 0 인 콤보는 절대 나오지 않는다
 * (누적합이 같은 값을 유지하므로 구간 길이가 0 이다).
 */
export function sampleCombo(node: PoolNode, rng: Rng): ComboIndex {
  const total = node.cumulative[node.cumulative.length - 1] as number;
  const target = rng.nextFloat() * total;
  let lo = 0;
  let hi = node.cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((node.cumulative[mid] as number) > target) hi = mid;
    else lo = mid + 1;
  }
  // 부동소수 잔차로 마지막 구간을 넘어가면 reach > 0 인 마지막 콤보로 되돌린다.
  if ((node.reachHero[lo] as number) <= 0) {
    for (let c = node.reachHero.length - 1; c >= 0; c--) {
      if ((node.reachHero[c] as number) > 0) return c as ComboIndex;
    }
  }
  return lo as ComboIndex;
}

export function spotKeyOf(node: PoolNode, combo: ComboIndex): string {
  return formatSpotKey(node.contentHash, node.seq, combo);
}
