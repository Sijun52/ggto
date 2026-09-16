/**
 * 임포터 본체 (CLI 는 이걸 부르기만 한다). P2.md 6.1.
 *
 * **파일 단위 원자성**: 한 파일이 실패해도 다른 파일 임포트는 진행된다. 파일 하나의
 * 임포트는 `importSet` 안의 단일 트랜잭션이라 중간까지 들어가는 일이 없다.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ALIAS_FILE_NAME,
  ChartValidationError,
  openRepository,
  parseAliasFile,
  validateChart,
  type ChartIssue,
  type ChartRepository,
} from '@ggto/preflop';
import { DEFAULT_FORMAT, adapterFor } from './adapters.js';

export interface ImportOptions {
  db: string;
  format: string;
  dryRun: boolean;
  replace: boolean;
  strict: boolean;
  /** `aliases.json` 경로 (P7.md 7.1). 주면 임포트가 **끝난 뒤** 옛 셋을 은퇴시킨다 */
  aliases?: string;
}

/** 은퇴한 차트셋 하나 (`--aliases`) */
export interface RetiredSet {
  from: string;
  to: string;
  /** 지워진 `chart_set.id` */
  id: number;
}

export interface FileResult {
  file: string;
  ok: boolean;
  id?: number;
  nodes?: number;
  skipped?: boolean;
  replaced?: boolean;
  errors?: ChartIssue[];
  warnings?: ChartIssue[];
}

export class UnsupportedFormatError extends Error {
  constructor(format: string) {
    super(`unsupported format ${JSON.stringify(format)} (this build supports: ${DEFAULT_FORMAT})`);
    this.name = 'UnsupportedFormatError';
  }
}

/**
 * 인자를 파일 목록으로 편다. 디렉터리를 주면 그 안의 `*.json` 을 이름순으로 읽는다
 * (`npm run seed` 가 셸 글로브 없이 동작해야 하기 때문 — Windows npm 은 cmd 로 돌아 글로브가 없다).
 */
export function expandInputs(inputs: readonly string[]): string[] {
  const out: string[] = [];
  for (const input of inputs) {
    const path = resolve(input);
    if (statSync(path).isDirectory()) {
      const entries = readdirSync(path)
        .filter((f) => f.toLowerCase().endsWith('.json'))
        // 별칭 파일은 차트가 아니다 (P7.md 7.1). 같은 디렉터리에 있으므로 이름으로 뺀다 —
        // 빼지 않으면 `npm run seed` 가 aliases.json 을 차트로 읽어 FAIL 을 낸다.
        .filter((f) => f !== ALIAS_FILE_NAME)
        .sort();
      for (const f of entries) out.push(join(path, f));
    } else out.push(path);
  }
  return out;
}

function issuesOf(e: unknown): ChartIssue[] | null {
  if (e instanceof ChartValidationError) return [...e.issues];
  return null;
}

/**
 * 별칭 적용 (P7.md 7.1): `to` 가 DB 에 **있고** `from` 도 DB 에 있으면 `from` 셋을 지운다.
 *
 * 두 조건이 다 필요하다 — 새 차트가 아직 안 들어온 DB 에서 옛 차트만 지우면 사용자가
 * 차트를 **잃는다**. `trainer.db` 는 절대 건드리지 않는다 (D16: 기록은 사용자 데이터이고
 * `npm run trainer:migrate` 로만 옮긴다).
 */
function applyAliasFile(repo: ChartRepository, path: string): RetiredSet[] {
  const doc = parseAliasFile(readFileSync(path, 'utf8'), path);
  const byHash = new Map<string, number>();
  for (const set of repo.listSets()) byHash.set(set.contentHash, set.id);
  const out: RetiredSet[] = [];
  for (const alias of doc.aliases) {
    const oldId = byHash.get(alias.from);
    if (oldId === undefined) continue;
    if (!byHash.has(alias.to)) continue;
    repo.deleteSet(oldId);
    out.push({ from: alias.from, to: alias.to, id: oldId });
  }
  return out;
}

export function runImport(inputs: readonly string[], opts: ImportOptions): { results: FileResult[]; failed: number; retired: RetiredSet[] } {
  const adapter = adapterFor(opts.format);
  if (adapter === null) throw new UnsupportedFormatError(opts.format);

  const files = expandInputs(inputs);
  const results: FileResult[] = [];
  let retired: RetiredSet[] = [];
  let repo: ChartRepository | null = null;
  try {
    for (const file of files) {
      try {
        const doc = adapter(new Uint8Array(readFileSync(file)), { file });
        // 검증은 dry-run 과 실제 임포트가 같은 코드를 탄다 (importSet 이 다시 부른다).
        const validated = validateChart(doc, { strict: opts.strict });
        if (opts.dryRun) {
          results.push({ file, ok: true, nodes: validated.nodes.length, warnings: validated.warnings });
          continue;
        }
        repo ??= openRepository(opts.db);
        let replaced = false;
        if (opts.replace) {
          for (const existing of repo.listSets()) {
            if (existing.name === doc.name) {
              repo.deleteSet(existing.id);
              replaced = true;
            }
          }
        }
        const res = repo.importSet(doc, { source: 'file' });
        results.push({
          file,
          ok: true,
          id: res.id,
          nodes: res.nodes,
          skipped: res.skipped,
          replaced,
          warnings: validated.warnings,
        });
      } catch (e) {
        const issues = issuesOf(e);
        results.push({
          file,
          ok: false,
          errors: issues ?? [{ path: '$', reason: e instanceof Error ? e.message : String(e) }],
        });
      }
    }
    if (opts.aliases !== undefined && !opts.dryRun) {
      repo ??= openRepository(opts.db);
      retired = applyAliasFile(repo, resolve(opts.aliases));
    }
  } finally {
    repo?.close();
  }
  return { results, failed: results.filter((r) => !r.ok).length, retired };
}
