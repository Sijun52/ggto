/**
 * stdio JSON-lines RPC 클라이언트 (P4.md 5.3).
 *
 * **`child_process` 를 import 하는 곳은 `src/daemon/*` 뿐이다** (P4.md 2절 grep 게이트).
 * 서버·큐·캐시는 `Solver` 인터페이스만 본다.
 *
 * 다루는 실패 모드가 이 파일의 존재 이유다:
 *  - 한 청크에 여러 줄 / 한 줄이 여러 청크로 쪼개짐 → 줄 버퍼
 *  - 데몬이 죽음 → 대기 중 Promise 전부 `DaemonExited` (stderr 꼬리 포함)
 *  - 진행률 침묵 → `Stalled` 후 kill (무한 대기 금지)
 *  - 프로토콜 버전 불일치 → 즉시 종료 (`ProtocolMismatch`)
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { SolverError, type SolverErrorCode } from '../types.js';

export type SpawnFn = (
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => ChildProcessWithoutNullStreams;

const defaultSpawn: SpawnFn = (command, args, env) =>
  spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'], env }) as ChildProcessWithoutNullStreams;

/** 요청별 타임아웃 (P4.md 5.3). `solve` 는 타임아웃이 없고 침묵 감시로 대신한다. */
export const TIMEOUTS: Readonly<Record<string, number>> = {
  hello: 5_000,
  estimate: 60_000,
  load: 120_000,
  unload: 30_000,
  node: 30_000,
  runouts: 30_000,
  stats: 10_000,
  cancel: 10_000,
};

/** 진행률이 이만큼 조용하면 `Stalled` 로 끊는다 (P4.md 5.3). */
export const STALL_MS = 120_000;
/** stderr 꼬리 보관 상한 (P4.md 5.3 "8KB 초과 시 절단"). */
export const STDERR_TAIL_BYTES = 8 * 1024;
export const PROTOCOL = 1;

export interface DaemonOptions {
  bin: string;
  mode: '--solve' | '--serve';
  env?: NodeJS.ProcessEnv;
  spawnFn?: SpawnFn;
  /** stderr 줄을 서버 로그로 흘린다 */
  onStderr?: (line: string) => void;
  /**
   * 진행률 침묵 감시 창 (기본 `STALL_MS`).
   *
   * 테스트가 주입한다. `vi.useFakeTimers` 로는 이 경로를 못 잡는다 — 침묵 타이머는
   * **첫 progress 가 실제로 도착한 뒤** 무장되므로, 자식 프로세스의 실제 I/O 를 기다리는
   * 동안 가짜 타이머로 바꾸면 이미 잡힌 real timer 는 앞당겨지지 않는다.
   */
  stallMs?: number;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  method: string;
  timer: NodeJS.Timeout | null;
}

export class DaemonClient {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, Pending>();
  readonly #onStderr: (line: string) => void;
  #nextId = 1;
  #stdoutBuf = '';
  #stderrBuf = '';
  #stderrTail = '';
  #exited: SolverError | null = null;
  #closed = false;
  /** 진행률 알림 구독자 (한 프로세스에 솔브 하나) */
  #onProgress: ((p: unknown) => void) | null = null;
  #stallTimer: NodeJS.Timeout | null = null;
  readonly #stallMs: number;

  constructor(opts: DaemonOptions) {
    const spawnFn = opts.spawnFn ?? defaultSpawn;
    this.#stallMs = opts.stallMs ?? STALL_MS;
    this.#onStderr = opts.onStderr ?? ((): void => undefined);
    this.#child = spawnFn(opts.bin, [opts.mode], opts.env ?? process.env);

    this.#child.stdout.setEncoding('utf8');
    this.#child.stderr.setEncoding('utf8');
    this.#child.stdout.on('data', (chunk: string) => {
      this.#onStdout(chunk);
    });
    this.#child.stderr.on('data', (chunk: string) => {
      this.#onStderrChunk(chunk);
    });
    this.#child.on('error', (err: Error) => {
      this.#fail(new SolverError('DaemonExited', `solver process error: ${err.message}`, { stderrTail: this.#stderrTail }));
    });
    this.#child.on('exit', (code, signal) => {
      this.#fail(
        new SolverError('DaemonExited', `solver exited (code ${String(code)}, signal ${String(signal)})`, {
          code,
          signal,
          stderrTail: this.#stderrTail,
        }),
      );
    });
  }

  get pid(): number | undefined {
    return this.#child.pid;
  }

  get alive(): boolean {
    return this.#exited === null && !this.#closed;
  }

  #onStdout(chunk: string): void {
    // 줄 버퍼: 한 청크에 여러 줄이 올 수도, 한 줄이 여러 청크에 걸쳐 올 수도 있다.
    this.#stdoutBuf += chunk;
    for (;;) {
      const nl = this.#stdoutBuf.indexOf('\n');
      if (nl < 0) break;
      const line = this.#stdoutBuf.slice(0, nl).trim();
      this.#stdoutBuf = this.#stdoutBuf.slice(nl + 1);
      if (line === '') continue;
      this.#onLine(line);
    }
  }

  #onLine(line: string): void {
    let msg: { id?: number; result?: unknown; error?: { code?: string; message?: string }; method?: string; params?: unknown };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch (e) {
      // 프레임 하나가 깨진 것이 전체 세션을 죽이면 안 된다. 로그로 남기고 넘어간다.
      this.#onStderr(`[solver] unparseable line (${String(e)}): ${line.slice(0, 200)}`);
      return;
    }
    if (msg.id === undefined) {
      if (msg.method === 'progress') {
        this.#armStall();
        this.#onProgress?.(msg.params);
      }
      return;
    }
    const pending = this.#pending.get(msg.id);
    if (pending === undefined) {
      this.#onStderr(`[solver] response for unknown id ${String(msg.id)}`);
      return;
    }
    this.#pending.delete(msg.id);
    if (pending.timer !== null) clearTimeout(pending.timer);
    if (msg.error !== undefined) {
      const code = (msg.error.code ?? 'BadRequest') as SolverErrorCode;
      pending.reject(new SolverError(code, msg.error.message ?? 'solver error'));
      return;
    }
    pending.resolve(msg.result);
  }

  #onStderrChunk(chunk: string): void {
    this.#stderrTail = (this.#stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
    this.#stderrBuf += chunk;
    for (;;) {
      const nl = this.#stderrBuf.indexOf('\n');
      if (nl < 0) break;
      const line = this.#stderrBuf.slice(0, nl);
      this.#stderrBuf = this.#stderrBuf.slice(nl + 1);
      if (line.trim() !== '') this.#onStderr(`[solver] ${line.slice(0, STDERR_TAIL_BYTES)}`);
    }
  }

  #fail(err: SolverError): void {
    if (this.#exited !== null) return;
    this.#exited = err;
    if (this.#stallTimer !== null) clearTimeout(this.#stallTimer);
    this.#stallTimer = null;
    for (const [, p] of this.#pending) {
      if (p.timer !== null) clearTimeout(p.timer);
      p.reject(err);
    }
    this.#pending.clear();
  }

  #armStall(): void {
    if (this.#stallTimer !== null) clearTimeout(this.#stallTimer);
    this.#stallTimer = setTimeout(() => {
      this.#fail(new SolverError('Stalled', `no progress for ${String(this.#stallMs)}ms`, { stderrTail: this.#stderrTail }));
      this.kill();
    }, this.#stallMs);
    this.#stallTimer.unref?.();
  }

  #disarmStall(): void {
    if (this.#stallTimer !== null) clearTimeout(this.#stallTimer);
    this.#stallTimer = null;
  }

  /** 한 요청. `timeoutMs = null` 이면 타임아웃 없음 (`solve`). */
  request(method: string, params: unknown, timeoutMs: number | null = TIMEOUTS[method] ?? 30_000): Promise<unknown> {
    if (this.#exited !== null) return Promise.reject(this.#exited);
    const id = this.#nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              this.#pending.delete(id);
              reject(new SolverError('DaemonExited', `${method} timed out after ${String(timeoutMs)}ms`, { stderrTail: this.#stderrTail }));
              this.kill();
            }, timeoutMs);
      timer?.unref?.();
      this.#pending.set(id, { resolve, reject, method, timer });
      try {
        this.#child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      } catch (e) {
        this.#pending.delete(id);
        if (timer !== null) clearTimeout(timer);
        reject(new SolverError('DaemonExited', `cannot write to solver stdin: ${String(e)}`, { stderrTail: this.#stderrTail }));
      }
    });
  }

  /** `solve` 전용: 진행률 구독 + 침묵 감시를 켠다. */
  async requestWithProgress(method: string, params: unknown, onProgress: (p: unknown) => void): Promise<unknown> {
    this.#onProgress = onProgress;
    this.#armStall();
    try {
      return await this.request(method, params, null);
    } finally {
      this.#onProgress = null;
      this.#disarmStall();
    }
  }

  async hello(): Promise<{ protocol: number; solver: string; build: string; features: string[] }> {
    const r = (await this.request('hello', {})) as { protocol?: number; solver?: string; build?: string; features?: string[] };
    if (r.protocol !== PROTOCOL) {
      this.kill();
      throw new SolverError(
        'ProtocolMismatch',
        `solver speaks protocol ${String(r.protocol)}, this build speaks ${String(PROTOCOL)}`,
      );
    }
    return { protocol: r.protocol, solver: r.solver ?? 'unknown', build: r.build ?? 'unknown', features: r.features ?? [] };
  }

  /**
   * 정상 종료: stdin 을 닫고 2초 기다린 뒤에도 살아 있으면 kill (P4.md 5.1).
   * Windows 에는 SIGTERM 이 없어 `kill()` 이 곧 TerminateProcess 다 — 그래서 먼저 stdin 을 닫는다.
   */
  async close(graceMs = 2_000): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#disarmStall();
    try {
      this.#child.stdin.end();
    } catch {
      // stdin 이 이미 닫혔다면 할 일이 없다. 아래 kill 경로가 남는다.
      this.#onStderr('[solver] stdin already closed');
    }
    const exited = await this.#waitExit(graceMs);
    if (!exited) this.kill();
  }

  #waitExit(ms: number): Promise<boolean> {
    if (this.#exited !== null) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, ms);
      timer.unref?.();
      this.#child.once('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  kill(): void {
    this.#disarmStall();
    try {
      this.#child.kill();
    } catch (e) {
      this.#onStderr(`[solver] kill failed: ${String(e)}`);
    }
  }
}
