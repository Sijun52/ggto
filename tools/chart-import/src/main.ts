/**
 * ggto-json → SQLite 임포터 CLI. P2.md 6.1.
 *
 * 종료 코드: 0 성공 / 1 파일 중 하나 이상 실패 / 2 사용법·포맷 오류.
 * 출력: 파일당 JSON 한 줄 + 사람용 한 줄 (JSON 은 stdout, 사람용도 stdout).
 */

import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { AliasFileError } from '@ggto/preflop';
import { DEFAULT_FORMAT } from './adapters.js';
import { UnsupportedFormatError, runImport, type FileResult } from './run.js';

const USAGE =
  'usage: node tools/chart-import/dist/main.js --db <file> [--format ggto-json] [--dry-run] [--replace] [--strict] [--aliases <aliases.json>] <file.json|dir>...';

function human(r: FileResult): string {
  if (r.ok) {
    const warn = r.warnings === undefined || r.warnings.length === 0 ? '' : `  (${String(r.warnings.length)} warning(s))`;
    if (r.skipped === true) return `SKIP  ${r.file}  (same content_hash as chart set #${String(r.id)})${warn}`;
    if (r.id === undefined) return `OK    ${r.file}  ${String(r.nodes)} node(s), dry run${warn}`;
    return `OK    ${r.file}  -> set #${String(r.id)}, ${String(r.nodes)} node(s)${r.replaced === true ? ', replaced' : ''}${warn}`;
  }
  const lines = (r.errors ?? []).map((e) => `        ${e.path}: ${e.reason}`);
  return [`FAIL  ${r.file}`, ...lines].join('\n');
}

let parsed;
try {
  parsed = parseArgs({
    options: {
      db: { type: 'string' },
      format: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      replace: { type: 'boolean', default: false },
      strict: { type: 'boolean', default: false },
      aliases: { type: 'string' },
    },
    allowPositionals: true,
  });
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  console.error(USAGE);
  process.exit(2);
}

const { values, positionals } = parsed;
const dryRun = values['dry-run'] === true;

if (positionals.length === 0) {
  console.error('no input files');
  console.error(USAGE);
  process.exit(2);
}
if (!dryRun && (values.db === undefined || values.db.length === 0)) {
  console.error('--db is required (or use --dry-run)');
  console.error(USAGE);
  process.exit(2);
}

const db = values.db === undefined ? '' : resolve(values.db);
if (!dryRun) mkdirSync(dirname(db), { recursive: true });

try {
  const { results, failed, retired } = runImport(positionals, {
    db,
    format: values.format ?? DEFAULT_FORMAT,
    dryRun,
    replace: values.replace === true,
    strict: values.strict === true,
    ...(values.aliases === undefined ? {} : { aliases: values.aliases }),
  });
  for (const r of results) {
    console.log(JSON.stringify(r));
    console.log(human(r));
  }
  // 은퇴는 차트만 지운다. 트레이너 기록은 `npm run trainer:migrate` 가 옮긴다 (D16·D35).
  for (const r of retired) console.log(`RETIRED ${r.from.slice(0, 8)} -> ${r.to.slice(0, 8)}`);
  process.exit(failed > 0 ? 1 : 0);
} catch (e) {
  if (e instanceof UnsupportedFormatError || e instanceof AliasFileError) {
    console.error(e.message);
    process.exit(2);
  }
  throw e;
}
