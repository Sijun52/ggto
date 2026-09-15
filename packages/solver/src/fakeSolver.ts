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

import { COMBO_COUNT, createRng, formatCards, parseCard, type Rng } from '@ggto/core';
import { readFileSync, writeFileSync } from 'node:fs';
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

/**
 * `.bin` 첫 줄에 적는 헤더. **결과는 파일에서 나온다** — 실제 솔버와 같은 계약이다.
 * 이게 없으면 재솔브(같은 해시, 다른 정확도)가 같은 숫자를 내서 "낡은 결과를 준다" 는
 * 버그를 테스트가 구분할 수 없다 (P4 R1 MAJOR 3).
 */
interface FakeBinHeader {
  hash: string;
  iterations: number;
  targetExploitabilityPct: number;
}

/** FNV-1a 32비트. 파일 헤더 **전체**를 시드로 쓴다 — 정확도가 달라지면 결과도 달라진다. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function readHeader(path: string): { header: FakeBinHeader; seed: number } {
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch (e) {
    throw new SolverError('NotLoaded', `fake solver cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const nl = raw.indexOf(0x0a);
  if (nl < 0) throw new SolverError('NotLoaded', `fake solver: ${path} has no header line`);
  const text = raw.subarray(0, nl).toString('utf8');
  return { header: JSON.parse(text) as FakeBinHeader, seed: fnv1a(text) };
}

function streetOf(boardLen: number): Street {
  return boardLen === 3 ? 'flop' : boardLen === 4 ? 'turn' : 'river';
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
  /** `invalidate(hash)` 호출 기록 (P4 R1 MAJOR 3 테스트용) */
  readonly invalidated: string[] = [];

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
    const hash = configHash(cfg);
    const header: FakeBinHeader = {
      hash,
      iterations: steps * 10,
      targetExploitabilityPct: opts.targetExploitabilityPct,
    };
    const buf = Buffer.alloc(bytes, 7);
    const head = Buffer.from(`${JSON.stringify(header)}\n`, 'utf8');
    if (head.byteLength > bytes) throw new SolverError('BadRequest', `fake bytes=${String(bytes)} is too small for a header`);
    head.copy(buf);
    writeFileSync(opts.outPath, buf);
    this.#written.set(hash, cfg);
    return {
      iterations: steps * 10,
      exploitabilityPct: opts.targetExploitabilityPct,
      elapsedMs: Math.max(1, Date.now() - started),
      bytes,
    };
  }

  /**
   * 노드는 **파일 헤더**(해시 + 반복수)로 시드된 결정적 3-액션 트리다.
   *
   * 파일을 매번 읽는 것이 핵심이다: 재솔브로 `.bin` 이 바뀌면 다음 `open` 이 다른 숫자를
   * 준다. 캐시에 남은 옛 결과를 그대로 답하면 테스트가 잡는다 (P4 R1 MAJOR 3).
   */
  async open(hash: string, path: string): Promise<ResultHandle> {
    const cfg = this.#written.get(hash);
    if (cfg === undefined) throw new SolverError('NotLoaded', `fake solver has no result for ${hash}`);
    const { header, seed } = readHeader(path);
    if (header.hash !== hash) {
      throw new SolverError('NotLoaded', `${path} holds ${header.hash}, not ${hash}`);
    }
    return {
      node: async (line: string): Promise<CanonicalNode> => {
        const dealt = parseFakeLine(cfg, line);
        return fakeNode(cfg, seed, line, dealt);
      },
      runouts: async (line: string): Promise<CanonicalRunouts> => {
        const dealt = parseFakeLine(cfg, line);
        if (cfg.board.length + dealt.length >= 5) throw new SolverError('NotChanceNode', 'river has no runouts');
        return fakeRunouts(cfg, line, dealt);
      },
      close: async (): Promise<void> => undefined,
    };
  }

  /** 조회 데몬이 없으니 기록만 한다 — 훅이 실제로 불렸는지 테스트가 본다. */
  async invalidate(hash: string): Promise<void> {
    this.invalidated.push(hash);
  }
}

const FAKE_ACTION_SEGS = new Set(['X', 'B1', 'B2', 'X-X', 'B1-C', 'B2-C']);

/**
 * 가짜 트리의 `line` 파서. 액션 세그먼트는 고정 목록이고, **카드 세그먼트**는 그 스트리트에
 * 깔린 카드다 (P4.md 5.4). 카드 세그먼트를 지원해야 "턴 라인의 board 에 딜된 카드가 있는가"
 * 를 Rust 없이 검사할 수 있다 (P4 R1 MAJOR 1).
 */
function parseFakeLine(cfg: CanonicalConfig, line: string): string[] {
  if (line === '') return [];
  const dealt: string[] = [];
  const used = new Set(cfg.board.map((c) => formatCards([c])));
  for (const seg of line.split('/')) {
    if (FAKE_ACTION_SEGS.has(seg)) continue;
    let card: string;
    try {
      card = formatCards([parseCard(seg)]);
    } catch {
      throw new SolverError('NoSuchLine', `fake tree has no segment ${JSON.stringify(seg)}`);
    }
    if (used.has(card)) throw new SolverError('NoSuchLine', `card ${card} is already on the board`);
    used.add(card);
    dealt.push(card);
  }
  if (cfg.board.length + dealt.length > 5) {
    throw new SolverError('NoSuchLine', `line deals past the river: ${JSON.stringify(line)}`);
  }
  return dealt;
}

const FAKE_ACTIONS = ['X', 'B1', 'B2'];

function fakeNode(cfg: CanonicalConfig, seed: number, line: string, dealt: readonly string[]): CanonicalNode {
  const rng: Rng = createRng((seed ^ Math.imul(line.length, 0x9e3779b1)) >>> 0);
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
  const boardLen = cfg.board.length + dealt.length;
  return {
    street: streetOf(boardLen),
    line,
    // 라인이 카드를 지났으면 **그 카드가 보드에 있다** (P4 R1 MAJOR 1).
    board: formatCards(cfg.board) + dealt.join(''),
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

function fakeRunouts(cfg: CanonicalConfig, line: string, dealt: readonly string[]): CanonicalRunouts {
  const dead = new Set<number>([...cfg.board, ...dealt.map((c) => parseCard(c))]);
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
  return { line, board: formatCards(cfg.board) + dealt.join(''), cards };
}
