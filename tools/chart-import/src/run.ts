/**
 * 임포터 본체 (CLI 는 이걸 부르기만 한다). P2.md 6.1.
 *
 * **파일 단위 원자성**: 한 파일이 실패해도 다른 파일 임포트는 진행된다. 파일 하나의
 * 임포트는 `importSet` 안의 단일 트랜잭션이라 중간까지 들어가는 일이 없다.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ChartValidationError,
  openRepository,
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

export function runImport(inputs: readonly string[], opts: ImportOptions): { results: FileResult[]; failed: number } {
  const adapter = adapterFor(opts.format);
  if (adapter === null) throw new UnsupportedFormatError(opts.format);

  const files = expandInputs(inputs);
  const results: FileResult[] = [];
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
  } finally {
    repo?.close();
  }
  return { results, failed: results.filter((r) => !r.ok).length };
}
