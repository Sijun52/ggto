/**
 * `equity169-3way.bin` (+ `.json`) 생성 CLI. P7.md 3.2.
 *
 * 사용: node tools/chart-gen/dist/genEquity3.js [--samples 100000] [--workers 6] [--out <file>]
 *
 * 818,805 개의 클래스 3중집합마다 S 샘플을 돌린다. 시드가 트리플 이름에서만 나오므로
 * 샤딩(`multisetIndex mod workers`) 은 결과에 영향을 주지 않는다 — 워커 수를 바꿔도
 * 바이트 동일한 파일이 나온다.
 */

import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync, writeSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  EQUITY3_ENCODING,
  EQUITY3_FORMAT,
  EQUITY3_SEED_RULE,
  EQUITY3_VERSION,
  RECORD_BYTES,
  TRIPLE_COUNT,
  allTriples,
  multisetIndex,
  type Equity3Meta,
} from './equity3.js';
import { SAMPLER_VERSION, quantizeShares, sampleTriple } from './equity3Mc.js';

const PROGRESS_EVERY = 200;

interface ShardMessage {
  type: 'progress' | 'done';
  done?: number;
}

/** 샤드 체크포인트 한 항목: [multisetIndex, w3, share_i, share_j, share_k] u32 LE */
const PART_RECORD_BYTES = 20;

export function shardPath(binOut: string, shard: number): string {
  return `${binOut}.shard${String(shard)}.part`;
}

/**
 * 워커 하나. **체크포인트를 남긴다** — 이 작업은 6 워커로도 한 시간이 넘고, 도중에 죽으면
 * 전부 잃는다. 200 트리플마다 자기 샤드 파일에 덧붙이고, 다시 켜면 이미 적힌 개수만큼
 * 건너뛴다 (샤드 안의 처리 순서가 결정적이라 개수만으로 재개 지점이 정해진다).
 */
function runShard(shard: number, shards: number, samples: number, binOut: string): void {
  const triples = allTriples();
  const path = shardPath(binOut, shard);
  let already = 0;
  if (existsSync(path)) {
    const size = statSync(path).size;
    if (size % PART_RECORD_BYTES !== 0) {
      // 마지막 flush 가 잘린 경우: 온전한 레코드까지만 인정하고 뒤를 버린다.
      truncateSync(path, size - (size % PART_RECORD_BYTES));
    }
    already = Math.floor(size / PART_RECORD_BYTES);
  }
  const handle = openSync(path, 'a');
  const buffer = new Uint32Array(PROGRESS_EVERY * 5);
  let pending = 0;
  let done = 0;
  const flush = (): void => {
    if (pending === 0) return;
    writeSync(handle, new Uint8Array(buffer.buffer, 0, pending * PART_RECORD_BYTES));
    fsyncSync(handle);
    pending = 0;
  };
  for (let t = shard; t < TRIPLE_COUNT; t += shards) {
    done++;
    if (done <= already) continue;
    const i = triples[t * 3] as number;
    const j = triples[t * 3 + 1] as number;
    const k = triples[t * 3 + 2] as number;
    const { shares, w3 } = sampleTriple(i, j, k, samples);
    const [qa, qb, qc] = quantizeShares(i, j, k, shares);
    buffer[pending * 5] = t;
    buffer[pending * 5 + 1] = w3;
    buffer[pending * 5 + 2] = qa;
    buffer[pending * 5 + 3] = qb;
    buffer[pending * 5 + 4] = qc;
    pending++;
    if (pending === PROGRESS_EVERY) {
      flush();
      const msg: ShardMessage = { type: 'progress', done: PROGRESS_EVERY };
      process.send?.(msg);
    }
  }
  flush();
  closeSync(handle);
  const msg: ShardMessage = { type: 'done' };
  process.send?.(msg);
}

/** 샤드 체크포인트 파일들을 읽어 최종 레코드 배열로 합친다. */
function collectShards(binOut: string, workers: number): { out: Uint16Array; filled: Uint8Array } {
  const out = new Uint16Array(TRIPLE_COUNT * 4);
  const filled = new Uint8Array(TRIPLE_COUNT);
  for (let shard = 0; shard < workers; shard++) {
    const path = shardPath(binOut, shard);
    if (!existsSync(path)) throw new Error(`shard checkpoint ${path} is missing`);
    const bytes = readFileSync(path);
    if (bytes.length % PART_RECORD_BYTES !== 0) throw new Error(`shard checkpoint ${path} has a truncated record`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    for (let r = 0; r * PART_RECORD_BYTES < bytes.length; r++) {
      const base = r * PART_RECORD_BYTES;
      const t = view.getUint32(base, true);
      if (t >= TRIPLE_COUNT) throw new Error(`shard checkpoint ${path} record ${String(r)} has index ${String(t)}`);
      out[t * 4] = view.getUint32(base + 4, true);
      out[t * 4 + 1] = view.getUint32(base + 8, true);
      out[t * 4 + 2] = view.getUint32(base + 12, true);
      out[t * 4 + 3] = view.getUint32(base + 16, true);
      filled[t] = 1;
    }
  }
  return { out, filled };
}

async function runParent(binOut: string, metaOut: string, samples: number, workers: number): Promise<void> {
  const self = fileURLToPath(import.meta.url);
  const t0 = Date.now();
  let done = 0;

  await Promise.all(
    Array.from(
      { length: workers },
      (_unused, shard) =>
        new Promise<void>((resolvePromise, reject) => {
          const child = fork(self, [
            '--shard',
            String(shard),
            '--shards',
            String(workers),
            '--samples',
            String(samples),
            '--out',
            binOut,
          ]);
          child.on('message', (msg: ShardMessage) => {
            if (msg.type !== 'progress') return;
            done += msg.done ?? 0;
            const pct = ((done / TRIPLE_COUNT) * 100).toFixed(2);
            const elapsed = (Date.now() - t0) / 1000;
            const eta = done === 0 ? 0 : (elapsed / done) * (TRIPLE_COUNT - done);
            process.stdout.write(
              `${String(done)}/${String(TRIPLE_COUNT)} triples (${pct}%) ${elapsed.toFixed(0)}s elapsed, eta ${eta.toFixed(0)}s
`,
            );
          });
          child.on('error', reject);
          child.on('exit', (code) => {
            if (code === 0) resolvePromise();
            else reject(new Error(`shard ${String(shard)} exited with code ${String(code)}`));
          });
        }),
    ),
  );

  const { out, filled } = collectShards(binOut, workers);
  for (let t = 0; t < TRIPLE_COUNT; t++) {
    if (filled[t] !== 1) throw new Error(`triple ${String(t)} was never computed (shard bookkeeping bug)`);
  }

  const bytes = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  writeFileSync(binOut, bytes);
  const elapsedSec = Math.round(((Date.now() - t0) / 1000) * 10) / 10;
  const meta: Equity3Meta = {
    format: EQUITY3_FORMAT,
    version: EQUITY3_VERSION,
    samples,
    seedRule: EQUITY3_SEED_RULE,
    samplerVersion: SAMPLER_VERSION,
    coreVersion: coreVersion(),
    tripleCount: TRIPLE_COUNT,
    encoding: EQUITY3_ENCODING,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    elapsedSec,
    workers,
  };
  writeFileSync(metaOut, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  console.log(
    `wrote ${binOut} (${String(TRIPLE_COUNT * RECORD_BYTES)} B)  samples=${String(samples)}  workers=${String(workers)}  sha256=${meta.sha256}`,
  );
  console.log(`elapsed ${String(elapsedSec)}s`);
}

/** 표가 어느 core 로 만들어졌는지 남긴다 (평가기가 바뀌면 표를 다시 만들어야 한다). */
function coreVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(resolve(here, '../../../packages/core/package.json'), 'utf8')) as { version?: string };
  return `@ggto/core@${pkg.version ?? 'unknown'}`;
}

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    samples: { type: 'string' },
    workers: { type: 'string' },
    shard: { type: 'string' },
    shards: { type: 'string' },
  },
});

const samples = values.samples === undefined ? 100_000 : Number(values.samples);
if (!Number.isInteger(samples) || samples < 1) throw new Error('--samples must be a positive integer');
// 전단사 가정이 깨지면 레코드가 서로 덮어써진다. 시작 전에 한 번 부딪혀 본다.
if (multisetIndex(168, 168, 168) !== TRIPLE_COUNT - 1) throw new Error('multisetIndex is not a bijection onto 0..818804');

const here = dirname(fileURLToPath(import.meta.url));
const binOut = values.out === undefined ? resolve(here, '../data/equity169-3way.bin') : resolve(values.out);
const metaOut = binOut.replace(/\.bin$/, '.json');
if (metaOut === binOut) throw new Error('--out must end with .bin');

if (values.shard !== undefined && values.shards !== undefined) {
  runShard(Number(values.shard), Number(values.shards), samples, binOut);
} else {
  const workers = values.workers === undefined ? Math.max(1, cpus().length) : Number(values.workers);
  await runParent(binOut, metaOut, samples, workers);
}
