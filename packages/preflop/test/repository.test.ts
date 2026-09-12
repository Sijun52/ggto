import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zstdDecompressSync } from 'node:zlib';
import { handClassCombos, parseHandClass } from '@ggto/core';
import { describe, expect, it } from 'vitest';
import {
  ChartValidationError,
  MissingNodeError,
  UnknownPositionError,
  contentHash,
  formatGgtoJson,
  openRepository,
  parseGgtoJson,
  toGgtoJson,
  type ChartRepository,
} from '../src/index.js';
import { doc1326, doc169, withPatch } from './helpers.js';

function fresh(): ChartRepository {
  return openRepository(':memory:');
}

describe('4.3 importSet / getSet', () => {
  it('4.3 임포트하면 메타가 상태 기계 값과 함께 저장된다', () => {
    const repo = fresh();
    const doc = doc169();
    const res = repo.importSet(doc);
    expect(res).toEqual({ id: 1, nodes: 2, skipped: false });

    const set = repo.getSet(1);
    expect(set).not.toBeNull();
    expect(set?.name).toBe('fixture HU 10bb');
    expect(set?.resolution).toBe('169');
    expect(set?.hasEv).toBe(true);
    expect(set?.evBasis).toBe('stack_delta_from_node');
    expect(set?.contentHash).toBe(contentHash(doc));
    expect(set?.config).toEqual(doc.config);
    expect(set?.source).toEqual(doc.source);

    const nodes = repo.listNodes(1);
    expect(nodes.map((n) => n.seq)).toEqual(['', 'A']);
    expect(nodes[0]).toMatchObject({ heroPos: 'SB', potBb: 1.5, actions: ['F', 'A'], hasEv: true });
    expect(nodes[1]).toMatchObject({ heroPos: 'BB', potBb: 11, actions: ['F', 'C'] });
    repo.close();
  });

  it('4.3 같은 문서를 두 번 넣으면 두 번째는 skipped 이고 행 수가 그대로다', () => {
    const repo = fresh();
    expect(repo.importSet(doc169()).skipped).toBe(false);
    const second = repo.importSet(doc169());
    expect(second).toEqual({ id: 1, nodes: 2, skipped: true });
    expect(repo.listSets()).toHaveLength(1);
    expect(repo.listNodes(1)).toHaveLength(2);
    repo.close();
  });

  it('4.3 삭제 후 재삽입(--replace 경로): 새 id, 노드 수 동일, 캐스케이드 삭제', () => {
    const repo = fresh();
    const a = repo.importSet(doc169({ name: 'a' }));
    const b = repo.importSet(doc169({ name: 'b' }));
    repo.deleteSet(a.id);
    expect(repo.listSets().map((s) => s.id)).toEqual([b.id]);
    // ON DELETE CASCADE 로 노드도 사라졌다
    expect(repo.listNodes(a.id)).toHaveLength(0);

    const again = repo.importSet(doc169({ name: 'a' }));
    expect(again.id).not.toBe(a.id);
    expect(again.id).toBe(3);
    expect(again.nodes).toBe(a.nodes);
    repo.close();
  });

  it('4.3 id 는 AUTOINCREMENT 가 아니다 — 마지막 행을 지우면 id 가 재사용된다', () => {
    // 스키마 4.1 의 `id INTEGER PRIMARY KEY` 는 max(rowid)+1 을 쓴다. "--replace 하면 항상
    // id 가 바뀐다" 는 일반적으로 참이 아니고, 지운 행이 마지막일 때는 같은 id 가 다시 나온다.
    // 외부에 id 를 영구 식별자로 쓰는 곳이 생기면(P3 트레이너 기록) 이 성질을 기억해야 한다.
    const repo = fresh();
    const first = repo.importSet(doc169({ name: 'only' }));
    repo.deleteSet(first.id);
    const again = repo.importSet(doc169({ name: 'another' }));
    expect(again.id).toBe(first.id);
    repo.close();
  });

  it('4.3 원자성: 노드 하나가 불량이면 아무것도 들어가지 않는다', () => {
    const repo = fresh();
    const bad = parseGgtoJson(
      withPatch(doc169(), (d) => {
        const node1 = (d['nodes'] as Record<string, unknown>[])[1] as Record<string, unknown>;
        (node1['strategy'] as Record<string, number[]>)['AA'] = [0.3, 0.3];
      }),
    );
    expect(() => repo.importSet(bad)).toThrow(ChartValidationError);
    expect(repo.listSets()).toEqual([]);
    repo.close();
  });

  it('4.3 opts.source 가 generated 인데 문서가 아니라고 하면 거부한다', () => {
    const repo = fresh();
    const doc = doc1326(); // source.kind = manual
    expect(() => repo.importSet(doc, { source: 'generated' })).toThrow(ChartValidationError);
    expect(repo.listSets()).toEqual([]);
    repo.close();
  });
});

describe('3.2 169 전개', () => {
  it('3.2 169 문서는 클래스의 모든 콤보가 같은 행을 갖고 resolution 이 169 로 남는다', () => {
    const repo = fresh();
    repo.importSet(doc169());
    const node = repo.getNode(1, '');
    expect(node).not.toBeNull();
    expect(repo.getSet(1)?.resolution).toBe('169');
    for (const name of ['AA', 'AKs', 'AKo', '72o']) {
      const combos = handClassCombos(parseHandClass(name));
      const values = combos.map((c) => (node?.strategy[1] as Float32Array)[c]);
      expect(new Set(values).size).toBe(1);
    }
    // 전개 후에도 각 콤보의 행 합은 1 이다
    const foldRow = node?.strategy[0] as Float32Array;
    const jamRow = node?.strategy[1] as Float32Array;
    for (let c = 0; c < 1326; c++) {
      expect((foldRow[c] as number) + (jamRow[c] as number)).toBeCloseTo(1, 6);
    }
    repo.close();
  });

  it('3.2 1326 문서는 같은 클래스 안에서도 콤보별로 다른 값을 유지한다', () => {
    const repo = fresh();
    repo.importSet(doc1326());
    const node = repo.getNode(1, '');
    const combos = handClassCombos(parseHandClass('AA'));
    const values = combos.map((c) => (node?.strategy[1] as Float32Array)[c]);
    expect(new Set(values).size).toBe(2); // 홀짝으로 갈린다
    repo.close();
  });
});

describe('6.4 왕복 (importSet → getNode → toGgtoJson → formatGgtoJson)', () => {
  it('6.4 169 문서 왕복이 정규화 문자열과 바이트 동일', () => {
    const repo = fresh();
    const doc = doc169();
    repo.importSet(doc);
    const set = repo.getSet(1);
    const nodes = repo.listNodes(1).map((n) => repo.getNode(1, n.seq));
    const round = toGgtoJson(set!, nodes.map((n) => n!));
    expect(formatGgtoJson(round)).toBe(formatGgtoJson(doc));
    repo.close();
  });

  it('6.4 1326 문서 왕복도 바이트 동일', () => {
    const repo = fresh();
    const doc = doc1326();
    repo.importSet(doc);
    const set = repo.getSet(1);
    const nodes = repo.listNodes(1).map((n) => repo.getNode(1, n.seq)!);
    expect(formatGgtoJson(toGgtoJson(set!, nodes))).toBe(formatGgtoJson(doc));
    repo.close();
  });
});

describe('3.4 도달 레인지', () => {
  it('3.4 루트의 reach 는 전부 1, 히어로가 아닌 포지션은 곱해지지 않는다', () => {
    const repo = fresh();
    repo.importSet(doc169());
    const root = repo.reach(1, '', 'SB');
    expect(root.length).toBe(1326);
    expect([...root].every((x) => x === 1)).toBe(true);
    // BB 는 루트에서 행동하지 않았으므로 "A" 노드에서도 100%
    expect([...repo.reach(1, 'A', 'BB')].every((x) => x === 1)).toBe(true);
    repo.close();
  });

  it('3.4 reach(id,"A","SB") 는 루트 SB 전략의 A 열과 같다', () => {
    const repo = fresh();
    repo.importSet(doc169());
    const jam = repo.getNode(1, '')?.strategy[1] as Float32Array;
    expect([...repo.reach(1, 'A', 'SB')]).toEqual([...jam]);
    // 폴드 쪽도 질의 가능하다 (뷰어가 "folded" 로 표시할 뿐)
    const fold = repo.getNode(1, '')?.strategy[0] as Float32Array;
    expect([...repo.reach(1, 'F', 'SB')]).toEqual([...fold]);
    repo.close();
  });

  it('3.4 reach(id,"A-C","BB") 는 BB 의 C 열이고 SB 쪽은 A 열 그대로다', () => {
    const repo = fresh();
    repo.importSet(doc169());
    const bbCall = repo.getNode(1, 'A')?.strategy[1] as Float32Array;
    const sbJam = repo.getNode(1, '')?.strategy[1] as Float32Array;
    expect([...repo.reach(1, 'A-C', 'BB')]).toEqual([...bbCall]);
    expect([...repo.reach(1, 'A-C', 'SB')]).toEqual([...sbJam]);
    repo.close();
  });

  it('3.4 경로에 없는 노드는 MissingNodeError (undefined 가 아니다)', () => {
    const repo = fresh();
    repo.importSet(doc169());
    expect(() => repo.reach(1, 'A-R3', 'SB')).toThrow(MissingNodeError);
    try {
      repo.reach(1, 'A-R3', 'SB');
    } catch (e) {
      expect((e as MissingNodeError).seq).toBe('A-R3');
    }
    repo.close();
  });

  it('3.4 config 에 없는 포지션은 UnknownPositionError', () => {
    const repo = fresh();
    repo.importSet(doc169());
    expect(() => repo.reach(1, '', 'BTN')).toThrow(UnknownPositionError);
    repo.close();
  });
});

describe('3.2 블롭 (코덱 우회 검증)', () => {
  it('3.2 파일 DB 의 strategy 컬럼을 raw sqlite 로 SELECT 해 직접 풀면 getNode 와 원소가 같다', () => {
    // 우리 decodeRows 를 쓰지 않고 zstd → DataView 로 직접 읽는다. 저장 형식이
    // "f32 LE, row-major, zstd" 라는 주장을 코덱 밖에서 확인하는 유일한 방법이다.
    const dir = mkdtempSync(join(tmpdir(), 'ggto-blob-'));
    const dbPath = join(dir, 'test.db');
    try {
      const repo = openRepository(dbPath);
      repo.importSet(doc169());
      const node = repo.getNode(1, '');
      repo.close();

      const db = new DatabaseSync(dbPath);
      const row = db.prepare('SELECT strategy FROM pf_node WHERE action_seq = ?').get('') as {
        strategy: Uint8Array;
      };
      db.close();

      const raw = zstdDecompressSync(row.strategy);
      expect(raw.byteLength).toBe(2 * 1326 * 4);
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      for (let c = 0; c < 1326; c++) {
        expect(view.getFloat32(c * 4, true)).toBe((node?.strategy[0] as Float32Array)[c]);
        expect(view.getFloat32((1326 + c) * 4, true)).toBe((node?.strategy[1] as Float32Array)[c]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('3.2 STRICT 테이블이 타입을 강제한다 (TEXT 를 BLOB 컬럼에 넣으면 거부)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ggto-strict-'));
    const dbPath = join(dir, 'test.db');
    try {
      const repo = openRepository(dbPath);
      repo.importSet(doc169());
      repo.close();
      const db = new DatabaseSync(dbPath);
      expect(() =>
        db.prepare('UPDATE pf_node SET strategy = ? WHERE action_seq = ?').run('not a blob', ''),
      ).toThrow();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
