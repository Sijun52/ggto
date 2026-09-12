/**
 * 시드 차트 생성 CLI. P2.md 7.1.
 *
 * 사용: node tools/chart-gen/dist/main.js [--out <dir>] [--stacks 5,8,10] [--iterations N] [--equity <file>]
 *
 * 출력은 결정적이다 (같은 equity 표 + 같은 iterations → 바이트 동일). 그래서 `npm run seed`
 * 를 두 번 돌리면 content_hash 가 같아 두 번째는 전부 skipped 가 된다.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { loadEquityTable } from './equityTable.js';
import { PUSH_FOLD_STACKS, chartFileName, pushFoldChart } from './chart.js';

const here = dirname(fileURLToPath(import.meta.url));

function generatorVersion(): string {
  const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    stacks: { type: 'string' },
    iterations: { type: 'string' },
    equity: { type: 'string' },
  },
});

const outDir = resolve(values.out ?? resolve(here, '../../../data/charts'));
const equityPath = resolve(values.equity ?? resolve(here, '../data/equity169.json'));
const stacks =
  values.stacks === undefined
    ? [...PUSH_FOLD_STACKS]
    : values.stacks.split(',').map((s) => {
        const n = Number(s);
        if (!Number.isFinite(n) || n <= 0) throw new Error(`bad stack in --stacks: ${JSON.stringify(s)}`);
        return n;
      });
const iterations = values.iterations === undefined ? undefined : Number(values.iterations);

const table = loadEquityTable(equityPath);
mkdirSync(outDir, { recursive: true });

const version = generatorVersion();
for (const stack of stacks) {
  const opts = iterations === undefined ? { stack, generatorVersion: version } : { stack, iterations, generatorVersion: version };
  const { doc, solve } = pushFoldChart(table, opts);
  const path = resolve(outDir, chartFileName(stack));
  writeFileSync(path, `${JSON.stringify(doc)}\n`, 'utf8');
  console.log(
    `${path}  exploitability=${solve.exploitabilityBb.toExponential(3)}bb  iterations=${String(solve.iterations)}`,
  );
}
