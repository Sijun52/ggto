/**
 * 169x169 클래스 대 클래스 프리플랍 에퀴티 표 (카드 제거 반영). P2.md 7.1.
 *
 * 이 표는 **생성기 전용 입력**이다. 앱 런타임의 어떤 경로도 169 인덱스로 계산하지 않는다
 * (D4). 생성기가 169 로 푸는 것이 정확한 이유는 프리플랍 HU 에서 슈트 순열이 게임의
 * 자기동형이라 같은 클래스의 콤보들이 전략적으로 동치이기 때문이고, 결과는 곧바로
 * 1326 으로 전개돼 저장된다.
 */

import { readFileSync } from 'node:fs';
import { CLASS_KEYS, sha256Hex } from '@ggto/preflop';

export const EQUITY_FORMAT = 'ggto-equity169';
export const EQUITY_VERSION = 1;
/**
 * 파일에 적히는 소수 자릿수. MC 표준오차(~0.0015)보다 3자리 아래라 정보 손실이 없었고,
 * exact 모드에서도 반올림 오차 ≤ 5e-7 로 P3.md 10.0 의 대조 허용치(1e-6) 안이다.
 */
export const EQUITY_DECIMALS = 6;

export type EquityMode = 'exact' | 'monte-carlo';

export interface EquityMeta {
  /** exact 모드에는 표본이 없다 (P3.md 10.0) */
  samples: number | null;
  /** exact 모드에는 난수가 없다 */
  seedRule: string | null;
  coreVersion: string;
  mode: EquityMode;
  /** 대각선(같은 클래스끼리)은 대칭성으로 정확히 0.5 다 — 계산하지 않는다 */
  diagonal: string;
  generatedAt: string;
  /** sha256(payloadJson) */
  sha256: string;
}

export interface EquityTable {
  format: string;
  version: number;
  meta: EquityMeta;
  classes: string[];
  /** equity[i][j] = 클래스 i 의 에퀴티 vs 클래스 j. equity[i][j] + equity[j][i] === 1 */
  equity: number[][];
}

export function roundEquity(x: number): number {
  const f = 10 ** EQUITY_DECIMALS;
  return Math.round(x * f) / f;
}

/** 해시 대상 = 실제 데이터만 (meta 는 제외 — 생성 시각이 들어가면 해시가 매번 바뀐다) */
export function equityPayload(classes: readonly string[], equity: readonly (readonly number[])[]): string {
  return JSON.stringify({ classes, equity });
}

export function equitySha256(table: EquityTable): string {
  return sha256Hex(equityPayload(table.classes, table.equity));
}

export class EquityTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EquityTableError';
  }
}

/** 파일을 읽고 형식·클래스 순서·대칭성·해시를 전부 확인한다. 하나라도 어긋나면 throw. */
export function loadEquityTable(path: string): EquityTable {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as EquityTable;
  if (raw.format !== EQUITY_FORMAT || raw.version !== EQUITY_VERSION) {
    throw new EquityTableError(`${path}: unexpected format ${String(raw.format)} v${String(raw.version)}`);
  }
  if (raw.meta.mode !== 'exact' && raw.meta.mode !== 'monte-carlo') {
    throw new EquityTableError(`${path}: unknown mode ${JSON.stringify(raw.meta.mode)}`);
  }
  // exact 표에 samples 가 남아 있으면 둘 중 하나는 거짓말이다 (어느 쪽인지 알 수 없으므로 거부).
  if ((raw.meta.mode === 'exact') !== (raw.meta.samples === null)) {
    throw new EquityTableError(
      `${path}: mode ${raw.meta.mode} disagrees with samples ${JSON.stringify(raw.meta.samples)}`,
    );
  }
  if (raw.classes.length !== CLASS_KEYS.length) {
    throw new EquityTableError(`${path}: expected ${String(CLASS_KEYS.length)} classes, got ${String(raw.classes.length)}`);
  }
  for (let i = 0; i < CLASS_KEYS.length; i++) {
    if (raw.classes[i] !== CLASS_KEYS[i]) {
      throw new EquityTableError(
        `${path}: class order differs from @ggto/core at index ${String(i)}: ${String(raw.classes[i])} != ${String(CLASS_KEYS[i])}`,
      );
    }
  }
  const n = CLASS_KEYS.length;
  for (let i = 0; i < n; i++) {
    const row = raw.equity[i];
    if (row === undefined || row.length !== n) {
      throw new EquityTableError(`${path}: equity row ${String(i)} has wrong length`);
    }
    for (let j = 0; j < n; j++) {
      const v = row[j] as number;
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        throw new EquityTableError(`${path}: equity[${String(i)}][${String(j)}] = ${String(v)} is not in [0,1]`);
      }
      const mirror = (raw.equity[j] as number[])[i] as number;
      if (Math.abs(v + mirror - 1) > 1e-9) {
        throw new EquityTableError(
          `${path}: equity[${String(i)}][${String(j)}] + equity[${String(j)}][${String(i)}] = ${String(v + mirror)}, expected 1`,
        );
      }
    }
  }
  const hash = equitySha256(raw);
  if (hash !== raw.meta.sha256) {
    throw new EquityTableError(`${path}: sha256 mismatch (file says ${raw.meta.sha256}, computed ${hash})`);
  }
  return raw;
}

/** 쌍에서 결정적으로 시드를 만든다 (FNV-1a 32bit). 같은 쌍은 언제 어디서 돌려도 같은 값. */
export function pairSeed(a: string, b: string): number {
  let h = 0x811c9dc5;
  const s = `${a}|${b}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const SEED_RULE = 'fnv1a32("<classA>|<classB>"), A = row class, B = column class, i < j only';
