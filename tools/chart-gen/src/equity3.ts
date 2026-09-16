/**
 * 3-way 클래스 에퀴티 표 (P7.md 3절). 파일: `data/equity169-3way.bin` + `.json`.
 *
 * 왜 몬테카를로인가 (D32): 클래스 3중집합은 C(171,3) = 818,805 개이고 전수 계산은
 * 트리플당 3~8초(대표 고정 · (b,c) 궤도 · C(46,5) 전수)라 ≈ 1,100 코어시간이다.
 * S = 100,000 MC 의 지분 표준오차는 √(p(1−p)/S) ≤ 0.16%p 이고, 3-way 노드 EV 에
 * 미치는 잡음은 ≤ 0.02bb (P3 Perfect 임계 0.05bb 의 절반 이하)다.
 *
 * 2-way 는 여전히 전수 표(`equity169.json`)를 쓴다 — 이 파일은 3-way 쇼다운 전용이다.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CLASS_KEYS } from '@ggto/preflop';
import { fnv1a32 } from './equityTable.js';

export const EQUITY3_FORMAT = 'ggto-equity169-3way';
export const EQUITY3_VERSION = 1;
export const CLASS_COUNT = CLASS_KEYS.length;
/** C(171,3) — 서로 다를 필요가 없는 클래스 3중집합의 수 */
export const TRIPLE_COUNT = 818_805;
/** u16 LE 4개: [w3, share_i, share_j, share_k] */
export const RECORD_BYTES = 8;
export const U16_SCALE = 65_535;
/** i=j=k 의 대칭 지분. 3·21845 = 65535 이라 합 검사도 정확히 통과한다 */
export const THIRD_U16 = 21_845;
/** Σ_{ordered (i,j,k)} w3 = 1326·1225·1128 */
export const ORDERED_W3_TOTAL = 1_832_455_600;
/** 클래스당 콤보는 최대 12개 → w3 ≤ 12³ */
export const MAX_W3 = 1728;
export const EQUITY3_SEED_RULE = 'fnv1a32("<classI>|<classJ>|<classK>"), i <= j <= k in CLASS_KEYS order';
export const EQUITY3_ENCODING = 'u16le x4 [w3, share_i, share_j, share_k], multiset colex index';

export class Equity3Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Equity3Error';
  }
}

/**
 * 3중집합 colex 인덱스 `C(i,1) + C(j+1,2) + C(k+2,3)` (i ≤ j ≤ k).
 * 0..818,804 위로의 전단사다 (test/equity3.test.ts 가 고정한다).
 */
export function multisetIndex(i: number, j: number, k: number): number {
  if (!(i <= j && j <= k)) throw new Equity3Error(`multisetIndex needs i <= j <= k, got ${String(i)},${String(j)},${String(k)}`);
  return i + ((j + 1) * j) / 2 + ((k + 2) * (k + 1) * k) / 6;
}

/** 세 클래스를 오름차순으로 정렬하고 원래 자리로 되돌릴 순열도 준다. */
export function sortTriple(a: number, b: number, c: number): [number, number, number] {
  const t = [a, b, c].sort((x, y) => x - y);
  return [t[0] as number, t[1] as number, t[2] as number];
}

export function tripleSeed(i: number, j: number, k: number): number {
  return fnv1a32(`${String(CLASS_KEYS[i])}|${String(CLASS_KEYS[j])}|${String(CLASS_KEYS[k])}`);
}

/** 3중집합 인덱스 → (i,j,k). 생성기가 샤드를 펴는 데 쓴다. */
export function allTriples(): Int16Array {
  const out = new Int16Array(TRIPLE_COUNT * 3);
  let n = 0;
  for (let k = 0; k < CLASS_COUNT; k++) {
    for (let j = 0; j <= k; j++) {
      for (let i = 0; i <= j; i++) {
        const idx = multisetIndex(i, j, k) * 3;
        out[idx] = i;
        out[idx + 1] = j;
        out[idx + 2] = k;
        n++;
      }
    }
  }
  if (n !== TRIPLE_COUNT) throw new Equity3Error(`enumerated ${String(n)} triples, expected ${String(TRIPLE_COUNT)}`);
  return out;
}

export interface Equity3Meta {
  format: string;
  version: number;
  samples: number;
  seedRule: string;
  samplerVersion: number;
  coreVersion: string;
  tripleCount: number;
  encoding: string;
  /** bin 바이트의 sha256 */
  sha256: string;
  elapsedSec: number;
  workers: number;
}

export interface Equity3 {
  meta: Equity3Meta;
  /** 169³. share[h·169² + y·169 + c] = eq3(h; y, c). 세 값의 합은 정확히 1 */
  share: Float32Array;
  /** 169³. w3[h·169² + y·169 + c] = 서로 겹치지 않는 (h,y,c) 콤보 순서 3쌍 수 */
  w3: Float32Array;
}

const N = CLASS_COUNT;
const N2 = N * N;

/**
 * 파일을 읽고 형식·크기·불변식·해시를 전부 확인한 뒤 169³ 텐서로 편다 (P7.md 3.3).
 * 하나라도 어긋나면 throw — 조용히 근사 표를 쓰지 않는다.
 */
export function loadEquity3(binPath: string, metaPath: string): Equity3 {
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Equity3Meta;
  if (meta.format !== EQUITY3_FORMAT || meta.version !== EQUITY3_VERSION) {
    throw new Equity3Error(`${metaPath}: unexpected format ${String(meta.format)} v${String(meta.version)}`);
  }
  if (meta.tripleCount !== TRIPLE_COUNT) {
    throw new Equity3Error(`${metaPath}: tripleCount ${String(meta.tripleCount)} != ${String(TRIPLE_COUNT)}`);
  }
  const bytes = readFileSync(binPath);
  if (bytes.length !== TRIPLE_COUNT * RECORD_BYTES) {
    throw new Equity3Error(
      `${binPath}: size ${String(bytes.length)} != ${String(TRIPLE_COUNT * RECORD_BYTES)} (${String(TRIPLE_COUNT)} records x ${String(RECORD_BYTES)}B)`,
    );
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== meta.sha256) {
    throw new Equity3Error(`${binPath}: sha256 mismatch (meta says ${meta.sha256}, computed ${sha256})`);
  }

  // Buffer 는 풀에서 나오면 byteOffset 이 2의 배수가 아닐 수 있다 — 그 경우 Uint16Array 뷰가
  // RangeError 를 던진다. 6.5MB 는 풀 밖이라 실제로는 0 이지만 계약으로 두지 않는다.
  const raw =
    bytes.byteOffset % 2 === 0
      ? new Uint16Array(bytes.buffer, bytes.byteOffset, TRIPLE_COUNT * 4)
      : new Uint16Array(new Uint8Array(bytes).buffer, 0, TRIPLE_COUNT * 4);
  const share = new Float32Array(N * N2);
  const w3 = new Float32Array(N * N2);
  const triples = allTriples();
  let orderedW3 = 0;

  for (let t = 0; t < TRIPLE_COUNT; t++) {
    const i = triples[t * 3] as number;
    const j = triples[t * 3 + 1] as number;
    const k = triples[t * 3 + 2] as number;
    const w = raw[t * 4] as number;
    const a = raw[t * 4 + 1] as number;
    const b = raw[t * 4 + 2] as number;
    const c = raw[t * 4 + 3] as number;
    if (Math.abs(a + b + c - U16_SCALE) > 2) {
      throw new Equity3Error(`${binPath}: record ${String(t)} shares sum to ${String(a + b + c)}, expected ${String(U16_SCALE)} +-2`);
    }
    if (w > MAX_W3) throw new Equity3Error(`${binPath}: record ${String(t)} w3 = ${String(w)} > ${String(MAX_W3)}`);
    // 같은 클래스는 정의상 같은 지분이다 — 파일이 이를 깨면 대칭화 단계가 빠진 표다.
    if ((i === j && a !== b) || (j === k && b !== c)) {
      throw new Equity3Error(
        `${binPath}: record ${String(t)} (classes ${String(i)},${String(j)},${String(k)}) has asymmetric shares ${String(a)},${String(b)},${String(c)}`,
      );
    }
    // 합으로 나눠 세 지분의 합을 정확히 1 로 만든다 (양자화 잔차 제거).
    const sum = a + b + c;
    const sa = a / sum;
    const sb = b / sum;
    const sc = c / sum;
    // 다중도: 서로 다른 순서쌍마다 같은 레코드를 복사한다 (6 / 3 / 1).
    const perms: [number, number, number][] =
      i === j && j === k
        ? [[0, 1, 2]]
        : i === j
          ? [
              [0, 1, 2],
              [0, 2, 1],
              [2, 0, 1],
            ]
          : j === k
            ? [
                [0, 1, 2],
                [1, 0, 2],
                [1, 2, 0],
              ]
            : [
                [0, 1, 2],
                [0, 2, 1],
                [1, 0, 2],
                [1, 2, 0],
                [2, 0, 1],
                [2, 1, 0],
              ];
    const cls = [i, j, k];
    const sh = [sa, sb, sc];
    for (const p of perms) {
      const x = cls[p[0]] as number;
      const y = cls[p[1]] as number;
      const z = cls[p[2]] as number;
      const off = x * N2 + y * N + z;
      share[off] = sh[p[0]] as number;
      w3[off] = w;
      orderedW3 += w;
    }
  }
  if (orderedW3 !== ORDERED_W3_TOTAL) {
    throw new Equity3Error(`${binPath}: ordered w3 total ${String(orderedW3)} != ${String(ORDERED_W3_TOTAL)}`);
  }
  return { meta, share, w3 };
}
