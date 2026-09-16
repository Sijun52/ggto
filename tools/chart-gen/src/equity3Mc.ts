/**
 * 3-way 클래스 지분의 몬테카를로 추정 (P7.md 3.2). 표 생성기 · 벤치 · 테스트가 공유한다.
 *
 * CLI(`genEquity3.ts`)에서 분리한 이유: 3.4 의 게이트가 "트리플 3개를 인프로세스로
 * 재계산해 파일 레코드와 일치" 를 요구하는데, 최상위 코드가 도는 CLI 모듈은 테스트가
 * import 할 수 없다.
 *
 * 예산은 단일 워커 1.5M 샘플/s 이상 (3.5) = 샘플당 667ns. 그래서 두 곳을 직접 든다:
 *   - **난수**: `createRng().nextInt()` 는 호출당 39ns 실측이고 샘플마다 9~11번 불린다
 *     (= 예산의 60%). 같은 xoshiro128** 수열을 배치로 만들어 배열에서 읽는다.
 *     **수열은 `@ggto/core` 의 `createRng` 와 한 값도 다르지 않다** — `rngParity()` 가
 *     그 사실을 검사하고 `equity3.test.ts` 가 게이트로 고정한다.
 *   - **평가**: `evaluateMasks` 를 직접 부른다. `evaluate7` 은 샘플마다 7원소 배열을
 *     만들고 중복 검사를 돌려 예산을 못 맞춘다.
 */

import { comboCards, createRng, handClassCombos } from '@ggto/core';
import { evaluateMasks } from '@ggto/core/internal';
import { CLASS_COUNT, THIRD_U16, U16_SCALE, tripleSeed } from './equity3.js';

/** 샘플러 규약 버전. 뽑는 순서·거절 규칙이 바뀌면 올린다 (표를 다시 만들어야 한다). */
export const SAMPLER_VERSION = 1;

/** 난수 배치 크기. 거절 샘플링 때문에 소비량이 가변이라 남는 것은 버리지 않고 이어 쓴다. */
const POOL_SIZE = 4096;

/** 클래스별 콤보의 (hi, lo) 카드. [2*c] = hi, [2*c+1] = lo */
const CLASS_CARDS: readonly Uint8Array[] = Array.from({ length: CLASS_COUNT }, (_unused, h) => {
  const combos = handClassCombos(h);
  const out = new Uint8Array(combos.length * 2);
  for (let c = 0; c < combos.length; c++) {
    const [hi, lo] = comboCards(combos[c] as number);
    out[c * 2] = hi;
    out[c * 2 + 1] = lo;
  }
  return out;
});

export function classCards(h: number): Uint8Array {
  const t = CLASS_CARDS[h];
  if (t === undefined) throw new RangeError(`hand class out of range: ${String(h)}`);
  return t;
}

/** 서로 겹치지 않는 (i,j,k) 콤보 순서 3쌍 수. 클래스당 콤보는 최대 12개라 최대 1728 회 */
export function countW3(i: number, j: number, k: number): number {
  const a = classCards(i);
  const b = classCards(j);
  const c = classCards(k);
  let n = 0;
  for (let x = 0; x < a.length; x += 2) {
    const a1 = a[x] as number;
    const a2 = a[x + 1] as number;
    for (let y = 0; y < b.length; y += 2) {
      const b1 = b[y] as number;
      const b2 = b[y + 1] as number;
      if (b1 === a1 || b1 === a2 || b2 === a1 || b2 === a2) continue;
      for (let z = 0; z < c.length; z += 2) {
        const c1 = c[z] as number;
        const c2 = c[z + 1] as number;
        if (c1 === a1 || c1 === a2 || c1 === b1 || c1 === b2) continue;
        if (c2 === a1 || c2 === a2 || c2 === b1 || c2 === b2) continue;
        n++;
      }
    }
  }
  return n;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** core `rng.ts` 의 splitmix32 시딩. 값이 바뀌면 `rngParity()` 가 잡는다. */
function seedState(seed: number): Uint32Array {
  let a = Math.trunc(seed) | 0;
  const s = new Uint32Array(4);
  for (let i = 0; i < 4; i++) {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    s[i] = t >>> 0;
  }
  // 전 상태가 0 이면 xoshiro 는 0 에 갇힌다 (core 와 같은 보정).
  if (((s[0] as number) | (s[1] as number) | (s[2] as number) | (s[3] as number)) === 0) s[0] = 0x9e3779b9;
  return s;
}

/**
 * xoshiro128** 한 배치. `state` = [s0,s1,s2,s3] (제자리 갱신), `pool` 에 POOL_SIZE 개를 채운다.
 * `rotl` 은 여기서 손으로 편다 — 프로파일에서 호출이 인라인되지 않아 173ms/2M샘플 이었다.
 */
function refill(state: Uint32Array, pool: Uint32Array): void {
  let s0 = state[0] as number;
  let s1 = state[1] as number;
  let s2 = state[2] as number;
  let s3 = state[3] as number;
  for (let n = 0; n < POOL_SIZE; n++) {
    const x = Math.imul(s1, 5) >>> 0;
    pool[n] = Math.imul(((x << 7) | (x >>> 25)) >>> 0, 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = ((s3 << 11) | (s3 >>> 21)) >>> 0;
  }
  state[0] = s0;
  state[1] = s1;
  state[2] = s2;
  state[3] = s3;
}

/** 배치 난수원. next() 의 수열은 `createRng(seed).nextUint32()` 와 동일하다 (검증용 래퍼). */
function batchedRng(seed: number): () => number {
  const state = seedState(seed);
  const pool = new Uint32Array(POOL_SIZE);
  let pos = POOL_SIZE;
  return function next(): number {
    if (pos === POOL_SIZE) {
      refill(state, pool);
      pos = 0;
    }
    return pool[pos++] as number;
  };
}

export type RngParity = { ok: true } | { ok: false; at: number; core: number; batched: number };

/**
 * 배치 난수원이 core 와 같은 수열을 내는지 확인한다. 다르면 표의 시드 규약이 깨진 것이므로
 * 실패 위치를 돌려준다 (테스트가 게이트로 쓴다).
 */
export function rngParity(seed: number, count: number): RngParity {
  const reference = createRng(seed);
  const next = batchedRng(seed);
  for (let n = 0; n < count; n++) {
    const a = reference.nextUint32();
    const b = next();
    if (a !== b) return { ok: false, at: n, core: a, batched: b };
  }
  return { ok: true };
}

export interface TripleShares {
  /** 세 지분(합 1). 순서는 (i, j, k) */
  shares: [number, number, number];
  w3: number;
  /** 실제로 센 샘플 수 (= samples) */
  samples: number;
}

/**
 * 트리플 (i <= j <= k) 의 팟 지분. 시드는 클래스 이름에서만 나오므로 샤딩·워커 수와 무관하게
 * 같은 값이 나온다. 여섯 장이 겹치면 세 콤보를 **다시 뽑고** 그 시도는 세지 않는다.
 */
export function sampleTriple(i: number, j: number, k: number, samples: number): TripleShares {
  if (!(i <= j && j <= k)) {
    throw new RangeError(`sampleTriple needs i <= j <= k, got ${String(i)},${String(j)},${String(k)}`);
  }
  if (!Number.isInteger(samples) || samples < 1) {
    throw new RangeError(`samples must be a positive integer: ${String(samples)}`);
  }
  // **서로 겹치지 않는 콤보 3쌍이 아예 없는 트리플**이 818,805 개 중 325 개 있다
  // (AA/AA/AA 는 에이스가 4장뿐이라 불가능, AA/AA/AKs 도 마찬가지). 거절 샘플링은 이때
  // 영원히 돈다 — 실제로 표 생성이 t=0 에서 멈춰 있었다. 이 트리플의 지분은 모든 축약에서
  // w3 = 0 으로 곱해져 **한 번도 쓰이지 않으므로** 대칭값(1/3)을 즉시 돌려준다.
  // (양자화하면 21845 셋이라 로더의 합·대칭 검사도 통과한다.)
  const w3 = countW3(i, j, k);
  if (w3 === 0) return { shares: [1 / 3, 1 / 3, 1 / 3], w3: 0, samples };
  // 난수는 함수 호출 없이 배열에서 읽는다 — 클로저 호출 하나가 샘플당 9~11번이고
  // 프로파일에서 전체의 40% 였다. `pos === POOL_SIZE` 일 때만 refill 을 부른다.
  const state = seedState(tripleSeed(i, j, k));
  const pool = new Uint32Array(POOL_SIZE);
  let pos = POOL_SIZE;
  const ca = classCards(i);
  const cb = classCards(j);
  const cc = classCards(k);
  const na = ca.length >> 1;
  const nb = cb.length >> 1;
  const nc = cc.length >> 1;

  let sa = 0;
  let sb = 0;
  let sc = 0;

  for (let s = 0; s < samples; s++) {
    let a1 = 0;
    let a2 = 0;
    let b1 = 0;
    let b2 = 0;
    let d1 = 0;
    let d2 = 0;
    // 거절 샘플링: 여섯 장이 서로 다를 때까지 세 콤보를 다시 뽑는다 (실패한 시도는 세지 않는다).
    for (;;) {
      // 배치 경계에서 남은 난수를 **버리지 않는다** — 하나라도 건너뛰면 core `createRng` 와
      // 수열이 갈라져 시드 규약(3.2)이 깨진다. 그래서 읽기마다 경계를 본다.
      if (pos === POOL_SIZE) {
        refill(state, pool);
        pos = 0;
      }
      const x = Math.floor(((pool[pos++] as number) * na) / 4294967296) * 2;
      if (pos === POOL_SIZE) {
        refill(state, pool);
        pos = 0;
      }
      const y = Math.floor(((pool[pos++] as number) * nb) / 4294967296) * 2;
      if (pos === POOL_SIZE) {
        refill(state, pool);
        pos = 0;
      }
      const z = Math.floor(((pool[pos++] as number) * nc) / 4294967296) * 2;
      a1 = ca[x] as number;
      a2 = ca[x + 1] as number;
      b1 = cb[y] as number;
      b2 = cb[y + 1] as number;
      d1 = cc[z] as number;
      d2 = cc[z + 1] as number;
      if (b1 === a1 || b1 === a2 || b2 === a1 || b2 === a2) continue;
      if (d1 === a1 || d1 === a2 || d1 === b1 || d1 === b2) continue;
      if (d2 === a1 || d2 === a2 || d2 === b1 || d2 === b2) continue;
      break;
    }

    // 카드 사용 표시: 0..31 은 lo 워드, 32..51 은 hi 워드 (JS 비트 연산이 32비트라 둘로 쪼갠다)
    let ulo = 0;
    let uhi = 0;
    if (a1 < 32) ulo |= 1 << a1;
    else uhi |= 1 << (a1 - 32);
    if (a2 < 32) ulo |= 1 << a2;
    else uhi |= 1 << (a2 - 32);
    if (b1 < 32) ulo |= 1 << b1;
    else uhi |= 1 << (b1 - 32);
    if (b2 < 32) ulo |= 1 << b2;
    else uhi |= 1 << (b2 - 32);
    if (d1 < 32) ulo |= 1 << d1;
    else uhi |= 1 << (d1 - 32);
    if (d2 < 32) ulo |= 1 << d2;
    else uhi |= 1 << (d2 - 32);

    // 보드 5장: 남은 46장에서 nextInt(52) 거절 샘플링 (뽑힌 순서 고정)
    let m1 = 0;
    let m2 = 0;
    let m3 = 0;
    let m4 = 0;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    for (let n = 0; n < 5; n++) {
      let card = 0;
      for (;;) {
        if (pos === POOL_SIZE) {
          refill(state, pool);
          pos = 0;
        }
        card = Math.floor(((pool[pos++] as number) * 52) / 4294967296);
        if (card < 32) {
          const bit = 1 << card;
          if ((ulo & bit) === 0) {
            ulo |= bit;
            break;
          }
        } else {
          const bit = 1 << (card - 32);
          if ((uhi & bit) === 0) {
            uhi |= bit;
            break;
          }
        }
      }
      const b = 1 << (card >> 2);
      m4 |= m3 & b;
      m3 |= m2 & b;
      m2 |= m1 & b;
      m1 |= b;
      const su = card & 3;
      if (su === 0) s0 |= b;
      else if (su === 1) s1 |= b;
      else if (su === 2) s2 |= b;
      else s3 |= b;
    }

    const va = evalWith(m1, m2, m3, m4, s0, s1, s2, s3, a1, a2);
    const vb = evalWith(m1, m2, m3, m4, s0, s1, s2, s3, b1, b2);
    const vc = evalWith(m1, m2, m3, m4, s0, s1, s2, s3, d1, d2);

    const best = va > vb ? (va > vc ? va : vc) : vb > vc ? vb : vc;
    let ties = 0;
    if (va === best) ties++;
    if (vb === best) ties++;
    if (vc === best) ties++;
    const gain = 1 / ties;
    if (va === best) sa += gain;
    if (vb === best) sb += gain;
    if (vc === best) sc += gain;
  }

  return { shares: [sa / samples, sb / samples, sc / samples], w3, samples };
}

/** 보드 마스크에 홀 카드 2장을 더해 평가한다. */
function evalWith(
  m1: number,
  m2: number,
  m3: number,
  m4: number,
  s0: number,
  s1: number,
  s2: number,
  s3: number,
  h1: number,
  h2: number,
): number {
  let b = 1 << (h1 >> 2);
  let n4 = m4 | (m3 & b);
  let n3 = m3 | (m2 & b);
  let n2 = m2 | (m1 & b);
  let n1 = m1 | b;
  let t0 = s0;
  let t1 = s1;
  let t2 = s2;
  let t3 = s3;
  let su = h1 & 3;
  if (su === 0) t0 |= b;
  else if (su === 1) t1 |= b;
  else if (su === 2) t2 |= b;
  else t3 |= b;

  b = 1 << (h2 >> 2);
  n4 |= n3 & b;
  n3 |= n2 & b;
  n2 |= n1 & b;
  n1 |= b;
  su = h2 & 3;
  if (su === 0) t0 |= b;
  else if (su === 1) t1 |= b;
  else if (su === 2) t2 |= b;
  else t3 |= b;

  return evaluateMasks(n1, n2, n3, n4, t0, t1, t2, t3);
}

/**
 * 지분 -> u16 4개. 같은 클래스가 둘 이상이면 그 지분들을 **평균으로 대칭화**한 뒤 양자화한다
 * (같은 클래스는 정의상 같은 지분이고, MC 잡음이 대칭을 깨면 로더 검증이 막는다).
 * 양자화 잔차는 홀로 남은 항목이 흡수해 합이 정확히 65535 가 된다.
 */
export function quantizeShares(
  i: number,
  j: number,
  k: number,
  shares: readonly [number, number, number],
): [number, number, number] {
  const [a, b, c] = shares;
  let q: [number, number, number];
  if (i === j && j === k) {
    q = [THIRD_U16, THIRD_U16, THIRD_U16];
  } else if (i === j) {
    const m = Math.round(((a + b) / 2) * U16_SCALE);
    q = [m, m, U16_SCALE - 2 * m];
  } else if (j === k) {
    const m = Math.round(((b + c) / 2) * U16_SCALE);
    q = [U16_SCALE - 2 * m, m, m];
  } else {
    const qa = Math.round(a * U16_SCALE);
    const qb = Math.round(b * U16_SCALE);
    q = [qa, qb, U16_SCALE - qa - qb];
  }
  for (const v of q) {
    if (v < 0 || v > U16_SCALE) throw new RangeError(`quantized share out of range: ${q.join(',')}`);
  }
  return q;
}
