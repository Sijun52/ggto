/**
 * ggto-json **문서 골격** 검증 (P2.md 6.2-1). **첫 오류에서 멈추지 않는다.**
 *
 * 여기서는 최상위 필드와 `nodes` 배열의 모양만 본다. 한 필드의 값 파서(config/rake/source)는
 * `jsonFields.ts`, 수집기는 `jsonCollector.ts` 에 있다. 도메인 판정(상태 기계·키 완전성·
 * 행 합·EV 기준점)은 `validate.ts` 가 한다 — 그쪽은 모양이 맞다는 전제 위에서만 동작할 수
 * 있기 때문이다.
 */

import {
  ChartValidationError,
  GGTO_JSON_FORMAT,
  GGTO_JSON_VERSION,
  type GgtoJson,
  type GgtoJsonNode,
} from './types.js';
import { Collector, isRecord, typeName } from './jsonCollector.js';
import { parseConfig, parseRake, parseSource } from './jsonFields.js';

const TOP_KEYS = [
  'format',
  'version',
  'name',
  'gameType',
  'config',
  'rake',
  'resolution',
  'evBasis',
  'source',
  'nodes',
] as const;

const GAME_TYPES = ['cash', 'mtt', 'sng'] as const;

function parseRows(c: Collector, path: string, v: unknown): Record<string, number[]> | null {
  if (!isRecord(v)) {
    c.add(path, `expected object, got ${typeName(v)}`);
    return null;
  }
  const out: Record<string, number[]> = {};
  let ok = true;
  for (const [k, row] of Object.entries(v)) {
    if (!Array.isArray(row)) {
      c.add(`${path}.${k}`, `expected number[], got ${typeName(row)}`);
      ok = false;
      continue;
    }
    const nums: number[] = [];
    for (let i = 0; i < row.length; i++) {
      const x: unknown = row[i];
      if (typeof x !== 'number' || !Number.isFinite(x)) {
        c.add(`${path}.${k}[${String(i)}]`, `expected a finite number, got ${typeName(x)}`);
        ok = false;
      } else nums.push(x);
    }
    out[k] = nums;
  }
  return ok ? out : null;
}

function parseNode(c: Collector, index: number, v: unknown): GgtoJsonNode | null {
  const path = `nodes[${String(index)}]`;
  if (!isRecord(v)) {
    c.add(path, `expected object, got ${typeName(v)}`);
    return null;
  }
  c.unknownKeys(path, v, ['seq', 'actions', 'strategy', 'ev']);
  const seq = typeof v['seq'] === 'string' ? v['seq'] : null;
  if (seq === null) c.add(`${path}.seq`, `expected string, got ${typeName(v['seq'])}`);
  const actions: string[] = [];
  const rawActions: unknown = v['actions'];
  if (!Array.isArray(rawActions)) {
    c.add(`${path}.actions`, `expected string[], got ${typeName(rawActions)}`);
  } else {
    rawActions.forEach((a: unknown, i: number) => {
      const s = c.str(`${path}.actions[${String(i)}]`, a, { nonEmpty: true });
      if (s !== null) actions.push(s);
    });
    if (rawActions.length === 0) c.add(`${path}.actions`, 'must have at least one action');
  }
  const strategy = parseRows(c, `${path}.strategy`, v['strategy']);
  let ev: Record<string, number[]> | undefined;
  if (v['ev'] !== undefined) {
    const parsed = parseRows(c, `${path}.ev`, v['ev']);
    if (parsed !== null) ev = parsed;
  }
  if (seq === null || strategy === null) return null;
  const node: GgtoJsonNode = { seq, actions, strategy };
  if (ev !== undefined) node.ev = ev;
  return node;
}

/**
 * 텍스트 → 문서. 구조 결함은 전부 모아 `ChartValidationError` 로 던진다.
 * 도메인 검증은 하지 않는다 (validate.ts).
 */
export function parseGgtoJson(text: string): GgtoJson {
  const c = new Collector();
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (e) {
    // JSON 문법 오류는 다른 결함을 볼 수조차 없으므로 여기서 끝난다.
    throw new ChartValidationError([
      { path: '$', reason: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` },
    ]);
  }
  if (!isRecord(raw)) {
    throw new ChartValidationError([{ path: '$', reason: `expected a JSON object, got ${typeName(raw)}` }]);
  }
  c.unknownKeys('$', raw, TOP_KEYS);
  if (raw['format'] !== GGTO_JSON_FORMAT) {
    c.add('format', `expected ${JSON.stringify(GGTO_JSON_FORMAT)}, got ${JSON.stringify(raw['format'])}`);
  }
  const version = raw['version'];
  if (version !== GGTO_JSON_VERSION) {
    c.add(
      'version',
      `unsupported version ${JSON.stringify(version)} (this build reads ${String(GGTO_JSON_VERSION)})`,
    );
  }
  const name = c.str('name', raw['name'], { nonEmpty: true });
  const gameType = raw['gameType'];
  if (typeof gameType !== 'string' || !(GAME_TYPES as readonly string[]).includes(gameType)) {
    c.add('gameType', `expected one of ${GAME_TYPES.join('|')}, got ${JSON.stringify(gameType)}`);
  }
  const config = parseConfig(c, raw['config']);
  const rake = parseRake(c, raw['rake']);
  const resolution = raw['resolution'];
  if (resolution !== '169' && resolution !== '1326') {
    c.add('resolution', `expected "169" | "1326", got ${JSON.stringify(resolution)}`);
  }
  const evBasis = raw['evBasis'];
  if (evBasis !== 'none' && evBasis !== 'stack_delta_from_node') {
    c.add('evBasis', `expected "none" | "stack_delta_from_node", got ${JSON.stringify(evBasis)}`);
  }
  const source = parseSource(c, raw['source']);
  const nodes: GgtoJsonNode[] = [];
  const rawNodes: unknown = raw['nodes'];
  if (!Array.isArray(rawNodes)) {
    c.add('nodes', `expected array, got ${typeName(rawNodes)}`);
  } else {
    if (rawNodes.length === 0) c.add('nodes', 'must have at least one node (the root "")');
    rawNodes.forEach((n: unknown, i: number) => {
      const parsed = parseNode(c, i, n);
      if (parsed !== null) nodes.push(parsed);
    });
  }

  if (c.issues.length > 0) throw new ChartValidationError(c.issues);
  // issues 가 비었다 = 위의 null 분기가 하나도 안 걸렸다. 따라서 아래 값들은 전부 non-null.
  return {
    format: GGTO_JSON_FORMAT,
    version: GGTO_JSON_VERSION,
    name: name as string,
    gameType: gameType as GgtoJson['gameType'],
    config: config as GgtoJson['config'],
    rake: rake as GgtoJson['rake'],
    resolution: resolution as GgtoJson['resolution'],
    evBasis: evBasis as GgtoJson['evBasis'],
    source: source as GgtoJson['source'],
    nodes,
  };
}
