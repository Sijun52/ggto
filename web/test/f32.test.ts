/**
 * P5.md 1.5 / 8.1 — base64 f32 디코드 (D7).
 *
 * 기댓값은 구현이 아니라 **IEEE-754 비트 패턴**에서 온다: `0`·`1`·`−1.5`·`3.4e38` 의
 * little-endian 바이트를 손으로 적어 base64 로 만든다. 디코더를 베끼면 이 값이 안 나온다.
 */

import { describe, expect, it } from 'vitest';
import { COMBO_COUNT } from '@ggto/core';
import { decodeF32Row, decodeF32Rows, F32DecodeError } from '../src/lib/f32';

/** 알려진 f32 비트 (little-endian) */
const KNOWN: [number, number[]][] = [
  [0, [0x00, 0x00, 0x00, 0x00]],
  [1, [0x00, 0x00, 0x80, 0x3f]],
  [-1.5, [0x00, 0x00, 0xc0, 0xbf]],
  // 3.4e38 의 최근접 f32 = 0x7f7fc99e (little-endian 9e c9 7f 7f)
  [3.4e38, [0x9e, 0xc9, 0x7f, 0x7f]],
];

function toB64(bytes: number[]): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function rowBytes(values: (number | undefined)[]): number[] {
  const arr = new Float32Array(COMBO_COUNT);
  values.forEach((v, i) => {
    if (v !== undefined) arr[i] = v;
  });
  return [...new Uint8Array(arr.buffer)];
}

describe('P5 1.5 decodeF32Rows', () => {
  it('P5 1.5 알려진 f32 네 개를 비트 패턴에서 되살린다', () => {
    const bytes = KNOWN.flatMap(([, b]) => b);
    // 1326 f32 한 행을 채우되 앞 네 값만 의미가 있다.
    const padded = [...bytes, ...new Array<number>((COMBO_COUNT - 4) * 4).fill(0)];
    const [row] = decodeF32Rows(toB64(padded), 1);
    expect((row as Float32Array).length).toBe(COMBO_COUNT);
    // 앞 셋은 f32 로 정확히 표현된다 — 비트 패턴 그대로여야 한다.
    expect((row as Float32Array)[0]).toBe(0);
    expect((row as Float32Array)[1]).toBe(1);
    expect((row as Float32Array)[2]).toBe(-1.5);
    // 3.4e38 은 f32 에 정확히 들어가지 않는다 (f64 와 다르다) — 최근접 f32 여야 한다.
    expect((row as Float32Array)[3]).toBe(Math.fround(3.4e38));
    expect(KNOWN.length).toBe(4);
  });

  it('P5 1.5 rows 개로 쪼개고 오프셋이 행마다 1326 씩 간다', () => {
    const a = rowBytes([1]);
    const b = rowBytes([undefined, 2]);
    const c = rowBytes([undefined, undefined, 3]);
    const rows = decodeF32Rows(toB64([...a, ...b, ...c]), 3);
    expect(rows.length).toBe(3);
    expect((rows[0] as Float32Array)[0]).toBe(1);
    expect((rows[1] as Float32Array)[1]).toBe(2);
    expect((rows[2] as Float32Array)[2]).toBe(3);
    // 서로 다른 행이 섞이지 않는다.
    expect((rows[1] as Float32Array)[0]).toBe(0);
  });

  it('P5 1.5 길이가 맞지 않으면 던진다 — 잘린 배열을 그리지 않는다', () => {
    expect(() => decodeF32Rows(toB64([1, 2, 3, 4]), 1)).toThrow(F32DecodeError);
    expect(() => decodeF32Rows(toB64(rowBytes([1])), 2)).toThrow(/expected/);
    expect(() => decodeF32Rows('!!!not base64!!!', 1)).toThrow(F32DecodeError);
  });

  it('P5 1.5 decodeF32Row 는 1326 하나다', () => {
    const row = decodeF32Row(toB64(rowBytes([0.25])));
    expect(row.length).toBe(COMBO_COUNT);
    expect(row[0]).toBe(0.25);
  });
});
