/**
 * 잡 큐 + **메모리 게이트** (P4.md 5.2).
 *
 * 실패 지점 1번이 메모리다. 세마포어(동시 2)만으로는 OOM 을 막지 못한다 — 2GB 짜리 둘과
 * 6GB 짜리 둘은 같은 "2 잡" 이다. 그래서 트리 빌드 뒤 `estimate` 가 준 **실제 필요량**을
 * 합산해 8GB 를 넘으면 시작하지 않는다. 단일 잡이 상한을 넘으면 기다려도 소용없으므로
 * 즉시 `TooLarge` 다 (사용자에게 사이징을 줄이라고 말할 수 있는 유일한 지점).
 */

import { SolverError, type CanonicalConfig, type Estimate, type ProgressEvent, type SolveSummary, type Solver } from './types.js';

export type JobStatus = 'queued' | 'estimating' | 'running' | 'saving' | 'done' | 'failed' | 'cancelled';

export interface JobEvent {
  jobId: string;
  hash: string;
  status: JobStatus;
  progress?: ProgressEvent;
  summary?: SolveSummary;
  estimate?: Estimate;
  error?: { code: string; message: string };
}

export interface JobHandle {
  id: string;
  hash: string;
  status: JobStatus;
  estimate: Estimate | null;
  memoryBytes: number;
  summary: SolveSummary | null;
  error: { code: string; message: string } | null;
  subscribe(fn: (e: JobEvent) => void): () => void;
  /** 완료/실패/취소까지 기다린다 */
  done(): Promise<SolveSummary>;
}

export interface SubmitInput {
  hash: string;
  cfg: CanonicalConfig;
  /** `.part` 경로. 완료 후 rename 은 `onSaved` 가 한다 */
  outPath: string;
  /** rename + index INSERT. 여기서 던지면 잡은 `failed` 다 */
  onSaved: (summary: SolveSummary) => void | Promise<void>;
  /**
   * 라우트가 이미 동기로 받아 둔 추정 (P4.md 5.2 "사전 확인"). 주면 큐가 다시 재지 않는다
   * — 트리 빌드는 공짜가 아니고, 무엇보다 `TooLarge` 판정이 **제출 시점에** 나야
   * 사용자가 413 을 즉시 받는다.
   */
  estimate?: Estimate;
}

export interface JobQueueOptions {
  solver: Solver;
  concurrency?: number;
  memoryBytes?: number;
  now?: () => number;
}

export const DEFAULT_CONCURRENCY = 2;
export const DEFAULT_MEMORY_BYTES = 8 * 1024 * 1024 * 1024;

interface Job {
  id: string;
  hash: string;
  cfg: CanonicalConfig;
  outPath: string;
  onSaved: (summary: SolveSummary) => void | Promise<void>;
  status: JobStatus;
  estimate: Estimate | null;
  memoryBytes: number;
  summary: SolveSummary | null;
  error: { code: string; message: string } | null;
  subscribers: Set<(e: JobEvent) => void>;
  waiters: { resolve: (s: SolveSummary) => void; reject: (e: unknown) => void }[];
  abort: AbortController;
}

export class JobQueue {
  readonly #solver: Solver;
  readonly #concurrency: number;
  readonly #memoryCap: number;
  readonly #jobs = new Map<string, Job>();
  readonly #byHash = new Map<string, Job>();
  #queue: Job[] = [];
  #running = new Set<Job>();
  #seq = 0;
  /** `#pump` 재진입 가드 (아래 설명) */
  #pumping = false;

  constructor(opts: JobQueueOptions) {
    this.#solver = opts.solver;
    this.#concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
    this.#memoryCap = opts.memoryBytes ?? DEFAULT_MEMORY_BYTES;
  }

  get memoryCap(): number {
    return this.#memoryCap;
  }

  /** 실행 중 잡들이 붙잡고 있는 예상 메모리 합 */
  runningMemoryBytes(): number {
    let n = 0;
    for (const j of this.#running) n += j.memoryBytes;
    return n;
  }

  /** 실행 중·대기 중 해시 (캐시 LRU 가 지우면 안 되는 것들) */
  activeHashes(): Set<string> {
    return new Set([...this.#byHash.keys()]);
  }

  get(jobId: string): JobHandle | null {
    const j = this.#jobs.get(jobId);
    return j === undefined ? null : this.#handle(j);
  }

  byHash(hash: string): JobHandle | null {
    const j = this.#byHash.get(hash);
    return j === undefined ? null : this.#handle(j);
  }

  /** `estimate` 만. 큐에 넣지 않는다 (`confirm` 없는 요청, P4.md 5.2). */
  async estimateOnly(cfg: CanonicalConfig): Promise<Estimate> {
    return this.#solver.estimate(cfg);
  }

  /**
   * 잡 제출. 같은 해시가 이미 큐/실행 중이면 **그 잡에 합류한다** (jobId 공유, P4.md 4.3).
   */
  submit(input: SubmitInput): JobHandle {
    const existing = this.#byHash.get(input.hash);
    if (existing !== undefined) return this.#handle(existing);

    const preEstimate = input.estimate ?? null;
    const preMemory =
      preEstimate === null ? 0 : input.cfg.compressed ? preEstimate.memoryBytesCompressed : preEstimate.memoryBytes;
    if (preMemory > this.#memoryCap) {
      // 기다려도 줄어들지 않는다 — 큐에 넣지 않고 바로 실패시킨다 (P4.md 5.2).
      throw new SolverError(
        'TooLarge',
        `this spot needs ${fmtGb(preMemory)} but the cap is ${fmtGb(this.#memoryCap)} — use fewer bet sizes or a narrower range`,
      );
    }

    this.#seq += 1;
    const job: Job = {
      id: `job-${String(this.#seq)}`,
      hash: input.hash,
      cfg: input.cfg,
      outPath: input.outPath,
      onSaved: input.onSaved,
      status: 'queued',
      estimate: preEstimate,
      memoryBytes: preMemory,
      summary: null,
      error: null,
      subscribers: new Set(),
      waiters: [],
      abort: new AbortController(),
    };
    this.#jobs.set(job.id, job);
    this.#byHash.set(job.hash, job);
    this.#queue.push(job);
    // 제출 직후에 구독할 틈을 준다 — 동기로 돌리면 첫 이벤트를 아무도 못 본다.
    queueMicrotask(() => {
      this.#pump();
    });
    return this.#handle(job);
  }

  cancel(jobId: string): 'cancelling' | 'not-found' | 'already-done' {
    const job = this.#jobs.get(jobId);
    if (job === undefined) return 'not-found';
    if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return 'already-done';
    job.abort.abort();
    if (job.status === 'queued') {
      this.#queue = this.#queue.filter((j) => j !== job);
      this.#finish(job, 'cancelled', { code: 'Cancelled', message: 'cancelled before start' });
    }
    return 'cancelling';
  }

  #handle(job: Job): JobHandle {
    return {
      id: job.id,
      hash: job.hash,
      get status() {
        return job.status;
      },
      get estimate() {
        return job.estimate;
      },
      get memoryBytes() {
        return job.memoryBytes;
      },
      get summary() {
        return job.summary;
      },
      get error() {
        return job.error;
      },
      subscribe: (fn) => {
        job.subscribers.add(fn);
        return () => job.subscribers.delete(fn);
      },
      done: async () =>
        new Promise<SolveSummary>((resolve, reject) => {
          if (job.status === 'done' && job.summary !== null) {
            resolve(job.summary);
            return;
          }
          if (job.status === 'failed' || job.status === 'cancelled') {
            reject(new SolverError((job.error?.code ?? 'BadRequest') as 'Cancelled', job.error?.message ?? 'failed'));
            return;
          }
          job.waiters.push({ resolve, reject });
        }),
    };
  }

  #emit(job: Job, extra: Partial<JobEvent> = {}): void {
    const event: JobEvent = { jobId: job.id, hash: job.hash, status: job.status, ...extra };
    for (const fn of job.subscribers) fn(event);
  }

  #setStatus(job: Job, status: JobStatus, extra: Partial<JobEvent> = {}): void {
    job.status = status;
    this.#emit(job, extra);
  }

  #finish(job: Job, status: 'done' | 'failed' | 'cancelled', error?: { code: string; message: string }): void {
    if (error !== undefined) job.error = error;
    job.status = status;
    this.#byHash.delete(job.hash);
    this.#running.delete(job);
    this.#emit(job, error === undefined && job.summary !== null ? { summary: job.summary } : error === undefined ? {} : { error });
    const waiters = job.waiters.splice(0);
    for (const w of waiters) {
      if (status === 'done' && job.summary !== null) w.resolve(job.summary);
      else w.reject(new SolverError((error?.code ?? 'Cancelled') as 'Cancelled', error?.message ?? status));
    }
    this.#pump();
  }

  /**
   * 슬롯과 메모리가 허락하는 **한 계속** 뽑는다.
   *
   * 한 번에 하나만 시작하면 큰 잡이 끝난 뒤 슬롯 하나가 논다 (R1 MAJOR 4 실측:
   * 7.5GB 잡 종료 후 1GB 둘 중 하나만 `running`). 전이는 종료 한 번에 여러 잡을
   * 풀어 줄 수 있으므로 루프여야 한다.
   *
   * 재진입 가드: `#run` 은 첫 await 전에 동기로 실패할 수 있고 그러면 `#finish` →
   * `#pump` 가 이 루프 안에서 다시 돈다. 바깥 루프가 어차피 계속 돌므로 안쪽은 즉시
   * 돌아간다 (같은 잡을 두 번 시작하지 않는다).
   */
  #pump(): void {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      while (this.#running.size < this.#concurrency) {
        // 큐의 앞에서부터 **메모리가 맞는 첫 잡**을 고른다. 머리 하나가 크다고 뒤를 전부
        // 굶기면 작은 잡이 영원히 못 돈다 (head-of-line blocking).
        const idx = this.#queue.findIndex(
          (j) => j.estimate === null || this.runningMemoryBytes() + j.memoryBytes <= this.#memoryCap,
        );
        if (idx < 0) return;
        const job = this.#queue.splice(idx, 1)[0] as Job;
        this.#running.add(job);
        void this.#run(job);
      }
    } finally {
      this.#pumping = false;
    }
  }

  async #run(job: Job): Promise<void> {
    try {
      if (job.abort.signal.aborted) throw new SolverError('Cancelled', 'cancelled');
      if (job.estimate === null) {
        // `estimating` 도 실행 슬롯을 쓴다 — 트리 빌드가 메모리를 먹는다 (P4.md 5.2).
        this.#setStatus(job, 'estimating');
        const estimate = await this.#solver.estimate(job.cfg);
        job.estimate = estimate;
        job.memoryBytes = job.cfg.compressed ? estimate.memoryBytesCompressed : estimate.memoryBytes;
        this.#emit(job, { estimate });

        if (job.memoryBytes > this.#memoryCap) {
          throw new SolverError(
            'TooLarge',
            `this spot needs ${fmtGb(job.memoryBytes)} but the cap is ${fmtGb(this.#memoryCap)} — use fewer bet sizes or a narrower range`,
          );
        }
        // 추정 전에는 0 으로 잡혀 있었다. 이제 실제 크기로 다시 게이트를 통과해야 한다.
        if (this.runningMemoryBytes() > this.#memoryCap) {
          this.#running.delete(job);
          this.#setStatus(job, 'queued');
          this.#queue.unshift(job);
          this.#pump();
          return;
        }
      }
      if (job.abort.signal.aborted) throw new SolverError('Cancelled', 'cancelled');

      this.#setStatus(job, 'running');
      const summary = await this.#solver.solve(
        job.cfg,
        {
          targetExploitabilityPct: job.cfg.targetExploitabilityPct,
          maxIterations: job.cfg.maxIterations,
          outPath: job.outPath,
        },
        (p) => {
          this.#emit(job, { progress: p });
        },
        job.abort.signal,
      );
      job.summary = summary;
      this.#setStatus(job, 'saving');
      await job.onSaved(summary);
      this.#finish(job, 'done');
    } catch (e) {
      const err = e instanceof SolverError ? e : new SolverError('BadRequest', e instanceof Error ? e.message : String(e));
      this.#finish(job, err.code === 'Cancelled' ? 'cancelled' : 'failed', { code: err.code, message: err.message });
    }
  }
}

function fmtGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
}
