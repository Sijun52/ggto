/**
 * 은퇴한 차트의 기록 이전 (P7.md 7.2, D35). `npm run trainer:migrate` 가 부르는 절차다.
 *
 * 순서가 중요하다:
 *   1. 스키마를 v2 로 올리고 WAL 을 본체에 합친다 (`checkpoint`) — 백업이 **한 파일로**
 *      완전해진다. WAL 을 두고 `trainer.db` 만 복사하면 최근 답이 빠진 백업이 된다.
 *   2. 파일 복사 백업. 되돌리기는 "이 파일을 되돌려 놓으면 된다" 가 전부여야 한다.
 *   3. 단일 트랜잭션으로 별칭 적용 (`TrainerStore.applyAliases`).
 *
 * 서버가 떠 있는 채로 돌리지 않는다 (2번과 3번 사이에 답이 들어오면 그 답은 백업에 없다).
 */

import { copyFileSync, existsSync } from 'node:fs';
import type { ChartAlias } from '@ggto/preflop';
import { TrainerStore, type AliasApplyResult } from './store.js';

export interface AliasMigrationReport {
  dbPath: string;
  backupPath: string | null;
  results: AliasApplyResult[];
}

export interface ApplyAliasesOptions {
  dbPath: string;
  aliases: readonly ChartAlias[];
  /** `applied_at` 에 적을 시각 (테스트가 고정한다) */
  now: number;
  /** 기본 true. false 는 테스트 전용 (테스트는 이미 복사본 위에서 돈다) */
  backup?: boolean;
}

/**
 * 백업 파일 이름. 스펙은 `trainer.db.bak-<ISO시각>` 이지만 **ISO 문자열의 `:` 는 Windows
 * 파일 이름에 못 쓴다** (D13 과 같은 부류의 사고). `:` 와 `.` 를 `-` 로 바꾼다.
 */
export function backupPathFor(dbPath: string, now: number): string {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  return `${dbPath}.bak-${stamp}`;
}

export function applyAliases(opts: ApplyAliasesOptions): AliasMigrationReport {
  if (!existsSync(opts.dbPath)) throw new Error(`trainer database not found: ${opts.dbPath}`);

  const prep = new TrainerStore(opts.dbPath);
  try {
    prep.checkpoint();
  } finally {
    prep.close();
  }

  let backupPath: string | null = null;
  if (opts.backup !== false) {
    backupPath = backupPathFor(opts.dbPath, opts.now);
    copyFileSync(opts.dbPath, backupPath);
  }

  const store = new TrainerStore(opts.dbPath);
  try {
    return { dbPath: opts.dbPath, backupPath, results: store.applyAliases(opts.aliases, opts.now) };
  } finally {
    store.close();
  }
}
