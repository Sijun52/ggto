/**
 * `/api/solve*` (P4.md 7절).
 *
 * 이 파일은 **`Solver`·`JobQueue`·`SolveCache` 인터페이스만** 본다 (P4.md 2절). 데몬 메서드
 * 이름도, 크레이트 이름도, `child_process` 도 여기에 없다. 솔버가 없으면 이 라우트만
 * 503 이고 P2/P3 는 그대로 돈다 (D24).
 */

import {
  JobQueue,
  SolveCache,
  SolveConfigError,
  SolverError,
  assertCanonicalLine,
  buildConfig,
  configHash,
  permuteLine,
  toNodeResponse,
  toRunoutsResponse,
  type CanonicalConfig,
  type JobEvent,
  type Solver,
} from '@ggto/solver';
import type {
  SolveListItemDto,
  SolveListResponse,
  SolveNodeResponse,
  SolvePostResponse,
  SolveRequestDto,
  SolveRunoutsResponse,
} from '@ggto/protocol';
import { formatCards } from '@ggto/core';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { HttpError, badRequest, notFound } from '../errors.js';
import { queryParam } from './charts.js';

/** 와이어 타입과 도메인 타입이 갈라지면 여기서 컴파일이 깨진다. */
type _AssertNodeShape = SolveNodeResponse extends ReturnType<typeof toNodeResponse> ? true : never;
const _assertNodeShape: _AssertNodeShape = true;
void _assertNodeShape;

export interface SolveDeps {
  solver: Solver;
  queue: JobQueue;
  cache: SolveCache;
}

export const solverUnavailable = (): HttpError =>
  new HttpError(
    503,
    'SolverUnavailable',
    'the solver binary is not built on this machine (npm run build:solver), so /api/solve is off',
  );

function toHttp(e: unknown): never {
  if (e instanceof SolveConfigError) throw new HttpError(400, e.code, e.message);
  if (e instanceof SolverError) {
    const status =
      e.code === 'TooLarge'
        ? 413
        : e.code === 'NoSuchLine' || e.code === 'NotChanceNode' || e.code === 'BadRequest'
          ? 400
          : e.code === 'NotLoaded' || e.code === 'NoSolve'
            ? 404
            : 503;
    throw new HttpError(status, e.code, e.message);
  }
  throw e;
}

function listItem(row: {
  hash: string;
  boardCanonical: string;
  street: 'flop' | 'turn' | 'river';
  potChips: number;
  stackChips: number;
  sizings: string;
  compressed: boolean;
  exploitability: number;
  iterations: number;
  bytes: number;
  solver: string;
  createdAt: number;
  lastUsedAt: number;
  elapsedMs: number;
}): SolveListItemDto {
  return {
    hash: row.hash,
    boardCanonical: row.boardCanonical,
    street: row.street,
    potBb: row.potChips / 100,
    stackBb: row.stackChips / 100,
    sizings: row.sizings,
    compressed: row.compressed,
    exploitability: row.exploitability,
    iterations: row.iterations,
    bytes: row.bytes,
    solver: row.solver,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    elapsedMs: row.elapsedMs,
  };
}

/**
 * `hash` 로 저장된 결과를 열어 노드를 읽는다.
 *
 * 슈트 역순열에 필요한 `perm` 은 **요청의 설정에서 다시 계산한다** — 캐시 행에 저장하지
 * 않는다 (P4.md 4.1: 한 해시에 여러 perm 이 대응하므로 저장하면 모순이 된다). 그래서
 * `node`/`runouts` 요청은 `board`·`oop`·`ip` 를 함께 받아야 정확한 슈트로 답할 수 있다.
 * 없으면 **정규 보드 그대로** 준다 (정규 보드도 유효한 표기다 — 사용자에게 거짓말이 아니다).
 */
function permFor(url: string): { perm: [number, number, number, number] | null; cfg: CanonicalConfig | null } {
  const board = queryParam(url, 'board');
  const oop = queryParam(url, 'oop');
  const ip = queryParam(url, 'ip');
  const potBb = queryParam(url, 'potBb');
  const stackBb = queryParam(url, 'stackBb');
  if (board === null || oop === null || ip === null || potBb === null || stackBb === null) {
    return { perm: null, cfg: null };
  }
  try {
    const cfg = buildConfig({
      board,
      oop,
      ip,
      potBb: Number(potBb),
      stackBb: Number(stackBb),
      sizings: (queryParam(url, 'sizings') as 'simple' | null) ?? 'simple',
    });
    return { perm: [...cfg.perm] as [number, number, number, number], cfg };
  } catch (e) {
    return toHttp(e);
  }
}

export function solveRoutes(deps: SolveDeps | null): Hono {
  const app = new Hono();

  if (deps === null) {
    app.all('/solve', () => {
      throw solverUnavailable();
    });
    app.all('/solve/*', () => {
      throw solverUnavailable();
    });
    app.all('/solves', () => {
      throw solverUnavailable();
    });
    app.all('/solves/*', () => {
      throw solverUnavailable();
    });
    return app;
  }

  const { queue, cache, solver } = deps;

  app.post('/solve', async (c) => {
    const body = (await c.req.json().catch(() => {
      throw badRequest('body must be JSON');
    })) as SolveRequestDto;

    let cfg: CanonicalConfig;
    try {
      cfg = buildConfig(body);
    } catch (e) {
      return toHttp(e);
    }
    const hash = configHash(cfg);
    const board = formatCards(cfg.boardOriginal);

    // 이미 충분히 정확한 결과가 있으면 연산 없이 끝난다 (P4.md 4.3).
    const { hit, row } = cache.lookup(hash, cfg.targetExploitabilityPct);
    if (hit && row !== null) {
      cache.touch(hash);
      const res: SolvePostResponse = {
        jobId: null,
        hash,
        cached: true,
        status: 'done',
        estMemoryBytes: 0,
        estSeconds: 0,
        board,
      };
      return c.json(res);
    }

    // `estimate` 는 **동기**다 — 사용자가 "2.1GB / 약 40초 — 실행?" 을 보고 결정한다.
    let estimate;
    try {
      estimate = await queue.estimateOnly(cfg);
    } catch (e) {
      return toHttp(e);
    }
    const estMemoryBytes = cfg.compressed ? estimate.memoryBytesCompressed : estimate.memoryBytes;

    if (body.confirm !== true) {
      const res: SolvePostResponse = {
        jobId: null,
        hash,
        cached: false,
        status: 'estimated',
        estMemoryBytes,
        estSeconds: estimate.estSeconds,
        board,
      };
      return c.json(res);
    }

    try {
      const handle = queue.submit({
        hash,
        cfg,
        outPath: cache.partPath(hash),
        estimate,
        onSaved: (summary) => {
          cache.evictFor(summary.bytes, queue.activeHashes());
          cache.commit({
            hash,
            configJson: JSON.stringify({ board: formatCards(cfg.board), pot: cfg.potChips, stack: cfg.stackChips }),
            boardCanonical: formatCards(cfg.board),
            street: cfg.board.length === 3 ? 'flop' : cfg.board.length === 4 ? 'turn' : 'river',
            potChips: cfg.potChips,
            stackChips: cfg.stackChips,
            sizings: JSON.stringify(cfg.sizings),
            compressed: cfg.compressed,
            exploitability: summary.exploitabilityPct,
            iterations: summary.iterations,
            bytes: summary.bytes,
            solver: solver.id,
            evBasis: 'stack_delta_from_node',
            elapsedMs: summary.elapsedMs,
          });
        },
      });
      const res: SolvePostResponse = {
        jobId: handle.id,
        hash,
        cached: false,
        status: handle.status,
        estMemoryBytes,
        estSeconds: estimate.estSeconds,
        board,
      };
      return c.json(res);
    } catch (e) {
      return toHttp(e);
    }
  });

  app.get('/solve/:jobId/events', (c) => {
    const handle = queue.get(c.req.param('jobId'));
    if (handle === null) throw notFound('no such job');
    return streamSSE(c, async (stream) => {
      const send = async (e: JobEvent): Promise<void> => {
        const event =
          e.status === 'done' || e.status === 'failed' || e.status === 'cancelled' ? e.status : 'progress';
        await stream.writeSSE({ event, data: JSON.stringify(e) });
      };
      // 늦게 붙어도 현재 상태를 한 번 받는다 (이미 끝났으면 done 하나 보내고 닫는다).
      await send({
        jobId: handle.id,
        hash: handle.hash,
        status: handle.status,
        ...(handle.summary === null ? {} : { summary: handle.summary }),
        ...(handle.error === null ? {} : { error: handle.error }),
      });
      if (handle.status === 'done' || handle.status === 'failed' || handle.status === 'cancelled') return;

      let finished = false;
      const queued: JobEvent[] = [];
      const off = handle.subscribe((e) => {
        queued.push(e);
        if (e.status === 'done' || e.status === 'failed' || e.status === 'cancelled') finished = true;
      });
      try {
        let ping = 0;
        while (!finished || queued.length > 0) {
          const next = queued.shift();
          if (next !== undefined) {
            await send(next);
            continue;
          }
          await stream.sleep(100);
          ping += 100;
          if (ping >= 15_000) {
            await stream.write(': ping\n\n');
            ping = 0;
          }
        }
      } finally {
        off();
      }
    });
  });

  app.delete('/solve/:jobId', (c) => {
    const r = queue.cancel(c.req.param('jobId'));
    if (r === 'not-found') throw notFound('no such job');
    if (r === 'already-done') throw new HttpError(409, 'AlreadyFinished', 'the job has already finished');
    return c.json({ status: 'cancelling' }, 202);
  });

  app.get('/solve/:hash/node', async (c) => {
    const hash = c.req.param('hash');
    const row = cache.get(hash);
    if (row === null) throw new HttpError(404, 'NoSolve', `no solve result for ${hash}`);
    const { perm, cfg } = permFor(c.req.url);
    const requested = queryParam(c.req.url, 'line') ?? '';
    try {
      assertCanonicalLine(requested);
    } catch (e) {
      return toHttp(e);
    }
    // 요청의 line 은 사용자 슈트다 → 데몬에 주기 전에 **정규 보드 기준**으로 순열한다.
    const canonicalLine = perm === null ? requested : permuteLine(requested, perm);
    try {
      const handle = await solver.open(hash, cache.binPath(hash));
      const node = await handle.node(canonicalLine);
      cache.touch(hash);
      const res: SolveNodeResponse = toNodeResponse(node, perm ?? [0, 1, 2, 3]);
      // 역순열은 **슈트**를 되돌리지만 카드 **순서**는 정규 보드의 정렬 순서다.
      // 사용자가 보낸 그대로를 돌려준다 (P4.md 2절).
      if (cfg !== null) res.board = formatCards(cfg.boardOriginal);
      return c.json(res);
    } catch (e) {
      return toHttp(e);
    }
  });

  app.get('/solve/:hash/runouts', async (c) => {
    const hash = c.req.param('hash');
    const row = cache.get(hash);
    if (row === null) throw new HttpError(404, 'NoSolve', `no solve result for ${hash}`);
    const { perm, cfg } = permFor(c.req.url);
    const requested = queryParam(c.req.url, 'line') ?? '';
    try {
      assertCanonicalLine(requested);
    } catch (e) {
      return toHttp(e);
    }
    const canonicalLine = perm === null ? requested : permuteLine(requested, perm);
    try {
      const handle = await solver.open(hash, cache.binPath(hash));
      const runouts = await handle.runouts(canonicalLine);
      cache.touch(hash);
      const res: SolveRunoutsResponse = toRunoutsResponse(runouts, perm ?? [0, 1, 2, 3], row.boardCanonical);
      if (cfg !== null) res.board = formatCards(cfg.boardOriginal);
      return c.json(res);
    } catch (e) {
      return toHttp(e);
    }
  });

  app.get('/solves', (c) => {
    const res: SolveListResponse = {
      solves: cache.list().map(listItem),
      totalBytes: cache.totalBytes(),
      capBytes: cache.capBytes,
    };
    return c.json(res);
  });

  app.delete('/solves/:hash', (c) => {
    const hash = c.req.param('hash');
    if (!cache.remove(hash)) throw new HttpError(404, 'NoSolve', `no solve result for ${hash}`);
    return c.body(null, 204);
  });

  return app;
}
