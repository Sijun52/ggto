/**
 * base64 f32 → `Float32Array` 뷰 (P5.md 1.5, D7).
 *
 * 노드 하나가 `2 × actions × 1326 × 4B` ≈ 32KB (base64 43KB) 라 디코드가 프레임을 막으면
 * 안 된다. `Buffer` 는 브라우저에 없으므로 `atob` 로 이진 문자열을 받아 한 번만 복사한다.
 *
 * **길이가 맞지 않으면 던진다.** 조용히 잘린 배열로 격자를 그리면 "일부 콤보가 레인지
 * 밖" 처럼 보이는 그럴듯한 거짓 그림이 된다 — 서버가 보낸 것과 다른 것을 그리느니 터진다.
 */

import { COMBO_COUNT } from '@ggto/core';

export class F32DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'F32DecodeError';
  }
}

/** base64 → 바이트. 4바이트 정렬을 보장하기 위해 새 버퍼에 담는다 (`Float32Array` 뷰 조건). */
function bytesOf(b64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(b64);
  } catch (e) {
    throw new F32DecodeError(`not base64: ${e instanceof Error ? e.message : String(e)}`);
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * `rows × 1326` f32 (little-endian) 을 행별 뷰로 쪼갠다. 행은 **같은 버퍼의 뷰**라
 * 추가 복사가 없다.
 */
export function decodeF32Rows(b64: string, rows: number): Float32Array[] {
  if (!Number.isInteger(rows) || rows < 0) throw new F32DecodeError(`rows must be a non-negative integer, got ${String(rows)}`);
  const bytes = bytesOf(b64);
  const need = rows * COMBO_COUNT * 4;
  if (bytes.byteLength !== need) {
    throw new F32DecodeError(
      `expected ${String(need)} bytes for ${String(rows)}x${String(COMBO_COUNT)} f32, got ${String(bytes.byteLength)}`,
    );
  }
  const out: Float32Array[] = [];
  for (let i = 0; i < rows; i++) out.push(new Float32Array(bytes.buffer, i * COMBO_COUNT * 4, COMBO_COUNT));
  return out;
}

/** 1326 하나. `decodeF32Rows(b64, 1)[0]` 의 짧은 이름이다 (reach·equity 용). */
export function decodeF32Row(b64: string): Float32Array {
  return decodeF32Rows(b64, 1)[0] as Float32Array;
}
