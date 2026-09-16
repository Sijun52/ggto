/**
 * 테스트가 공유하는 표 로딩.
 *
 * **3-way 표(`data/equity169-3way.bin`)는 생성에 수 시간이 걸린다** (D32). 표가 아직 없는
 * 작업 트리에서는 n>=3 게이트를 `describe.skipIf(!hasEquity3)` 로 건너뛴다 — 가짜 표로
 * 대신 돌리지 않는다 (그러면 게이트가 아무것도 재지 않는다). 건너뛴 사실은 vitest 출력에
 * 그대로 남는다.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEquityTable, type EquityTable } from '../src/equityTable.js';
import { loadEquity3, type Equity3 } from '../src/equity3.js';
import { buildTables, type NmaxTables } from '../src/tables.js';

const dataDir = resolve(import.meta.dirname, '../data');
export const EQUITY_PATH = resolve(dataDir, 'equity169.json');
export const EQUITY3_BIN_PATH = resolve(dataDir, 'equity169-3way.bin');
export const EQUITY3_META_PATH = resolve(dataDir, 'equity169-3way.json');

export const hasEquity3 = existsSync(EQUITY3_BIN_PATH) && existsSync(EQUITY3_META_PATH);

let equityCache: EquityTable | null = null;
export function equity(): EquityTable {
  equityCache ??= loadEquityTable(EQUITY_PATH);
  return equityCache;
}

let equity3Cache: Equity3 | null = null;
export function equity3(): Equity3 {
  if (!hasEquity3) throw new Error(`3-way equity table is missing: ${EQUITY3_BIN_PATH}`);
  equity3Cache ??= loadEquity3(EQUITY3_BIN_PATH, EQUITY3_META_PATH);
  return equity3Cache;
}

let twoWayTables: NmaxTables | null = null;
/** 2-max 전용 표 (3-way 없이). n>=3 솔브는 `MissingEquity3Error` 로 막힌다. */
export function tables2(): NmaxTables {
  twoWayTables ??= buildTables(equity(), null);
  return twoWayTables;
}

let fullTables: NmaxTables | null = null;
export function tablesFull(): NmaxTables {
  fullTables ??= buildTables(equity(), equity3());
  return fullTables;
}
