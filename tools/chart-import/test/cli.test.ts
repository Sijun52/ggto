/**
 * CLI 를 진짜 자식 프로세스로 돌린다 (P2.md 6.4 마지막 항목).
 * 인프로세스 호출만 테스트하면 dist 진입점·인자 파싱·종료 코드가 깨져도 통과한다.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { contentHash, openRepository, type GgtoJson } from '@ggto/preflop';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { miniDoc } from './fixture.js';

const MAIN = resolve(import.meta.dirname, '../dist/main.js');
let dir = '';

function write(name: string, doc: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(doc), 'utf8');
  return path;
}

function broken(mutate: (d: Record<string, unknown>) => void): GgtoJson {
  const d = JSON.parse(JSON.stringify(miniDoc())) as Record<string, unknown>;
  mutate(d);
  return d as unknown as GgtoJson;
}

interface Ran {
  status: number;
  lines: string[];
  json: Record<string, unknown>[];
  stderr: string;
}

function run(args: string[]): Ran {
  const r = spawnSync(process.execPath, [MAIN, ...args], { encoding: 'utf8' });
  const lines = r.stdout.split('\n').filter((l) => l.length > 0);
  return {
    status: r.status ?? -1,
    lines,
    json: lines.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as Record<string, unknown>),
    stderr: r.stderr,
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ggto-cli-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('6.1 CLI', () => {
  it('6.1 --dry-run 정상 파일: exit 0, 파일당 JSON 한 줄, DB 를 만들지 않는다', () => {
    const file = write('ok.json', miniDoc());
    const r = run(['--dry-run', file]);
    expect(r.status).toBe(0);
    expect(r.json).toHaveLength(1);
    expect(r.json[0]).toMatchObject({ file, ok: true, nodes: 2 });
    // JSON 줄 + 사람용 줄
    expect(r.lines).toHaveLength(2);
    expect(r.lines[1]).toMatch(/^OK {4}/);
  });

  it('6.1 --dry-run 불량 파일: exit 1 + 결함 전부를 errors 배열로 찍는다', () => {
    const file = write(
      'bad.json',
      broken((d) => {
        const nodes = d['nodes'] as Record<string, unknown>[];
        ((nodes[0] as Record<string, unknown>)['strategy'] as Record<string, number[]>)['AKs'] = [0.98, 0];
        delete ((nodes[1] as Record<string, unknown>)['strategy'] as Record<string, number[]>)['72o'];
      }),
    );
    const r = run(['--dry-run', file]);
    expect(r.status).toBe(1);
    const errors = r.json[0]?.['errors'] as { path: string; reason: string }[];
    expect(r.json[0]?.['ok']).toBe(false);
    expect(errors.map((e) => e.path)).toEqual(['nodes[0].strategy.AKs', 'nodes[1].strategy.72o']);
    expect(r.lines.some((l) => l.includes('row sums to 0.98'))).toBe(true);
  });

  it('6.1 --format 이 지원되지 않으면 exit 2', () => {
    const file = write('ok2.json', miniDoc());
    const r = run(['--dry-run', '--format', 'piosolver-csv', file]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unsupported format/);
  });

  it('6.1 입력이 없으면 exit 2 (사용법)', () => {
    expect(run(['--dry-run']).status).toBe(2);
  });

  it('6.1 파일 단위 원자성: 불량 파일 하나가 다른 파일 임포트를 막지 않는다', () => {
    const good = write('good1.json', miniDoc('atomic good'));
    const bad = write(
      'bad1.json',
      broken((d) => {
        d['name'] = 'atomic bad';
        (d['nodes'] as Record<string, unknown>[]).splice(0, 1); // 루트 삭제
      }),
    );
    const db = join(dir, 'atomic.db');
    const r = run(['--db', db, bad, good]);
    expect(r.status).toBe(1);
    expect(r.json[0]).toMatchObject({ ok: false });
    expect(r.json[1]).toMatchObject({ ok: true, nodes: 2 });

    const repo = openRepository(db);
    try {
      expect(repo.listSets().map((s) => s.name)).toEqual(['atomic good']);
    } finally {
      repo.close();
    }
  });

  it('6.1 실제 임포트 → 두 번째 실행은 skipped, --replace 는 새 행을 만든다', () => {
    const a = write('set-a.json', miniDoc('dup a'));
    const b = write('set-b.json', miniDoc('dup b'));
    const db = join(dir, 'dup.db');

    const first = run(['--db', db, a, b]);
    expect(first.status).toBe(0);
    expect(first.json.map((j) => j['skipped'])).toEqual([false, false]);

    const second = run(['--db', db, a, b]);
    expect(second.status).toBe(0);
    expect(second.json.map((j) => j['skipped'])).toEqual([true, true]);

    const replaced = run(['--db', db, '--replace', a]);
    expect(replaced.status).toBe(0);
    expect(replaced.json[0]).toMatchObject({ ok: true, skipped: false, replaced: true });
    // 이름이 같은 기존 셋이 지워지고 새로 들어갔다 — 셋 수는 그대로 2
    const repo = openRepository(db);
    try {
      const sets = repo.listSets();
      expect(sets).toHaveLength(2);
      expect(sets.map((s) => s.name).sort()).toEqual(['dup a', 'dup b']);
      const newId = (replaced.json[0]?.['id'] as number);
      expect(newId).toBe(3); // 1 을 지우고 max(rowid)+1 = 3
      expect(repo.listNodes(newId)).toHaveLength(2);
    } finally {
      repo.close();
    }
  });

  it('6.1 디렉터리를 주면 그 안의 *.json 을 이름순으로 읽는다 (npm run seed 경로)', () => {
    const sub = mkdtempSync(join(tmpdir(), 'ggto-dir-'));
    try {
      writeFileSync(join(sub, 'b.json'), JSON.stringify(miniDoc('dir b')), 'utf8');
      writeFileSync(join(sub, 'a.json'), JSON.stringify(miniDoc('dir a')), 'utf8');
      writeFileSync(join(sub, 'note.txt'), 'ignored', 'utf8');
      const r = run(['--db', join(dir, 'dir.db'), sub]);
      expect(r.status).toBe(0);
      expect(r.json.map((j) => String(j['file']))).toEqual([join(sub, 'a.json'), join(sub, 'b.json')]);
    } finally {
      rmSync(sub, { recursive: true, force: true });
    }
  });

  it('6.1 트리 폐쇄성 경고는 통과시키고 --strict 면 실패시킨다', () => {
    const file = write(
      'open-tree.json',
      broken((d) => {
        d['name'] = 'open tree';
        (d['nodes'] as unknown[]).splice(1, 1); // "A" 자식 노드 삭제
      }),
    );
    const ok = run(['--dry-run', file]);
    expect(ok.status).toBe(0);
    expect((ok.json[0]?.['warnings'] as unknown[]).length).toBe(1);
    const strict = run(['--dry-run', '--strict', file]);
    expect(strict.status).toBe(1);
  });
});

describe('7.1 --aliases (은퇴)', () => {
  const alias = (from: string, to: string): unknown => ({
    format: 'ggto-aliases',
    version: 1,
    aliases: [{ from, to, reason: 'P7: same model and stack, regenerated as mtt 2-max' }],
  });

  it('7.1 to 와 from 이 둘 다 DB 에 있으면 from 셋이 은퇴한다 (RETIRED 한 줄)', () => {
    const oldFile = write('retire-old.json', miniDoc('retire old'));
    const newFile = write('retire-new.json', miniDoc('retire new'));
    const db = join(dir, 'retire.db');
    const first = run(['--db', db, oldFile]);
    expect(first.status).toBe(0);
    const oldHash = contentHash(miniDoc('retire old'));
    const newHash = contentHash(miniDoc('retire new'));
    const aliasPath = write('aliases.json', alias(oldHash, newHash));

    const r = run(['--db', db, '--aliases', aliasPath, newFile]);
    expect(r.status).toBe(0);
    expect(r.lines).toContain(`RETIRED ${oldHash.slice(0, 8)} -> ${newHash.slice(0, 8)}`);
    const repo = openRepository(db);
    try {
      expect(repo.listSets().map((s) => s.name)).toEqual(['retire new']);
    } finally {
      repo.close();
    }
    // 두 번째 실행: 새 파일은 skipped, 은퇴할 것이 없으므로 RETIRED 줄도 없다
    const again = run(['--db', db, '--aliases', aliasPath, newFile]);
    expect(again.status).toBe(0);
    expect(again.json[0]?.['skipped']).toBe(true);
    expect(again.lines.some((l) => l.startsWith('RETIRED'))).toBe(false);
  });

  it('7.1 새 차트가 아직 없으면 옛 차트를 지우지 않는다 (사용자가 차트를 잃지 않는다)', () => {
    const oldFile = write('keep-old.json', miniDoc('keep old'));
    const db = join(dir, 'keep.db');
    run(['--db', db, oldFile]);
    const aliasPath = write('aliases-missing.json', alias(contentHash(miniDoc('keep old')), contentHash(miniDoc('never imported'))));
    const r = run(['--db', db, '--aliases', aliasPath, oldFile]);
    expect(r.status).toBe(0);
    expect(r.lines.some((l) => l.startsWith('RETIRED'))).toBe(false);
    const repo = openRepository(db);
    try {
      expect(repo.listSets().map((s) => s.name)).toEqual(['keep old']);
    } finally {
      repo.close();
    }
  });

  it('7.1 디렉터리 임포트는 aliases.json 을 차트로 읽지 않는다', () => {
    const sub = mkdtempSync(join(tmpdir(), 'ggto-alias-dir-'));
    try {
      writeFileSync(join(sub, 'a.json'), JSON.stringify(miniDoc('alias dir a')), 'utf8');
      writeFileSync(join(sub, 'aliases.json'), JSON.stringify(alias('a'.repeat(64), 'b'.repeat(64))), 'utf8');
      const r = run(['--db', join(dir, 'alias-dir.db'), sub]);
      expect(r.status).toBe(0);
      expect(r.json).toHaveLength(1);
    } finally {
      rmSync(sub, { recursive: true, force: true });
    }
  });

  it('7.1 별칭 파일이 망가졌으면 exit 2 (반쯤 읽고 은퇴시키지 않는다)', () => {
    const db = join(dir, 'bad-alias.db');
    const file = write('alias-ok.json', miniDoc('alias ok'));
    const badPath = join(dir, 'aliases-bad.json');
    writeFileSync(badPath, JSON.stringify({ format: 'ggto-aliases', version: 1, aliases: [{ from: 'short', to: 'b'.repeat(64), reason: 'x' }] }), 'utf8');
    const r = run(['--db', db, '--aliases', badPath, file]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/64 lowercase hex/);
  });
});
