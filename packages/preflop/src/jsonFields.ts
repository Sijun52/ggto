/**
 * ggto-json 의 **값 파서** (config / ante / rake / source). P2.md 5.1 구조 검증의 절반.
 *
 * 문서 골격(최상위 필드·nodes 배열)은 `jsonShape.ts` 가 본다. 여기 있는 것은 "한 필드의
 * 모양" 이고, 도메인 판정(상태 기계·키 완전성·행 합)은 `validate.ts` 가 한다.
 */

import type { GgtoJson } from './types.js';
import { isRecord, typeName, type Collector } from './jsonCollector.js';

export const SOURCE_KEYS = ['kind', 'name', 'version', 'url', 'params', 'note', 'license'] as const;
export const CONFIG_KEYS = ['positions', 'blinds', 'ante', 'stack'] as const;
export const SOURCE_KINDS = ['generated', 'solver', 'manual', 'file'] as const;

export function parseAnte(c: Collector, v: unknown): GgtoJson['config']['ante'] | null {
  if (!isRecord(v)) {
    c.add('config.ante', `expected object, got ${typeName(v)}`);
    return null;
  }
  const mode = v['mode'];
  if (mode === 'none') {
    c.unknownKeys('config.ante', v, ['mode']);
    return { mode: 'none' };
  }
  if (mode === 'per_player' || mode === 'bb_ante') {
    c.unknownKeys('config.ante', v, ['mode', 'amount']);
    const amount = c.num('config.ante.amount', v['amount']);
    if (amount === null) return null;
    return { mode, amount };
  }
  c.add('config.ante.mode', `expected "none" | "per_player" | "bb_ante", got ${JSON.stringify(mode)}`);
  return null;
}

export function parseConfig(c: Collector, v: unknown): GgtoJson['config'] | null {
  if (!isRecord(v)) {
    c.add('config', `expected object, got ${typeName(v)}`);
    return null;
  }
  c.unknownKeys('config', v, CONFIG_KEYS);
  let ok = true;
  const positions: string[] = [];
  const rawPositions: unknown = v['positions'];
  if (!Array.isArray(rawPositions)) {
    c.add('config.positions', `expected array, got ${typeName(rawPositions)}`);
    ok = false;
  } else {
    rawPositions.forEach((p: unknown, i: number) => {
      const s = c.str(`config.positions[${String(i)}]`, p, { nonEmpty: true });
      if (s === null) ok = false;
      else positions.push(s);
    });
  }
  const blinds: { pos: string; amount: number }[] = [];
  const rawBlinds: unknown = v['blinds'];
  if (!Array.isArray(rawBlinds)) {
    c.add('config.blinds', `expected array, got ${typeName(rawBlinds)}`);
    ok = false;
  } else {
    rawBlinds.forEach((b: unknown, i: number) => {
      const p = `config.blinds[${String(i)}]`;
      if (!isRecord(b)) {
        c.add(p, `expected object, got ${typeName(b)}`);
        ok = false;
        return;
      }
      c.unknownKeys(p, b, ['pos', 'amount']);
      const pos = c.str(`${p}.pos`, b['pos'], { nonEmpty: true });
      const amount = c.num(`${p}.amount`, b['amount']);
      if (pos === null || amount === null) ok = false;
      else blinds.push({ pos, amount });
    });
  }
  const ante = parseAnte(c, v['ante']);
  if (ante === null) ok = false;
  const stack = c.num('config.stack', v['stack']);
  if (stack === null) ok = false;
  if (!ok || ante === null || stack === null) return null;
  return { positions, blinds, ante, stack };
}

export function parseRake(c: Collector, v: unknown): GgtoJson['rake'] | null {
  if (!isRecord(v)) {
    c.add('rake', `expected object, got ${typeName(v)}`);
    return null;
  }
  if (v['mode'] === 'none') {
    c.unknownKeys('rake', v, ['mode']);
    return { mode: 'none' };
  }
  if (v['mode'] === 'pot') {
    c.unknownKeys('rake', v, ['mode', 'pct', 'capBb', 'noFlopNoDrop']);
    const pct = c.num('rake.pct', v['pct']);
    const capBb = c.num('rake.capBb', v['capBb']);
    const nfnd = v['noFlopNoDrop'];
    if (typeof nfnd !== 'boolean') c.add('rake.noFlopNoDrop', `expected boolean, got ${typeName(nfnd)}`);
    if (pct === null || capBb === null || typeof nfnd !== 'boolean') return null;
    if (pct < 0 || pct > 1) c.add('rake.pct', `must be in [0,1], got ${String(pct)}`);
    if (capBb < 0) c.add('rake.capBb', `must be >= 0, got ${String(capBb)}`);
    return { mode: 'pot', pct, capBb, noFlopNoDrop: nfnd };
  }
  c.add('rake.mode', `expected "none" | "pot", got ${JSON.stringify(v['mode'])}`);
  return null;
}

export function parseSource(c: Collector, v: unknown): GgtoJson['source'] | null {
  if (!isRecord(v)) {
    c.add('source', `expected object, got ${typeName(v)}`);
    return null;
  }
  c.unknownKeys('source', v, SOURCE_KEYS);
  const kind = v['kind'];
  if (typeof kind !== 'string' || !(SOURCE_KINDS as readonly string[]).includes(kind)) {
    c.add('source.kind', `expected one of ${SOURCE_KINDS.join('|')}, got ${JSON.stringify(kind)}`);
  }
  // source.name 은 "이 데이터가 어디서 왔는가" 의 유일한 기록이다 (DECISIONS D15).
  const name = c.str('source.name', v['name'], { nonEmpty: true });
  const out: GgtoJson['source'] = {
    kind: (typeof kind === 'string' ? kind : 'file') as GgtoJson['source']['kind'],
    name: name ?? '',
  };
  for (const k of ['version', 'url', 'note', 'license'] as const) {
    if (v[k] === undefined) continue;
    const s = c.str(`source.${k}`, v[k]);
    if (s !== null) out[k] = s;
  }
  if (v['params'] !== undefined) {
    const params: unknown = v['params'];
    if (!isRecord(params)) c.add('source.params', `expected object, got ${typeName(params)}`);
    else out.params = params;
  }
  // 5.2: 남이 배포한 파일/솔버 출력은 url 이나 version 중 하나는 있어야 추적이 된다.
  if ((kind === 'file' || kind === 'solver') && out.url === undefined && out.version === undefined) {
    c.add('source', `kind "${String(kind)}" requires "url" or "version"`);
  }
  return name === null ? null : out;
}
