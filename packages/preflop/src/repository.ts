/**
 * `node:sqlite` 기반 ChartRepository. P2.md 4.3.
 *
 * SQL 은 이 파일 밖으로 나가지 않는다 (서버는 인터페이스만 본다 — 2절 grep 게이트).
 * `node:sqlite` 는 실험적 API 라 stderr 에 ExperimentalWarning 한 줄이 찍힌다.
 * `--no-warnings` 로 끄지 않는다 (다른 경고까지 숨긴다, P2.md 1절).
 */

import { DatabaseSync } from 'node:sqlite';
import { decodeRow, decodeRows, encodeRows } from './blob.js';
import { contentHash } from './codec.js';
import { migrate } from './schema.js';
import {
  ChartValidationError,
  MissingNodeError,
  UnknownPositionError,
  type ChartRepository,
  type ChartSetMeta,
  type ChartSource,
  type GameType,
  type GgtoJson,
  type ImportResult,
  type NodeData,
  type NodeMeta,
  type Rake,
  type Resolution,
} from './types.js';
import { childSeq, validateChart } from './validate.js';
import { parseActionSequence, type PreflopConfig } from '@ggto/core';

const COMBO_COUNT = 1326;

interface SetRow {
  id: number;
  name: string;
  game_type: string;
  positions: string;
  blinds: string;
  ante: string;
  stack_bb: number;
  rake: string;
  resolution: string;
  has_ev: number;
  ev_basis: string;
  source: string;
  format_version: number;
  content_hash: string;
  imported_at: number;
}

interface NodeRow {
  action_seq: string;
  hero_pos: string;
  pot_bb: number;
  actions: string;
  strategy: Uint8Array;
  ev: Uint8Array | null;
}

function toMeta(row: SetRow): ChartSetMeta {
  const config: PreflopConfig = {
    positions: JSON.parse(row.positions) as string[],
    blinds: JSON.parse(row.blinds) as { pos: string; amount: number }[],
    ante: JSON.parse(row.ante) as PreflopConfig['ante'],
    stack: row.stack_bb,
  };
  return {
    id: row.id,
    name: row.name,
    gameType: row.game_type as GameType,
    config,
    rake: JSON.parse(row.rake) as Rake,
    resolution: row.resolution as Resolution,
    hasEv: row.has_ev === 1,
    evBasis: row.ev_basis as ChartSetMeta['evBasis'],
    source: JSON.parse(row.source) as ChartSource,
    formatVersion: row.format_version,
    contentHash: row.content_hash,
    importedAt: row.imported_at,
  };
}

/** seq 문자열 → 정규 토큰 목록. 문법 오류는 core 의 ActionSyntaxError 가 그대로 나간다. */
function tokens(seq: string): string[] {
  if (seq === '') return [];
  parseActionSequence(seq); // 문법·정규형 검증 (여기서 던지면 API 는 400)
  return seq.split('-');
}

class SqliteChartRepository implements ChartRepository {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    // WAL 은 파일 DB 에서만 의미가 있다 (:memory: 는 'memory' 를 돌려주고 무시된다).
    if (path !== ':memory:') this.#db.exec('PRAGMA journal_mode = WAL');
    // ON DELETE CASCADE 가 동작하려면 연결마다 켜야 한다.
    this.#db.exec('PRAGMA foreign_keys = ON');
    migrate(this.#db);
  }

  listSets(): ChartSetMeta[] {
    const rows = this.#db.prepare('SELECT * FROM chart_set ORDER BY id').all() as unknown as SetRow[];
    return rows.map(toMeta);
  }

  getSet(id: number): ChartSetMeta | null {
    const row = this.#db.prepare('SELECT * FROM chart_set WHERE id = ?').get(id) as unknown as
      | SetRow
      | undefined;
    return row === undefined ? null : toMeta(row);
  }

  listNodes(setId: number): NodeMeta[] {
    const rows = this.#db
      .prepare(
        'SELECT action_seq, hero_pos, pot_bb, actions, (ev IS NOT NULL) AS has_ev ' +
          'FROM pf_node WHERE chart_set_id = ? ORDER BY length(action_seq), action_seq',
      )
      .all(setId) as unknown as (Omit<NodeRow, 'strategy' | 'ev'> & { has_ev: number })[];
    return rows.map((r) => ({
      seq: r.action_seq,
      heroPos: r.hero_pos,
      potBb: r.pot_bb,
      actions: JSON.parse(r.actions) as string[],
      hasEv: r.has_ev === 1,
    }));
  }

  getNode(setId: number, seq: string): NodeData | null {
    const row = this.#db
      .prepare(
        'SELECT action_seq, hero_pos, pot_bb, actions, strategy, ev FROM pf_node ' +
          'WHERE chart_set_id = ? AND action_seq = ?',
      )
      .get(setId, seq) as unknown as NodeRow | undefined;
    if (row === undefined) return null;
    const actions = JSON.parse(row.actions) as string[];
    return {
      seq: row.action_seq,
      heroPos: row.hero_pos,
      potBb: row.pot_bb,
      actions,
      hasEv: row.ev !== null,
      strategy: decodeRows(row.strategy, actions.length),
      ev: row.ev === null ? null : decodeRows(row.ev, actions.length),
    };
  }

  reach(setId: number, seq: string, pos: string): Float32Array {
    // 메타 전체(JSON 5개 파싱)를 읽지 않는다 — 필요한 것은 포지션 목록 하나다.
    const row = this.#db.prepare('SELECT positions FROM chart_set WHERE id = ?').get(setId) as
      | { positions: string }
      | undefined;
    if (row === undefined) throw new MissingNodeError(seq);
    const positions = JSON.parse(row.positions) as string[];
    if (!positions.includes(pos)) throw new UnknownPositionError(pos, positions);

    const weights = new Float32Array(COMBO_COUNT).fill(1);
    let prefix = '';
    for (const token of tokens(seq)) {
      const node = this.#db
        .prepare('SELECT hero_pos, actions, strategy FROM pf_node WHERE chart_set_id = ? AND action_seq = ?')
        .get(setId, prefix) as { hero_pos: string; actions: string; strategy: Uint8Array } | undefined;
      if (node === undefined) throw new MissingNodeError(prefix);
      const actions = JSON.parse(node.actions) as string[];
      const a = actions.indexOf(token);
      // 차트가 그 액션을 담고 있지 않으면 그 아래 노드도 있을 수 없다.
      if (a < 0) throw new MissingNodeError(childSeq(prefix, token));
      if (node.hero_pos === pos) {
        // 필요한 것은 액션 한 열뿐이다 (행 전부를 Float32Array 로 만들지 않는다).
        const col = decodeRow(node.strategy, actions.length, a);
        for (let c = 0; c < COMBO_COUNT; c++) weights[c] = (weights[c] as number) * (col[c] as number);
      }
      prefix = childSeq(prefix, token);
    }
    return weights;
  }

  importSet(doc: GgtoJson, opts: { source?: 'file' | 'generated' } = {}): ImportResult {
    // 생성기가 자기 출력을 잘못 라벨링하는 것을 막는다 (D15: source 가 유일한 출처 기록).
    if (opts.source === 'generated' && doc.source.kind !== 'generated') {
      throw new ChartValidationError([
        { path: 'source.kind', reason: `caller says the document was generated, but source.kind is ${JSON.stringify(doc.source.kind)}` },
      ]);
    }
    const validated = validateChart(doc);
    const hash = contentHash(doc);

    const existing = this.#db.prepare('SELECT id FROM chart_set WHERE content_hash = ?').get(hash) as
      | { id: number }
      | undefined;
    if (existing !== undefined) {
      const count = this.#db
        .prepare('SELECT COUNT(*) AS n FROM pf_node WHERE chart_set_id = ?')
        .get(existing.id) as { n: number };
      return { id: existing.id, nodes: count.n, skipped: true };
    }

    this.#db.exec('BEGIN');
    try {
      const info = this.#db
        .prepare(
          'INSERT INTO chart_set (name, game_type, positions, blinds, ante, stack_bb, rake, resolution, ' +
            'has_ev, ev_basis, source, format_version, content_hash, imported_at) ' +
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          doc.name,
          doc.gameType,
          JSON.stringify(doc.config.positions),
          JSON.stringify(doc.config.blinds),
          JSON.stringify(doc.config.ante),
          doc.config.stack,
          JSON.stringify(doc.rake),
          doc.resolution,
          validated.hasEv ? 1 : 0,
          doc.evBasis,
          JSON.stringify(doc.source),
          doc.version,
          hash,
          Date.now(),
        );
      const setId = Number(info.lastInsertRowid);
      const insertNode = this.#db.prepare(
        'INSERT INTO pf_node (chart_set_id, action_seq, hero_pos, pot_bb, actions, strategy, ev) ' +
          'VALUES (?,?,?,?,?,?,?)',
      );
      for (const n of validated.nodes) {
        insertNode.run(
          setId,
          n.seq,
          n.heroPos,
          n.potBb,
          JSON.stringify(n.actions),
          encodeRows(n.strategy),
          n.ev === null ? null : encodeRows(n.ev),
        );
      }
      this.#db.exec('COMMIT');
      return { id: setId, nodes: validated.nodes.length, skipped: false };
    } catch (e) {
      this.#db.exec('ROLLBACK');
      throw e;
    }
  }

  deleteSet(id: number): void {
    this.#db.prepare('DELETE FROM chart_set WHERE id = ?').run(id);
  }

  close(): void {
    this.#db.close();
  }
}

export function openRepository(path: string | ':memory:'): ChartRepository {
  return new SqliteChartRepository(path);
}
