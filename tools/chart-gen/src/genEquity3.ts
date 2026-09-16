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
import { readFileSync, writeFileSync } from 'node:fs';
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

interface ShardPayload {
  index: number[];
  data: number[];
}

interface ShardMessage {
  type: 'progress' | 'done';
  done?: number;
  buffer?: ShardPayload;
}

function runShard(shard: number, shards: number, samples: number): void {
  const triples = allTriples();
  const index: number[] = [];
  const data: number[] = [];
  let done = 0;
  for (let t = shard; t < TRIPLE_COUNT; t += shards) {
    const i = triples[t * 3] as number;
    const j = triples[t * 3 + 1] as number;
    const k = triples[t * 3 + 2] as number;
    const { shares, w3 } = sampleTriple(i, j, k, samples);
    const [qa, qb, qc] = quantizeShares(i, j, k, shares);
    index.push(t);
    data.push(w3, qa, qb, qc);
    done++;
    if (done % PROGRESS_EVERY === 0) {
      const msg: ShardMessage = { type: 'progress', done: PROGRESS_EVERY };
      process.send?.(msg);
    }
  }
  const msg: ShardMessage = { type: 'done', buffer: { index, data } };
  process.send?.(msg);
}

async function runParent(binOut: string, metaOut: string, samples: number, workers: number): Promise<void> {
  const self = fileURLToPath(import.meta.url);
  const t0 = Date.now();
  let done = 0;

  const shards = await Promise.all(
    Array.from(
      { length: workers },
      (_unused, shard) =>
        new Promise<ShardPayload>((resolvePromise, reject) => {
          const child = fork(self, ['--shard', String(shard), '--shards', String(workers), '--samples', String(samples)]);
          child.on('message', (msg: ShardMessage) => {
            if (msg.type === 'progress') {
              done += msg.done ?? 0;
              const pct = ((done / TRIPLE_COUNT) * 100).toFixed(2);
              const elapsed = (Date.now() - t0) / 1000;
              const eta = done === 0 ? 0 : (elapsed / done) * (TRIPLE_COUNT - done);
              process.stdout.write(
                `\r${String(done)}/${String(TRIPLE_COUNT)} triples (${pct}%) ${elapsed.toFixed(0)}s elapsed, eta ${eta.toFixed(0)}s   `,
              );
            } else if (msg.type === 'done') resolvePromise(msg.buffer ?? { index: [], data: [] });
          });
          child.on('error', reject);
          child.on('exit', (code) => {
            if (code !== 0) reject(new Error(`shard ${String(shard)} exited with code ${String(code)}`));
          });
        }),
    ),
  );
  process.stdout.write('\n');

  const out = new Uint16Array(TRIPLE_COUNT * 4);
  const filled = new Uint8Array(TRIPLE_COUNT);
  for (const shardResult of shards) {
    for (let n = 0; n < shardResult.index.length; n++) {
      const t = shardResult.index[n] as number;
      out[t * 4] = shardResult.data[n * 4] as number;
      out[t * 4 + 1] = shardResult.data[n * 4 + 1] as number;
      out[t * 4 + 2] = shardResult.data[n * 4 + 2] as number;
      out[t * 4 + 3] = shardResult.data[n * 4 + 3] as number;
      filled[t] = 1;
    }
  }
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

if (values.shard !== undefined && values.shards !== undefined) {
  runShard(Number(values.shard), Number(values.shards), samples);
} else {
  const here = dirname(fileURLToPath(import.meta.url));
  const binOut = values.out === undefined ? resolve(here, '../data/equity169-3way.bin') : resolve(values.out);
  const metaOut = binOut.replace(/\.bin$/, '.json');
  if (metaOut === binOut) throw new Error('--out must end with .bin');
  const workers = values.workers === undefined ? Math.max(1, cpus().length) : Number(values.workers);
  await runParent(binOut, metaOut, samples, workers);
}
