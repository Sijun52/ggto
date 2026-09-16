/**
 * 차트 생성 CLI (P7.md 9.1). 2~9-max 푸시/폴드 × 앤티 3종 × 스택 사다리.
 *
 * ```
 * node tools/chart-gen/dist/main.js --out data/charts [--sizes 2,…,9] [--antes none,bba1,pp0.125]
 *       [--stacks 3,…,20] [--workers 6] [--resume] [--allow-truncation-over]
 * ```
 *
 * 출력은 **결정적**이다 (같은 표 + 같은 설정 → 바이트 동일 문서). 그래서 `--resume` 이
 * 안전하고, `npm run seed` 를 두 번 돌리면 임포터가 전부 `skipped` 로 넘긴다.
 *
 * 두 가지 게이트가 파일을 막는다 (D24·D31·D34 — 조용히 낮은 품질을 내보내지 않는다):
 *   1. `epsilonBb >= 0.005` (4,000 반복 안에 못 넘음) → `FAILED`, 파일 없음.
 *   2. `truncationGainBb > 0.02bb` → `UNSHIPPED`, 파일 없음 (`--allow-truncation-over` 로 해제).
 * 둘 중 하나라도 있으면 exit 1 이다.
 */

import { fork } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ALIAS_FILE_NAME, MAX_TABLE_SIZE, MIN_TABLE_SIZE, contentHash, parseGgtoJson } from '@ggto/preflop';
import { ANTE_PRESETS, isAntePreset, type AntePreset } from './payoff.js';
import { TRUNCATION_GATE_BB, chartFileNameNmax, nmaxChart } from './chartNmax.js';
import { LEGACY_HU_HASHES, LEGACY_HU_STACKS, buildAliases } from './legacy.js';
import { loadInputs, type NmaxInputs } from './nmax.js';
import { ExploitabilityGateError } from './solveNmax.js';

const here = dirname(fileURLToPath(import.meta.url));

/** D36 의 스택 사다리 15단 */
export const STACK_LADDER = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 20] as const;
const ALL_SIZES = Array.from({ length: MAX_TABLE_SIZE - MIN_TABLE_SIZE + 1 }, (_unused, i) => MIN_TABLE_SIZE + i);

interface Job {
  n: number;
  ante: AntePreset;
  stack: number;
  file: string;
}

type Status = 'ok' | 'skipped' | 'failed' | 'unshipped';

interface JobResult {
  file: string;
  status: Status;
  hash?: string;
  epsilonBb?: number;
  iterations?: number;
  truncationGainBb?: number;
  massDefect?: number;
  sumGameValueBb?: number;
  seconds?: number;
  error?: string;
}

interface WorkerConfig {
  out: string;
  equity: string;
  equity3: string | null;
  equity3Meta: string | null;
  allowTruncationOver: boolean;
  truncationSamples: number | undefined;
  maxIterations: number | undefined;
}

interface TablesRef {
  value: NmaxInputs | null;
}

function generatorVersion(): string {
  const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}

function numberList(value: string, what: string): number[] {
  return value.split(',').map((s) => {
    const n = Number(s.trim());
    if (!Number.isFinite(n) || n <= 0) throw new Error(`bad ${what}: ${JSON.stringify(s)}`);
    return n;
  });
}

function anteList(value: string): AntePreset[] {
  return value.split(',').map((s) => {
    const v = s.trim();
    if (!isAntePreset(v)) throw new Error(`unknown ante preset ${JSON.stringify(v)} (want ${ANTE_PRESETS.join(', ')})`);
    return v;
  });
}

/** 정렬은 (사이즈, 앤티 순서, 스택) — 작업 순서와 마지막 표의 순서가 같다. */
function buildJobs(sizes: readonly number[], antes: readonly AntePreset[], stacks: readonly number[]): Job[] {
  const jobs: Job[] = [];
  for (const n of [...sizes].sort((a, b) => a - b)) {
    for (const ante of ANTE_PRESETS.filter((a) => antes.includes(a))) {
      for (const stack of [...stacks].sort((a, b) => a - b)) {
        jobs.push({ n, ante, stack, file: chartFileNameNmax(n, ante, stack) });
      }
    }
  }
  return jobs;
}

/** 한 장을 만들어 파일까지 쓴다. 부모(단일 워커)와 자식이 같은 함수를 쓴다. */
function runJob(job: Job, cfg: WorkerConfig, tablesRef: TablesRef): JobResult {
  const t0 = Date.now();
  tablesRef.value ??= loadInputs(cfg.equity, cfg.equity3, cfg.equity3Meta);
  const tables = tablesRef.value.tables;
  try {
    const chart = nmaxChart({
      n: job.n,
      antePreset: job.ante,
      stack: job.stack,
      tables,
      generatorVersion: generatorVersion(),
      ...(cfg.maxIterations === undefined ? {} : { solve: { maxIterations: cfg.maxIterations } }),
      ...(cfg.truncationSamples === undefined ? {} : { truncationSamples: cfg.truncationSamples }),
    });
    const seconds = (Date.now() - t0) / 1000;
    if (chart.truncation.totalBb > TRUNCATION_GATE_BB && !cfg.allowTruncationOver) {
      return {
        file: job.file,
        status: 'unshipped',
        truncationGainBb: chart.truncation.totalBb,
        epsilonBb: chart.solve.epsilonBb,
        iterations: chart.solve.iterations,
        massDefect: chart.solve.massDefect,
        sumGameValueBb: chart.solve.sumGameValueBb,
        seconds,
        error: `truncationGainBb ${chart.truncation.totalBb.toFixed(4)} > ${String(TRUNCATION_GATE_BB)}`,
      };
    }
    writeFileSync(resolve(cfg.out, job.file), `${JSON.stringify(chart.doc)}\n`, 'utf8');
    return {
      file: job.file,
      status: 'ok',
      hash: contentHash(chart.doc),
      epsilonBb: chart.solve.epsilonBb,
      iterations: chart.solve.iterations,
      truncationGainBb: chart.truncation.totalBb,
      massDefect: chart.solve.massDefect,
      sumGameValueBb: chart.solve.sumGameValueBb,
      seconds,
    };
  } catch (e) {
    if (e instanceof ExploitabilityGateError) {
      return {
        file: job.file,
        status: 'failed',
        epsilonBb: e.epsilonBb,
        iterations: e.iterations,
        seconds: (Date.now() - t0) / 1000,
        error: e.message,
      };
    }
    throw e;
  }
}

function num(x: number | undefined, f: (v: number) => string): string {
  return x === undefined ? '-' : f(x);
}

function line(r: JobResult): string {
  if (r.status === 'skipped') return `${r.file}  SKIPPED (exists)`;
  const head =
    `${r.file}  eps=${num(r.epsilonBb, (v) => v.toExponential(1))} it=${num(r.iterations, String)} ` +
    `trunc=${num(r.truncationGainBb, (v) => v.toFixed(4))}bb ${num(r.seconds, (v) => v.toFixed(0))}s`;
  if (r.status === 'ok') return head;
  return `${head}  ${r.status === 'failed' ? 'FAILED' : 'UNSHIPPED'}: ${r.error ?? ''}`;
}

// ---------------------------------------------------------------- 자식(워커)

interface JobMessage {
  type: 'job';
  job: Job;
}
interface StopMessage {
  type: 'stop';
}
interface ResultMessage {
  type: 'result';
  result: JobResult;
}

/**
 * 워커는 표를 **한 번만** 읽고 작업을 계속 받는다 (3-way 표는 로드에 1~2초 + 40MB 라
 * 차트마다 fork 하면 9-max 예산이 아니라 로딩이 시간을 먹는다).
 */
function runWorker(cfg: WorkerConfig): void {
  const tablesRef: TablesRef = { value: null };
  process.on('message', (msg: JobMessage | StopMessage) => {
    if (msg.type === 'stop') {
      process.exit(0);
    }
    let result: JobResult;
    try {
      result = runJob(msg.job, cfg, tablesRef);
    } catch (e) {
      // 게이트 실패가 아닌 진짜 오류. 워커가 조용히 죽지 않도록 부모에게 넘긴다.
      result = {
        file: msg.job.file,
        status: 'failed',
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      };
    }
    const out: ResultMessage = { type: 'result', result };
    process.send?.(out);
  });
}

// ---------------------------------------------------------------- 부모

/** 이미 있는 파일의 해시 (`--resume`). 별칭 파일을 만들려면 건너뛴 차트의 해시도 필요하다. */
function hashOfExisting(path: string): string {
  return contentHash(parseGgtoJson(readFileSync(path, 'utf8')));
}

/**
 * 옛 생성기가 남긴 `hu-pushfold-*.json` 을 지운다. 내용 해시가 `LEGACY_HU_HASHES` 와
 * **같을 때만** 지운다 — 사용자가 손으로 둔 파일은 건드리지 않는다. 지우지 않으면 임포터가
 * 은퇴시킨 셋을 다음 실행에서 다시 넣어 `RETIRED` 가 영원히 반복된다 (DoD 5 의 멱등성).
 */
function removeLegacyFiles(outDir: string): string[] {
  const legacy = new Set<string>(Object.values(LEGACY_HU_HASHES));
  const removed: string[] = [];
  for (const stack of LEGACY_HU_STACKS) {
    const path = resolve(outDir, `hu-pushfold-${String(stack)}bb.json`);
    if (!existsSync(path)) continue;
    let hash: string;
    try {
      hash = hashOfExisting(path);
    } catch (e) {
      console.log(`(kept ${basename(path)}: not readable as a chart — ${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    if (!legacy.has(hash)) continue;
    rmSync(path);
    removed.push(basename(path));
  }
  return removed;
}

function dispatch(jobs: readonly Job[], cfg: WorkerConfig, parallel: number, onResult: (r: JobResult) => void): Promise<void> {
  const self = fileURLToPath(import.meta.url);
  const queue = [...jobs];
  const args = ['--worker', '--out', cfg.out, '--equity', cfg.equity];
  // 워커는 `--sizes` 를 못 보므로 3-way 표가 필요한지를 **부모가 정해서** 넘긴다.
  // (넘기지 않으면 워커가 기본값 2..9 로 판단해 없는 표를 읽으려 한다 — 실제로 났던 버그)
  if (cfg.equity3 !== null && cfg.equity3Meta !== null) {
    args.push('--equity3', cfg.equity3, '--equity3-meta', cfg.equity3Meta);
  } else {
    args.push('--no-equity3');
  }
  if (cfg.allowTruncationOver) args.push('--allow-truncation-over');
  if (cfg.truncationSamples !== undefined) args.push('--truncation-samples', String(cfg.truncationSamples));
  if (cfg.maxIterations !== undefined) args.push('--iterations', String(cfg.maxIterations));

  return Promise.all(
    Array.from(
      { length: parallel },
      () =>
        new Promise<void>((done, reject) => {
          const child = fork(self, args);
          const next = (): void => {
            const job = queue.shift();
            if (job === undefined) {
              const stop: StopMessage = { type: 'stop' };
              child.send(stop);
              return;
            }
            const msg: JobMessage = { type: 'job', job };
            child.send(msg);
          };
          child.on('message', (msg: ResultMessage) => {
            onResult(msg.result);
            next();
          });
          child.on('error', reject);
          child.on('exit', (code) => {
            if (code === 0) done();
            else reject(new Error(`chart worker exited with code ${String(code)}`));
          });
          next();
        }),
    ),
  ).then(() => undefined);
}

async function runParent(jobs: readonly Job[], cfg: WorkerConfig, workers: number, resume: boolean): Promise<number> {
  mkdirSync(cfg.out, { recursive: true });
  const t0 = Date.now();
  const results = new Map<string, JobResult>();
  const pending: Job[] = [];

  for (const job of jobs) {
    const path = resolve(cfg.out, job.file);
    if (resume && existsSync(path)) {
      const r: JobResult = { file: job.file, status: 'skipped', hash: hashOfExisting(path) };
      results.set(job.file, r);
      console.log(line(r));
      continue;
    }
    pending.push(job);
  }

  const parallel = Math.max(1, Math.min(workers, pending.length));
  const record = (r: JobResult): void => {
    results.set(r.file, r);
    console.log(line(r));
  };
  if (parallel <= 1) {
    const tablesRef: TablesRef = { value: null };
    for (const job of pending) record(runJob(job, cfg, tablesRef));
  } else {
    await dispatch(pending, cfg, parallel, record);
  }

  // --- 별칭 파일 (P7.md 7.1) ---
  const huNone = new Map<number, string>();
  for (const job of jobs) {
    if (job.n !== 2 || job.ante !== 'none') continue;
    const hash = results.get(job.file)?.hash;
    if (hash !== undefined) huNone.set(job.stack, hash);
  }
  const aliasPath = resolve(cfg.out, ALIAS_FILE_NAME);
  if (LEGACY_HU_STACKS.every((s) => huNone.has(s))) {
    const doc = buildAliases(huNone);
    writeFileSync(aliasPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    console.log(`${aliasPath}  ${String(doc.aliases.length)} alias(es)`);
    for (const f of removeLegacyFiles(cfg.out)) console.log(`REMOVED ${f} (replaced by 2-max charts)`);
  } else {
    // 2-max/none 여섯 스택을 다 만들지 않은 실행은 별칭 파일을 **건드리지 않는다** —
    // 덮어쓰면 옛 셋이 은퇴하지 않거나(빈 목록) 잘못된 대상으로 은퇴한다.
    console.log('(aliases.json unchanged: this run did not produce all six 2-max/none legacy stacks)');
  }

  // --- 표 (DoD 3) ---
  const ordered = jobs.map((j) => results.get(j.file)).filter((r): r is JobResult => r !== undefined);
  const cell = (x: number | undefined, f: (v: number) => string, w: number): string => num(x, f).padEnd(w);
  console.log('');
  console.log(`${'file'.padEnd(29)} ${'hash8'.padEnd(9)} ${'eps'.padEnd(9)} ${'it'.padEnd(5)} ${'truncBb'.padEnd(8)} ${'massDef'.padEnd(8)} ${'sumGV'.padEnd(9)} s`);
  for (const r of ordered) {
    console.log(
      `${r.file.padEnd(29)} ${(r.hash ?? '-').slice(0, 8).padEnd(9)} ${cell(r.epsilonBb, (v) => v.toExponential(1), 9)} ` +
        `${cell(r.iterations, String, 5)} ${cell(r.truncationGainBb, (v) => v.toFixed(4), 8)} ` +
        `${cell(r.massDefect, (v) => v.toExponential(1), 8)} ${cell(r.sumGameValueBb, (v) => v.toExponential(1), 9)} ` +
        `${cell(r.seconds, (v) => v.toFixed(0), 5)}${r.status === 'ok' || r.status === 'skipped' ? '' : `  ${r.status.toUpperCase()}`}`,
    );
  }
  const failed = ordered.filter((r) => r.status === 'failed');
  const unshipped = ordered.filter((r) => r.status === 'unshipped');
  console.log('');
  console.log(
    `${String(ordered.filter((r) => r.status === 'ok').length)} written, ` +
      `${String(ordered.filter((r) => r.status === 'skipped').length)} skipped, ` +
      `${String(failed.length)} FAILED, ${String(unshipped.length)} UNSHIPPED, ` +
      `${((Date.now() - t0) / 1000).toFixed(0)}s wall, ${String(parallel)} worker(s)`,
  );
  for (const r of [...failed, ...unshipped]) console.log(`  ${r.status.toUpperCase()} ${r.file}: ${r.error ?? ''}`);
  return failed.length + unshipped.length > 0 ? 1 : 0;
}

// ---------------------------------------------------------------- 인자

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    sizes: { type: 'string' },
    antes: { type: 'string' },
    stacks: { type: 'string' },
    workers: { type: 'string' },
    resume: { type: 'boolean', default: false },
    'allow-truncation-over': { type: 'boolean', default: false },
    equity: { type: 'string' },
    equity3: { type: 'string' },
    'equity3-meta': { type: 'string' },
    iterations: { type: 'string' },
    'truncation-samples': { type: 'string' },
    worker: { type: 'boolean', default: false },
    /** 워커 전용: 3-way 표를 읽지 않는다 (2-max 전용 실행) */
    'no-equity3': { type: 'boolean', default: false },
  },
});

const outDir = resolve(values.out ?? resolve(here, '../../../data/charts'));
const equityPath = resolve(values.equity ?? resolve(here, '../data/equity169.json'));
const sizes = values.sizes === undefined ? ALL_SIZES : numberList(values.sizes, 'table size in --sizes');
const antes = values.antes === undefined ? [...ANTE_PRESETS] : anteList(values.antes);
const stacks = values.stacks === undefined ? [...STACK_LADDER] : numberList(values.stacks, 'stack in --stacks');
const workers = values.workers === undefined ? Math.max(1, cpus().length) : Number(values.workers);
if (!Number.isInteger(workers) || workers < 1) {
  throw new Error(`--workers must be a positive integer: ${String(values.workers)}`);
}

// 3-way 표는 n >= 3 일 때만 쓰인다 — `npm run seed`(2-max 45장)는 읽지 않는다.
const needThree = values['no-equity3'] === true ? false : sizes.some((n) => n >= 3);
const equity3Path = needThree ? resolve(values.equity3 ?? resolve(here, '../data/equity169-3way.bin')) : null;
const equity3MetaPath = needThree ? resolve(values['equity3-meta'] ?? resolve(here, '../data/equity169-3way.json')) : null;

const cfg: WorkerConfig = {
  out: outDir,
  equity: equityPath,
  equity3: equity3Path,
  equity3Meta: equity3MetaPath,
  allowTruncationOver: values['allow-truncation-over'] === true,
  truncationSamples: values['truncation-samples'] === undefined ? undefined : Number(values['truncation-samples']),
  maxIterations: values.iterations === undefined ? undefined : Number(values.iterations),
};

// 가장 흔한 실수: 3-way 표를 만들기 전에 `gen:charts` 를 돌리는 것. ENOENT 스택 대신
// 무엇을 해야 하는지 알려준다 (표는 커밋돼 있으므로 보통은 클론 직후에도 있다).
if (needThree && equity3Path !== null && !existsSync(equity3Path)) {
  console.error(`3-way equity table not found: ${equity3Path}`);
  console.error('run `npm run gen:equity3` first (hours), or restrict the run to `--sizes 2`.');
  process.exit(2);
}

if (values.worker === true) {
  runWorker(cfg);
} else {
  process.exit(await runParent(buildJobs(sizes, antes, stacks), cfg, workers, values.resume === true));
}
