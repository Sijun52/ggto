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
  boardWithDealt,
  buildConfig,
  canonicalConfigJson,
  configHash,
  isSizingPreset,
  permuteLine,
  toNodeResponse,
  toRunoutsResponse,
  type CanonicalConfig,
  type JobEvent,
  type SizingPresetName,
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
        : e.code === 'NoSuchLine' ||
            e.code === 'ChanceNode' ||
            e.code === 'NotChanceNode' ||
            e.code === 'BadRequest'
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

/** 다섯 파라미터 밖의 **설정** 파라미터. 이것만 와도 "쿼리 없음" 이 아니다 (R2 MINOR 3). */
const EXTRA_CONFIG_PARAMS = ['sizings', 'compressed', 'rakePct', 'rakeCapBb'] as const;

/**
 * `compressed` 쿼리. `1`·`true` 가 참, `0`·`false`·없음이 거짓, 그 밖은 **400** 이다.
 *
 * R2 MINOR 2: 전에는 문자 `1` 만 참이라 `compressed=true` 가 조용히 거짓으로 읽혔고,
 * 압축 솔브를 표기 모드로 열면 해시가 갈라져 `HashMismatch` 가 났다. 조용한 오독을
 * 없애려면 "모르는 값" 을 통과시키지 않아야 한다.
 */
function compressedParam(url: string): boolean {
  const raw = queryParam(url, 'compressed');
  if (raw === null || raw === '0' || raw === 'false') return false;
  if (raw === '1' || raw === 'true') return true;
  throw badRequest(`compressed must be 1/true/0/false, got ${JSON.stringify(raw)}`);
}

/**
 * `hash` 로 저장된 결과를 열어 노드를 읽을 때 쓸 **슈트 순열**을 구한다.
 *
 * `perm` 은 캐시 행에 저장하지 않는다 (P4.md 4.1: 한 해시에 여러 perm 이 대응하므로
 * 저장하면 모순이 된다) — 요청의 설정에서 다시 계산한다.
 *
 * **그래서 설정이 그 해시의 것인지 검증해야 한다** (R1 MAJOR 2): 쿼리로 온 설정에서
 * 해시를 다시 계산해 경로의 `:hash` 와 같지 않으면 400 이다. 검증하지 않으면 다른 게임의
 * `perm` 을 이 게임의 1326 배열에 적용해 **뒤섞인 배열을 원본이라고** 답하게 된다
 * (실측: `board=Ad5d5c` 로 200).
 *
 * 쿼리가 **아예 없으면** 순열 없이 정규 보드 공간 그대로 답한다 (응답의 `perm` 이
 * 항등 `[0,1,2,3]` 으로 그 사실을 알린다). 정규 보드도 유효한 표기다 — 거짓말이 아니다.
 */
function permFor(
  url: string,
  hash: string,
  solverId: string,
): { perm: [number, number, number, number] | null; cfg: CanonicalConfig | null } {
  const board = queryParam(url, 'board');
  const oop = queryParam(url, 'oop');
  const ip = queryParam(url, 'ip');
  const potBb = queryParam(url, 'potBb');
  const stackBb = queryParam(url, 'stackBb');
  const extras = EXTRA_CONFIG_PARAMS.filter((k) => queryParam(url, k) !== null);
  if (board === null && oop === null && ip === null && potBb === null && stackBb === null) {
    if (extras.length > 0) {
      // `sizings=standard` 만 온 요청을 "쿼리 없음" 으로 보면 정규 보드로 200 을 주면서
      // 사용자가 보낸 설정은 **무시**한 것이 된다 (R2 MINOR 3). 다섯 파라미터 규칙과
      // 같은 이유로 거절한다.
      throw badRequest(
        `${extras.join(', ')} needs board, oop, ip, potBb, stackBb too (or send no config at all)`,
      );
    }
    return { perm: null, cfg: null };
  }
  if (board === null || oop === null || ip === null || potBb === null || stackBb === null) {
    // 반쪽 설정은 해시를 재계산할 수 없다. 조용히 정규 보드로 떨어지면 사용자가
    // "내 슈트로 답을 받았다" 고 오해한다.
    throw badRequest('board, oop, ip, potBb, stackBb must be given together (or all omitted)');
  }
  const sizings = queryParam(url, 'sizings') ?? 'simple';
  if (!isSizingPreset(sizings)) throw badRequest(`unknown sizings preset: ${sizings}`);
  const compressed = compressedParam(url);
  const rakePct = queryParam(url, 'rakePct');
  const rakeCapBb = queryParam(url, 'rakeCapBb');
  let cfg: CanonicalConfig;
  try {
    cfg = buildConfig({
      board,
      oop,
      ip,
      potBb: Number(potBb),
      stackBb: Number(stackBb),
      sizings: sizings as SizingPresetName,
      compressed,
      ...(rakePct === null
        ? {}
        : { rake: { mode: 'pot' as const, pct: Number(rakePct), capBb: Number(rakeCapBb ?? '0') } }),
    });
  } catch (e) {
    return toHttp(e);
  }
  if (configHash(cfg, solverId) !== hash) {
    throw new HttpError(
      400,
      'HashMismatch',
      'the query config does not hash to this solve — it describes a different game',
    );
  }
  return { perm: [...cfg.perm] as [number, number, number, number], cfg };
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

  /**
   * 재솔브(REPLACE)·삭제·LRU 축출로 `.bin` 이 바뀌기 **직전**에 조회 데몬이 들고 있는
   * 결과를 버리게 한다 (R1 MAJOR 3: 낡은 전략을 계속 답했다). 여기서 거는 이유는
   * 캐시를 만드는 곳과 솔버를 아는 곳이 다르기 때문이다 — 라우트가 둘 다 안다.
   * 실패는 로그만 남긴다: 데몬이 이미 죽었어도 캐시 쓰기를 막을 이유가 없고,
   * 데몬의 `(크기, mtime)` 재로드가 정답을 따로 보증한다.
   */
  cache.onInvalidate((hash) => {
    void solver.invalidate(hash).catch((e: unknown) => {
      console.error(`[ggto] unload ${hash} failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  });

  app.post('/solve', async (c) => {
    const body = (await c.req.json().catch(() => {
      throw badRequest('body must be JSON');
    })) as SolveRequestDto;

    // **API 는 프리셋 이름만 받는다** (P4.md 3.2, R2 MINOR 1). 커스텀 사이징으로 만든
    // 솔브는 쿼리로 사이징을 표현할 수 없어 표기 모드로 영영 열리지 않는다 (`permFor` 가
    // 프리셋만 받는다) — 만들 수 있게 두면 UI 가 열지 못하는 결과만 쌓인다. CLI 는 그대로다.
    if (body.sizings !== undefined && !isSizingPreset(body.sizings)) {
      throw new HttpError(
        400,
        'OutOfRange',
        `sizings must be one of simple, standard, river-heavy (custom sizings are CLI-only)`,
      );
    }

    let cfg: CanonicalConfig;
    try {
      cfg = buildConfig(body);
    } catch (e) {
      return toHttp(e);
    }
    const hash = configHash(cfg, solver.id);
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

    // 같은 게임이 이미 큐/실행 중이면 **그 잡을 돌려준다** (P4 R1 MINOR 4). 폼 더블탭이
    // 정확히 이 경로다: 다시 추정하면 트리를 빌드하는 프로세스가 하나 더 뜨고 (GB 단위),
    // 사용자는 같은 솔브의 잡 두 개를 보게 된다.
    const running = queue.byHash(hash);
    if (running !== null) {
      const est = running.estimate;
      const res: SolvePostResponse = {
        jobId: running.id,
        hash,
        cached: false,
        status: running.status,
        estMemoryBytes: running.memoryBytes,
        estSeconds: est === null ? 0 : est.estSeconds,
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
            // 정규 JSON 전체다 (P4.md 4.1 "재현·목록용"). 레인지가 없으면 행만으로
            // 게임을 재현할 수 없다 — 해시의 입력이 곧 게임의 정의다.
            configJson: canonicalConfigJson(cfg, solver.id),
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
    const { perm, cfg } = permFor(c.req.url, hash, solver.id);
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
      // 역순열은 **슈트**를 되돌리지만 카드 **순서**는 정규 보드의 정렬 순서다. 사용자가
      // 보낸 순서로 되돌리되 **라인에서 딜된 카드는 지운다** (R1 MAJOR 1: 통째로
      // 덮어써서 `X-X/Qc` 의 턴 카드가 사라졌다).
      if (cfg !== null) res.board = boardWithDealt(formatCards(cfg.boardOriginal), res.board);
      return c.json(res);
    } catch (e) {
      return toHttp(e);
    }
  });

  app.get('/solve/:hash/runouts', async (c) => {
    const hash = c.req.param('hash');
    const row = cache.get(hash);
    if (row === null) throw new HttpError(404, 'NoSolve', `no solve result for ${hash}`);
    const { perm, cfg } = permFor(c.req.url, hash, solver.id);
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
      const res: SolveRunoutsResponse = toRunoutsResponse(runouts, perm ?? [0, 1, 2, 3]);
      if (cfg !== null) res.board = boardWithDealt(formatCards(cfg.boardOriginal), res.board);
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
