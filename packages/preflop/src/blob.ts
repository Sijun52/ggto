/**
 * 전략/EV 블롭 코덱. P2.md 3.2: f32 LE, row-major [n_actions][1326], zstd.
 *
 * 바이트 순서를 DataView 로 명시한다. `Float32Array` 의 내부 표현은 호스트 엔디언이라
 * 빅엔디언 기계에서 만든 DB 가 리틀엔디언 기계에서 다른 숫자로 읽히는 것을 막는다.
 * (1326×5 = 6,630 원소라 이 명시성의 비용은 무시할 수 있다 — 벤치 10절이 예산을 지킨다.)
 */

import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

export const COMBO_COUNT = 1326;
const BYTES_PER_ROW = COMBO_COUNT * 4;

export function encodeRows(rows: readonly Float32Array[]): Uint8Array {
  const buf = new ArrayBuffer(rows.length * BYTES_PER_ROW);
  const view = new DataView(buf);
  let off = 0;
  for (const row of rows) {
    if (row.length !== COMBO_COUNT) {
      throw new RangeError(`each row must have ${String(COMBO_COUNT)} values, got ${String(row.length)}`);
    }
    for (let i = 0; i < COMBO_COUNT; i++) {
      view.setFloat32(off, row[i] as number, true);
      off += 4;
    }
  }
  const out = zstdCompressSync(new Uint8Array(buf));
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

/**
 * 행 하나만 꺼낸다. 도달 레인지는 노드마다 액션 한 열만 필요해서 나머지 행을 Float32Array 로
 * 만들 이유가 없다 (벤치 10절: reach 깊이 2 x1000). zstd 해제는 어차피 블롭 전체다.
 */
export function decodeRow(blob: Uint8Array, nActions: number, action: number): Float32Array {
  const raw = zstdDecompressSync(blob);
  const expected = nActions * BYTES_PER_ROW;
  if (raw.byteLength !== expected) {
    throw new RangeError(
      `blob decodes to ${String(raw.byteLength)} bytes, expected ${String(expected)}`,
    );
  }
  if (action < 0 || action >= nActions) throw new RangeError(`action index out of range: ${String(action)}`);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const row = new Float32Array(COMBO_COUNT);
  let off = action * BYTES_PER_ROW;
  for (let i = 0; i < COMBO_COUNT; i++) {
    row[i] = view.getFloat32(off, true);
    off += 4;
  }
  return row;
}

export function decodeRows(blob: Uint8Array, nActions: number): Float32Array[] {
  const raw = zstdDecompressSync(blob);
  const expected = nActions * BYTES_PER_ROW;
  if (raw.byteLength !== expected) {
    throw new RangeError(
      `blob decodes to ${String(raw.byteLength)} bytes, expected ${String(expected)} ` +
        `(${String(nActions)} actions x ${String(COMBO_COUNT)} combos x 4)`,
    );
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const rows: Float32Array[] = [];
  let off = 0;
  for (let a = 0; a < nActions; a++) {
    const row = new Float32Array(COMBO_COUNT);
    for (let i = 0; i < COMBO_COUNT; i++) {
      row[i] = view.getFloat32(off, true);
      off += 4;
    }
    rows.push(row);
  }
  return rows;
}
