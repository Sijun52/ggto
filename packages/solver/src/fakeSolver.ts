/**
 * `FakeSolver` — Rust 없이 큐·캐시·라우트를 검사하기 위한 결정적 구현 (P4.md 6).
 *
 * **가짜 데이터로 흉내내는 것이 아니다**: 이것은 테스트 더블이고, 실제 경로(`PostflopSolverCli`)
 * 와 같은 `Solver` 인터페이스를 만족한다. `npm run ci` 가 Rust 없이 exit 0 이어야 한다는
 * 요구(P4.md 0절 4)의 유일한 수단이다. 프로덕션 코드 경로에서는 절대 쓰지 않는다 —
 * 서버는 바이너리가 없으면 `FakeSolver` 로 떨어지는 대신 **503** 을 준다 (D24).
 *
 * 전략은 `configHash` 로 시드한 core rng 에서 나온다: 같은 설정 → 같은 숫자.
 */

import { COMBO_COUNT, createRng, formatCards, type Rng } from '@ggto/core';
import { writeFileSync } from 'node:fs';
import { configHash } from './hash.js';
import {
  SolverError,
  type CanonicalConfig,
  type CanonicalNode,
  type CanonicalRunouts,
  type Estimate,
  type ProgressSink,
  type ResultHandle,
  type SolveOptions,
  type SolveSummary,
  type Solver,
  type Street,
} from './types.js';

export interface FakeSolverOptions {
  /** 추정 메모리를 강제한다 (8GB 게이트 테스트용) */
  memoryBytes?: number | ((cfg: CanonicalConfig) => number);
  /** solve 한 번의 지연 (ms). 0 이면 microtask 한 번 */
  solveMs?: number;
  /** 진행률 알림 횟수 */
  progressSteps?: number;
  /** 저장할 바이트 수 (파일에 실제로 쓴다 — 캐시 LRU 가 진짜 크기를 본다) */
  bytes?: number;
  estimateMs?: number;
}

function seedFrom(hash: string): number {
  // 해시 앞 8 hex = 32비트. 같은 설정이면 같은 전략이 나온다.
  return Number.parseInt(hash.slice(0, 8), 16) >>> 0;
}

function streetOf(cfg: CanonicalConfig): Street {
  return cfg.board.length === 3 ? 'flop' : cfg.board.length === 4 ? 'turn' : 'river';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    setTimeout(r, ms);
  });
}

export class FakeSolver implements Solver {
  readonly id = 'fake';
  readonly #opts: FakeSolverOptions;
  /** 어떤 설정으로 어떤 파일을 썼는지 — `open()` 이 다시 만들어 낸다 */
  readonly #written = new Map<string, CanonicalConfig>();
  solveCalls = 0;
  estimateCalls = 0;

  constructor(opts: FakeSolverOptions = {}) {
    this.#opts = opts;
  }

  async estimate(cfg: CanonicalConfig): Promise<Estimate> {
    this.estimateCalls += 1;
    if ((this.#opts.estimateMs ?? 0) > 0) await sleep(this.#opts.estimateMs as number);
    const m = this.#opts.memoryBytes;
    const memoryBytes = typeof m === 'function' ? m(cfg) : (m ?? 64 * 1024 * 1024);
    return {
      nodes: 100 + cfg.board.length,
      memoryBytes,
      memoryBytesCompressed: Math.round(memoryBytes * 0.67),
      estSeconds: memoryBytes / 3e9,
    };
  }

  async solve(
    cfg: CanonicalConfig,
    opts: SolveOptions,
    sink: ProgressSink,
    signal: AbortSignal,
  ): Promise<SolveSummary> {
    this.solveCalls += 1;
    const started = Date.now();
    const steps = this.#opts.progressSteps ?? 3;
    const perStep = (this.#opts.solveMs ?? 0) / Math.max(1, steps);
    for (let i = 1; i <= steps; i++) {
      if (signal.aborted) throw new SolverError('Cancelled', 'cancelled');
      if (perStep > 0) await sleep(perStep);
      else await Promise.resolve();
      sink({
        iter: i * 10,
        // 단조 비증가 — SSE 테스트가 이 성질을 본다.
        exploitabilityPct: opts.targetExploitabilityPct * (1 + (steps - i)),
        pct: i / steps,
      });
    }
    if (signal.aborted) throw new SolverError('Cancelled', 'cancelled');
    const bytes = this.#opts.bytes ?? 4096;
    writeFileSync(opts.outPath, Buffer.alloc(bytes, 7));
    this.#written.set(configHash(cfg), cfg);
    return {
      iterations: steps * 10,
      exploitabilityPct: opts.targetExploitabilityPct,
      elapsedMs: Math.max(1, Date.now() - started),
      bytes,
    };
  }

  /** 노드는 설정 해시로 시드된 결정적 3-액션 트리 하나다. */
  async open(hash: string, _path: string): Promise<ResultHandle> {
    const cfg = this.#written.get(hash);
    if (cfg === undefined) throw new SolverError('NotLoaded', `fake solver has no result for ${hash}`);
    const make = (line: string): CanonicalNode => fakeNode(cfg, hash, line);
    return {
      node: async (line: string): Promise<CanonicalNode> => {
        if (line !== '' && line !== 'X' && line !== 'B1' && line !== 'B2') {
          throw new SolverError('NoSuchLine', `fake tree has no line ${JSON.stringify(line)}`);
        }
        return make(line);
      },
      runouts: async (line: string): Promise<CanonicalRunouts> => {
        if (cfg.board.length >= 5) throw new SolverError('NotChanceNode', 'river has no runouts');
        return fakeRunouts(cfg, line);
      },
      close: async (): Promise<void> => undefined,
    };
  }
}

const FAKE_ACTIONS = ['X', 'B1', 'B2'];

function fakeNode(cfg: CanonicalConfig, hash: string, line: string): CanonicalNode {
  const rng: Rng = createRng(seedFrom(hash) ^ line.length);
  const reachOop = new Float32Array(cfg.ranges[0]);
  const reachIp = new Float32Array(cfg.ranges[1]);
  const strategy = FAKE_ACTIONS.map(() => new Float32Array(COMBO_COUNT));
  const ev = FAKE_ACTIONS.map(() => new Float32Array(COMBO_COUNT));
  const actor = line === '' ? reachOop : reachIp;
  for (let c = 0; c < COMBO_COUNT; c++) {
    if ((actor[c] as number) <= 0) continue;
    const w: [number, number, number] = [rng.nextFloat(), rng.nextFloat(), rng.nextFloat()];
    const sum = w[0] + w[1] + w[2];
    for (let a = 0; a < 3; a++) {
      const freq = (w[a] as number) / sum;
      (strategy[a] as Float32Array)[c] = freq;
      (ev[a] as Float32Array)[c] = freq * (cfg.potChips / cfg.chipsPerBb);
    }
  }
  return {
    street: streetOf(cfg),
    line,
    board: formatCards(cfg.board),
    player: line === '' ? 'oop' : 'ip',
    potChips: cfg.potChips,
    stacksChips: [cfg.stackChips, cfg.stackChips],
    actions: FAKE_ACTIONS,
    strategy,
    ev,
    reach: [reachOop, reachIp],
    equity: [new Float32Array(COMBO_COUNT).fill(0.5), new Float32Array(COMBO_COUNT).fill(0.5)],
    evAvgBb: [cfg.potChips / cfg.chipsPerBb / 2, cfg.potChips / cfg.chipsPerBb / 2],
    evBasis: 'stack_delta_from_node',
  };
}

function fakeRunouts(cfg: CanonicalConfig, line: string): CanonicalRunouts {
  const dead = new Set(cfg.board);
  const cards: CanonicalRunouts['cards'] = [];
  const RANKS = '23456789TJQKA';
  const SUITS = 'cdhs';
  for (let c = 0; c < 52; c++) {
    if (dead.has(c)) continue;
    cards.push({
      card: `${RANKS[c >> 2] as string}${SUITS[c & 3] as string}`,
      evOop: cfg.potChips / cfg.chipsPerBb / 2,
      evIp: cfg.potChips / cfg.chipsPerBb / 2,
      equityOop: 0.5,
      strategyRoot: [1 / 3, 1 / 3, 1 / 3],
    });
  }
  return { line, cards };
}
