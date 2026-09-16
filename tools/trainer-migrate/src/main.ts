/**
 * `npm run trainer:migrate` (P7.md 7.2, D35).
 *
 * ```
 * node tools/trainer-migrate/dist/main.js [--db data/trainer.db] [--aliases data/charts/aliases.json] [--dry-run]
 * ```
 *
 * 은퇴한 차트(`aliases.json` 의 `from`)를 참조하는 트레이너 기록을 새 `content_hash` 로
 * 옮긴다. **사용자 데이터를 건드리는 유일한 명령**이다 — `npm run seed` 는 절대 하지
 * 않는다 (D16). 백업 → 단일 트랜잭션 → `hash_alias` 표에 기록, 이 순서다.
 *
 * 종료 코드: 0 성공 / 1 실패 / 2 사용법·포맷 오류.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { AliasFileError, parseAliasFile } from '@ggto/preflop';
import { TrainerStore, applyAliases } from '@ggto/trainer';

const USAGE =
  'usage: node tools/trainer-migrate/dist/main.js [--db data/trainer.db] [--aliases data/charts/aliases.json] [--dry-run]';

let parsed;
try {
  parsed = parseArgs({
    options: {
      db: { type: 'string' },
      aliases: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  console.error(USAGE);
  process.exit(2);
}

const dbPath = resolve(parsed.values.db ?? 'data/trainer.db');
const aliasPath = resolve(parsed.values.aliases ?? 'data/charts/aliases.json');
const dryRun = parsed.values['dry-run'] === true;

if (!existsSync(dbPath)) {
  console.error(`trainer database not found: ${dbPath} (nothing to migrate)`);
  process.exit(2);
}
if (!existsSync(aliasPath)) {
  console.error(`aliases file not found: ${aliasPath} (run "npm run seed" or "npm run gen:charts" first)`);
  process.exit(2);
}

let aliases;
try {
  aliases = parseAliasFile(readFileSync(aliasPath, 'utf8'), aliasPath).aliases;
} catch (e) {
  if (e instanceof AliasFileError) {
    console.error(e.message);
    process.exit(2);
  }
  throw e;
}

if (dryRun) {
  // 몇 행이 대상인지만 센다. 쓰기는 전혀 하지 않는다.
  const store = new TrainerStore(dbPath);
  try {
    const counts = store.attemptHashCounts();
    const applied = new Set(store.listAliases().map((a) => a.from));
    for (const alias of aliases) {
      const n = counts.get(alias.from) ?? 0;
      console.log(
        `${alias.from.slice(0, 8)} -> ${alias.to.slice(0, 8)}  attempt ${String(n)}행` +
          `${applied.has(alias.from) ? '  (이미 적용됨)' : ''}`,
      );
    }
  } finally {
    store.close();
  }
  console.log('dry run: 아무것도 쓰지 않았다');
  process.exit(0);
}

const report = applyAliases({ dbPath, aliases, now: Date.now() });
console.log(`backup: ${report.backupPath ?? '(none)'}`);
let touched = 0;
for (const r of report.results) {
  if (r.alreadyApplied) {
    console.log(`${r.from.slice(0, 8)} -> ${r.to.slice(0, 8)}  (이미 적용됨, 건너뜀)`);
    continue;
  }
  touched += r.attempts + r.srs + r.sessions;
  console.log(
    `${r.from.slice(0, 8)} -> ${r.to.slice(0, 8)}  attempt ${String(r.attempts)}행, ` +
      `srs ${String(r.srs)}행(충돌 ${String(r.srsConflicts)}), session ${String(r.sessions)}행`,
  );
}
console.log(`총 ${String(touched)}행을 옮겼다. 다시 돌리면 전부 0 이다.`);
