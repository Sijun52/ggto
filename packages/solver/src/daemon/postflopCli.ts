/**
 * `Solver` 의 실제 구현 — `ggto-solver-cli` 프로세스를 띄운다 (P4.md 5.1 · 6).
 *
 * **크레이트 이름 `postflop-solver` 가 등장하는 유일한 TS 파일이다** (P4.md 2절 grep 게이트).
 * 큐·캐시·라우트는 이 파일 밖에서 데몬 메서드 이름조차 보지 않는다.
 *
 * 프로세스 모델 (D22): 잡마다 `--solve` 프로세스 하나(끝나면 exit), 조회는 상주 `--serve`
 * 하나. 메모리는 프로세스와 함께 확실히 돌아오고, 취소는 kill 한 번이다.
 */

import { existsSync } from 'node:fs';
import { COMBO_COUNT, formatCards } from '@ggto/core';
import { DaemonClient, type SpawnFn } from './client.js';
import { decodeRows } from '../view.js';
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
} from '../types.js';

export const SOLVER_ID = 'postflop-solver@9d1509fe';

export function defaultBinPath(repoRoot: string): string {
  const exe = process.platform === 'win32' ? 'ggto-solver-cli.exe' : 'ggto-solver-cli';
  return `${repoRoot}/solver/ggto-solver-cli/target/release/${exe}`;
}

/** 바이너리가 없으면 `/api/solve` 만 503 이다 (D24) — 앱 기동을 막지 않는다. */
export function resolveBin(repoRoot: string): string | null {
  const fromEnv = process.env.GGTO_SOLVER_BIN;
  if (fromEnv !== undefined && fromEnv.length > 0) return existsSync(fromEnv) ? fromEnv : null;
  const p = defaultBinPath(repoRoot);
  return existsSync(p) ? p : null;
}

function b64Range(r: Float32Array): string {
  return Buffer.from(r.buffer, r.byteOffset, r.byteLength).toString('base64');
}

/** 와이어 config (Rust `WireConfig`). **정규 보드 + 칩 단위**다. */
export function wireConfig(cfg: CanonicalConfig): Record<string, unknown> {
  return {
    board: formatCards(cfg.board),
    oop: b64Range(cfg.ranges[0]),
    ip: b64Range(cfg.ranges[1]),
    potChips: cfg.potChips,
    stackChips: cfg.stackChips,
    chipsPerBb: cfg.chipsPerBb,
    sizings: cfg.sizings,
    rake:
      cfg.rake.mode === 'none'
        ? { mode: 'none' }
        : { mode: 'pot', pct: cfg.rake.pct, capChips: cfg.rake.capBb * cfg.chipsPerBb },
    compressed: cfg.compressed,
  };
}

interface WireNode {
  street: Street;
  line: string;
  board: string;
  player: 'oop' | 'ip';
  potChips: number;
  stacksChips: [number, number];
  actions: string[];
  strategy: string;
  ev: string;
  reach: [string, string];
  equity: [string, string];
  evAvgBb: [number, number];
  evBasis: 'stack_delta_from_node';
}

function parseNode(raw: unknown): CanonicalNode {
  const n = raw as WireNode;
  const rows = n.actions.length;
  const strategy = decodeRows(n.strategy, rows);
  const ev = decodeRows(n.ev, rows);
  for (const a of [...strategy, ...ev]) {
    if (a.length !== COMBO_COUNT) throw new SolverError('BadRequest', 'daemon returned a non-1326 array');
  }
  return {
    street: n.street,
    line: n.line,
    board: n.board,
    player: n.player,
    potChips: n.potChips,
    stacksChips: n.stacksChips,
    actions: n.actions,
    strategy,
    ev,
    reach: [decodeRows(n.reach[0], 1)[0] as Float32Array, decodeRows(n.reach[1], 1)[0] as Float32Array],
    equity: [decodeRows(n.equity[0], 1)[0] as Float32Array, decodeRows(n.equity[1], 1)[0] as Float32Array],
    evAvgBb: n.evAvgBb,
    evBasis: n.evBasis,
  };
}

/**
 * `runouts` 응답. `board` 는 **그 chance 노드의 보드**여야 한다 — 없으면 호출자가 시작
 * 보드로 되돌려 딜된 카드를 잃는다 (P4 R1 MAJOR 1). 조용히 undefined 를 통과시키지 않는다.
 */
function parseRunouts(raw: unknown): CanonicalRunouts {
  const r = raw as CanonicalRunouts;
  if (typeof r.board !== 'string' || r.board.length < 6 || r.board.length % 2 !== 0) {
    throw new SolverError('BadRequest', 'daemon returned runouts without a board');
  }
  if (!Array.isArray(r.cards)) throw new SolverError('BadRequest', 'daemon returned runouts without cards');
  return r;
}

export interface PostflopSolverCliOptions {
  bin: string;
  chipsPerBb?: number;
  spawnFn?: SpawnFn;
  onLog?: (line: string) => void;
}

export class PostflopSolverCli implements Solver {
  readonly id = SOLVER_ID;
  readonly #bin: string;
  readonly #spawnFn: SpawnFn | undefined;
  readonly #onLog: (line: string) => void;
  /** 상주 조회 데몬. 죽으면 다음 요청이 다시 띄운다 (P4.md 5.1). */
  #serve: DaemonClient | null = null;
  #serveChipsPerBb = 100;

  constructor(opts: PostflopSolverCliOptions) {
    this.#bin = opts.bin;
    this.#spawnFn = opts.spawnFn;
    this.#onLog = opts.onLog ?? ((line) => {
      console.error(line);
    });
  }

  #open(mode: '--solve' | '--serve'): DaemonClient {
    return new DaemonClient({
      bin: this.#bin,
      mode,
      ...(this.#spawnFn === undefined ? {} : { spawnFn: this.#spawnFn }),
      onStderr: this.#onLog,
    });
  }

  async estimate(cfg: CanonicalConfig): Promise<Estimate> {
    const client = this.#open('--solve');
    try {
      await client.hello();
      const r = (await client.request('estimate', {
        config: wireConfig(cfg),
        maxIterations: cfg.maxIterations,
      })) as Estimate;
      return r;
    } finally {
      await client.close();
    }
  }

  async solve(
    cfg: CanonicalConfig,
    opts: SolveOptions,
    sink: ProgressSink,
    signal: AbortSignal,
  ): Promise<SolveSummary> {
    const client = this.#open('--solve');
    const onAbort = (): void => {
      // 취소는 `cancel` 한 줄로 시작해서, 응답이 없으면 close() 의 2초 뒤 kill 이 끝낸다.
      void client.request('cancel', {}).catch(() => undefined);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await client.hello();
      if (signal.aborted) throw new SolverError('Cancelled', 'cancelled before start');
      const r = (await client.requestWithProgress(
        'solve',
        {
          config: wireConfig(cfg),
          targetExploitabilityPct: opts.targetExploitabilityPct,
          maxIterations: opts.maxIterations,
          progressEvery: 10,
          outPath: opts.outPath,
        },
        (p) => {
          sink(p as { iter: number; exploitabilityPct: number; pct: number });
        },
      )) as SolveSummary;
      return r;
    } finally {
      signal.removeEventListener('abort', onAbort);
      await client.close();
    }
  }

  async #serveClient(chipsPerBb: number): Promise<DaemonClient> {
    if (this.#serve !== null && this.#serve.alive) return this.#serve;
    const client = this.#open('--serve');
    await client.hello();
    this.#serve = client;
    this.#serveChipsPerBb = chipsPerBb;
    return client;
  }

  async open(hash: string, path: string): Promise<ResultHandle> {
    return this.#openWith(hash, path, this.#serveChipsPerBb);
  }

  /** `chipsPerBb` 는 EV 를 bb 로 되돌리는 데 데몬이 쓴다. */
  async openWith(hash: string, path: string, chipsPerBb: number): Promise<ResultHandle> {
    return this.#openWith(hash, path, chipsPerBb);
  }

  async #openWith(hash: string, path: string, chipsPerBb: number): Promise<ResultHandle> {
    const self = this;
    async function call(method: 'node' | 'runouts', line: string): Promise<unknown> {
      for (let attempt = 0; attempt < 2; attempt++) {
        const client = await self.#serveClient(chipsPerBb);
        try {
          return await client.request(method, { hash, line });
        } catch (e) {
          const notLoaded = e instanceof SolverError && (e.code === 'NotLoaded' || e.code === 'DaemonExited');
          if (!notLoaded || attempt === 1) throw e;
          // 데몬이 죽었거나(재기동) 결과가 축출됐다 → 멱등 재로드 후 한 번만 재시도한다.
          if (e instanceof SolverError && e.code === 'DaemonExited') self.#serve = null;
          const again = await self.#serveClient(chipsPerBb);
          await again.request('load', { hash, path, chipsPerBb });
        }
      }
      throw new SolverError('NotLoaded', `${hash} could not be loaded`);
    }

    const client = await this.#serveClient(chipsPerBb);
    await client.request('load', { hash, path, chipsPerBb });
    return {
      node: async (line: string): Promise<CanonicalNode> => parseNode(await call('node', line)),
      runouts: async (line: string): Promise<CanonicalRunouts> => parseRunouts(await call('runouts', line)),
      close: async (): Promise<void> => {
        const c = this.#serve;
        if (c !== null && c.alive) await c.request('unload', { hash }).catch(() => undefined);
      },
    };
  }

  /**
   * 그 해시의 `.bin` 이 곧 바뀐다(재솔브 REPLACE)·사라진다(삭제) — 데몬이 들고 있으면 버린다.
   *
   * 데몬이 떠 있지 않으면 할 일이 없다 (**띄우지 않는다** — 삭제 때문에 프로세스를 새로
   * 만드는 것은 낭비다). 이것만으로 충분하지 않다는 것이 R1 MAJOR 3 의 교훈이라
   * 데몬 쪽 `load` 도 (크기, mtime) 이 다르면 다시 읽는다 — 그쪽이 진짜 보증이다.
   */
  async invalidate(hash: string): Promise<void> {
    const c = this.#serve;
    if (c === null || !c.alive) return;
    await c.request('unload', { hash });
  }

  /** 서버 종료 시 상주 데몬을 정리한다. */
  async shutdown(): Promise<void> {
    const c = this.#serve;
    this.#serve = null;
    if (c !== null) await c.close();
  }
}
