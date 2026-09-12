/**
 * 시드 가능한 PRNG (xoshiro128**, splitmix32 시딩). P0.md 4.5.
 * Math.random 은 쓰지 않는다. 같은 seed → 같은 수열.
 */

export interface Rng {
  /** 0..2^32-1 */
  nextUint32(): number;
  /** [0,1) */
  nextFloat(): number;
  /** [0, bound) 정수. bound >= 1 */
  nextInt(bound: number): number;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return function next(): number {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return t >>> 0;
  };
}

class Xoshiro128SS implements Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    if (!Number.isFinite(seed)) throw new TypeError(`rng seed must be a finite number: ${String(seed)}`);
    const sm = splitmix32(Math.trunc(seed) | 0);
    this.s0 = sm();
    this.s1 = sm();
    this.s2 = sm();
    this.s3 = sm();
    // 전 상태가 0이면 xoshiro 는 0에 갇힌다.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 0x9e3779b9;
  }

  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  nextInt(bound: number): number {
    if (!Number.isInteger(bound) || bound < 1) {
      throw new RangeError(`nextInt bound must be a positive integer: ${String(bound)}`);
    }
    // Lemire 의 곱셈 축소. 2^32 가 bound 의 배수가 아니면 미세한 편향이 남지만
    // bound <= 52 / <= 1326 범위에서 편향은 1e-8 미만이라 몬테카를로에 영향이 없다.
    return Math.floor((this.nextUint32() * bound) / 4294967296);
  }
}

export function createRng(seed: number): Rng {
  return new Xoshiro128SS(seed);
}
