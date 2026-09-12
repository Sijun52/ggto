/**
 * 에퀴티. P0.md 4.5.
 *
 * hand-vs-hand 는 전수. range-vs-range 는
 *   - 보드 >= 3장: 전수 (런아웃마다 1326 콤보를 한 번씩 평가 → 정렬 → 누적합.
 *     1326x1326 쌍을 매 런아웃마다 평가하지 않는다)
 *   - 보드 < 3장: 몬테카를로만 (프리플랍 전수는 1.7M 보드 x 1326 이라 TS로 불가)
 */

import { CardSyntaxError, type Card } from './card.js';
import {
  COMBO_COUNT,
  COMBO_HI_TABLE,
  COMBO_LO_TABLE,
  type ComboIndex,
} from './combo.js';
import { evaluateMasks, type HandValue } from './evaluator.js';
import { EmptyRangeError, type Range } from './range/range.js';
import { createRng } from './rng.js';

export class UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedError';
  }
}

export interface EquityResult {
  win: number;
  tie: number;
  lose: number;
  /** (win + tie/2) / total */
  equity: number;
}

export interface RangeEquityOptions {
  mode: 'exact' | 'monte-carlo';
  samples?: number;
  seed?: number;
}

export interface RangeEquityResult {
  /** 히어로 에퀴티 (가중 집계). = heroWin + tie/2 */
  hero: number;
  /** 빌런 에퀴티 (가중 집계). hero + villain === 1 */
  villain: number;
  /** 타이 빈도 (가중). heroWin + villainWin + tie === 1 */
  tie: number;
  /** 순수 승률 (타이 제외). 스펙의 합=1 불변식을 검사할 수 있게 명시 필드로 노출한다. */
  heroWin: number;
  villainWin: number;
  /** 1326. 레인지 밖이거나 보드와 충돌하는 콤보는 NaN. */
  heroPerCombo: Float32Array;
  villainPerCombo: Float32Array;
  /** 유효 콤보 쌍 수 (양쪽 가중치>0, 서로/보드와 카드 충돌 없음) */
  matchups: number;
}

// ---------------------------------------------------------------------------
// 콤보별 마스크 테이블 (2장짜리 랭크/슈트 마스크). 전수 열거 핫 경로에서 재사용.
// ---------------------------------------------------------------------------

// 핫 루프에서 ESM 네임스페이스 간접 참조를 없애기 위한 모듈 지역 별칭.
const N = COMBO_COUNT;
const HI = COMBO_HI_TABLE;
const LO = COMBO_LO_TABLE;
const evalMasks = evaluateMasks;

const CM1 = new Uint16Array(COMBO_COUNT); // count>=1 랭크 마스크
const CM2 = new Uint16Array(COMBO_COUNT); // count>=2 (페어일 때만 nonzero)
const CS = [
  new Uint16Array(COMBO_COUNT),
  new Uint16Array(COMBO_COUNT),
  new Uint16Array(COMBO_COUNT),
  new Uint16Array(COMBO_COUNT),
];

for (let i = 0; i < N; i++) {
  const hi = HI[i] as number;
  const lo = LO[i] as number;
  const bh = 1 << (hi >> 2);
  const bl = 1 << (lo >> 2);
  CM1[i] = bh | bl;
  CM2[i] = bh & bl;
  const sh = CS[hi & 3] as Uint16Array;
  const sl = CS[lo & 3] as Uint16Array;
  sh[i] = (sh[i] as number) | bh;
  sl[i] = (sl[i] as number) | bl;
}

const CS0 = CS[0] as Uint16Array;
const CS1 = CS[1] as Uint16Array;
const CS2 = CS[2] as Uint16Array;
const CS3 = CS[3] as Uint16Array;

/**
 * 2장짜리 마스크 집합 a 와 보드 마스크 집합 b 를 합쳐 평가.
 * a3 = a4 = 0 (같은 랭크가 최대 2장) 이므로 항을 줄여 놓았다.
 */
function mergeEval(
  a1: number,
  a2: number,
  as0: number,
  as1: number,
  as2: number,
  as3: number,
  b1: number,
  b2: number,
  b3: number,
  b4: number,
  bs0: number,
  bs1: number,
  bs2: number,
  bs3: number,
): HandValue {
  const m1 = a1 | b1;
  const m2 = a2 | b2 | (a1 & b1);
  const m3 = b3 | (a1 & b2) | (a2 & b1);
  const m4 = b4 | (a1 & b3) | (a2 & b2);
  return evalMasks(m1, m2, m3, m4, as0 | bs0, as1 | bs1, as2 | bs2, as3 | bs3);
}

type RunoutCallback = (
  m1: number,
  m2: number,
  m3: number,
  m4: number,
  s0: number,
  s1: number,
  s2: number,
  s3: number,
) => void;

interface Masks {
  m1: number;
  m2: number;
  m3: number;
  m4: number;
  s0: number;
  s1: number;
  s2: number;
  s3: number;
}

function masksOfCards(cards: readonly Card[]): Masks {
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  for (const c of cards) {
    const b = 1 << (c >> 2);
    m4 |= m3 & b;
    m3 |= m2 & b;
    m2 |= m1 & b;
    m1 |= b;
    const s = c & 3;
    if (s === 0) s0 |= b;
    else if (s === 1) s1 |= b;
    else if (s === 2) s2 |= b;
    else s3 |= b;
  }
  return { m1, m2, m3, m4, s0, s1, s2, s3 };
}

/**
 * deck 에서 need 장을 고르는 모든 조합에 대해, 시작 마스크 base 에 누적한 마스크를 콜백한다.
 * 레벨별 부분 마스크를 재사용하므로 카드 추가 비용이 O(1) 이다.
 */
function runoutLoop(deck: readonly Card[], need: number, base: Masks, cb: RunoutCallback): void {
  if (need === 0) {
    cb(base.m1, base.m2, base.m3, base.m4, base.s0, base.s1, base.s2, base.s3);
    return;
  }
  const n = deck.length;
  if (need > n) throw new CardSyntaxError('not enough cards left in the deck for the runout');

  const idx = new Int32Array(need);
  const M1 = new Int32Array(need + 1);
  const M2 = new Int32Array(need + 1);
  const M3 = new Int32Array(need + 1);
  const M4 = new Int32Array(need + 1);
  const S0 = new Int32Array(need + 1);
  const S1 = new Int32Array(need + 1);
  const S2 = new Int32Array(need + 1);
  const S3 = new Int32Array(need + 1);
  M1[0] = base.m1;
  M2[0] = base.m2;
  M3[0] = base.m3;
  M4[0] = base.m4;
  S0[0] = base.s0;
  S1[0] = base.s1;
  S2[0] = base.s2;
  S3[0] = base.s3;

  let d = 0;
  idx[0] = 0;
  while (d >= 0) {
    const i = idx[d] as number;
    if (i > n - (need - d)) {
      d--;
      if (d >= 0) idx[d] = (idx[d] as number) + 1;
      continue;
    }
    const c = deck[i] as number;
    const bit = 1 << (c >> 2);
    const p1 = M1[d] as number;
    const p2 = M2[d] as number;
    const p3 = M3[d] as number;
    const p4 = M4[d] as number;
    M4[d + 1] = p4 | (p3 & bit);
    M3[d + 1] = p3 | (p2 & bit);
    M2[d + 1] = p2 | (p1 & bit);
    M1[d + 1] = p1 | bit;
    const s = c & 3;
    S0[d + 1] = (S0[d] as number) | (s === 0 ? bit : 0);
    S1[d + 1] = (S1[d] as number) | (s === 1 ? bit : 0);
    S2[d + 1] = (S2[d] as number) | (s === 2 ? bit : 0);
    S3[d + 1] = (S3[d] as number) | (s === 3 ? bit : 0);

    if (d === need - 1) {
      cb(
        M1[need] as number,
        M2[need] as number,
        M3[need] as number,
        M4[need] as number,
        S0[need] as number,
        S1[need] as number,
        S2[need] as number,
        S3[need] as number,
      );
      idx[d] = i + 1;
    } else {
      idx[d + 1] = i + 1;
      d++;
    }
  }
}

function validateDistinct(cards: readonly Card[], what: string): void {
  const seen = new Set<number>();
  for (const c of cards) {
    if (!Number.isInteger(c) || c < 0 || c > 51) {
      throw new CardSyntaxError(`${what}: card out of range 0..51: ${String(c)}`);
    }
    if (seen.has(c)) throw new CardSyntaxError(`${what}: duplicate card ${String(c)}`);
    seen.add(c);
  }
}

function remainingDeck(used: readonly Card[]): Card[] {
  const blocked = new Set(used);
  const deck: Card[] = [];
  for (let c = 0; c < 52; c++) if (!blocked.has(c)) deck.push(c);
  return deck;
}

// ---------------------------------------------------------------------------
// hand vs hand (전수)
// ---------------------------------------------------------------------------

export function equityHandVsHand(
  hero: readonly [Card, Card],
  villain: readonly [Card, Card],
  board: readonly Card[],
): EquityResult {
  if (hero.length !== 2) throw new CardSyntaxError('hero must be exactly 2 cards');
  if (villain.length !== 2) throw new CardSyntaxError('villain must be exactly 2 cards');
  if (board.length > 5) throw new CardSyntaxError('board must be 0..5 cards');
  const all = [...hero, ...villain, ...board];
  validateDistinct(all, 'equityHandVsHand');

  const deck = remainingDeck(all);
  const need = 5 - board.length;
  const bm = masksOfCards(board);

  const h1 = 1 << (hero[0] >> 2);
  const h2 = 1 << (hero[1] >> 2);
  const ha1 = h1 | h2;
  const ha2 = h1 & h2;
  const hs = [0, 0, 0, 0];
  hs[hero[0] & 3] = (hs[hero[0] & 3] as number) | h1;
  hs[hero[1] & 3] = (hs[hero[1] & 3] as number) | h2;

  const v1 = 1 << (villain[0] >> 2);
  const v2 = 1 << (villain[1] >> 2);
  const va1 = v1 | v2;
  const va2 = v1 & v2;
  const vs = [0, 0, 0, 0];
  vs[villain[0] & 3] = (vs[villain[0] & 3] as number) | v1;
  vs[villain[1] & 3] = (vs[villain[1] & 3] as number) | v2;

  const hs0 = hs[0] as number;
  const hs1 = hs[1] as number;
  const hs2 = hs[2] as number;
  const hs3 = hs[3] as number;
  const vs0 = vs[0] as number;
  const vs1 = vs[1] as number;
  const vs2 = vs[2] as number;
  const vs3 = vs[3] as number;

  let win = 0;
  let tie = 0;
  let lose = 0;

  runoutLoop(deck, need, bm, (m1, m2, m3, m4, s0, s1, s2, s3) => {
    const hv = mergeEval(ha1, ha2, hs0, hs1, hs2, hs3, m1, m2, m3, m4, s0, s1, s2, s3);
    const vv = mergeEval(va1, va2, vs0, vs1, vs2, vs3, m1, m2, m3, m4, s0, s1, s2, s3);
    if (hv > vv) win++;
    else if (hv < vv) lose++;
    else tie++;
  });

  const total = win + tie + lose;
  return { win, tie, lose, equity: (win + tie / 2) / total };
}

// ---------------------------------------------------------------------------
// range vs range
// ---------------------------------------------------------------------------

function assertRangeArg(r: Range, what: string): void {
  if (!(r instanceof Float32Array) || r.length !== COMBO_COUNT) {
    throw new TypeError(`${what} must be a Float32Array of length 1326`);
  }
}

function blockedByBoard(i: ComboIndex, boardCards: readonly Card[]): boolean {
  const hi = HI[i] as number;
  const lo = LO[i] as number;
  for (const c of boardCards) if (c === hi || c === lo) return true;
  return false;
}

function countMatchups(
  heroList: readonly ComboIndex[],
  villainList: readonly ComboIndex[],
): number {
  let n = 0;
  for (const i of heroList) {
    const ih = HI[i] as number;
    const il = LO[i] as number;
    for (const j of villainList) {
      const jh = HI[j] as number;
      const jl = LO[j] as number;
      if (ih === jh || ih === jl || il === jh || il === jl) continue;
      n++;
    }
  }
  return n;
}

/**
 * 한 런아웃에서 subject 관점의 win/tie/total 을 누적한다.
 * sortedVal/sortedIdx 는 핸드값 오름차순으로 정렬된 유효 콤보들.
 *
 * 카드 충돌 보정은 포함-배제로 한다:
 *   (a 또는 b 를 포함하는 상대 콤보 무게) = cardW[a] + cardW[b] - w(콤보 ab)
 * 콤보 ab 는 subject 자신이므로 "더 약한" 집합엔 없고, 동률 집합엔 있다.
 */
function sweep(
  subjW: Range,
  oppW: Range,
  num: Float64Array,
  den: Float64Array,
  tieAcc: Float64Array,
  sortedVal: Float64Array,
  sortedIdx: Uint16Array,
  n: number,
  cardW: Float64Array,
  cardAll: Float64Array,
  gc: Float64Array,
): void {
  cardW.fill(0);
  cardAll.fill(0);

  let wAll = 0;
  for (let k = 0; k < n; k++) {
    const ai = sortedIdx[k] as number;
    const w = oppW[ai] as number;
    if (w <= 0) continue;
    wAll += w;
    const hi = HI[ai] as number;
    const lo = LO[ai] as number;
    cardAll[hi] = (cardAll[hi] as number) + w;
    cardAll[lo] = (cardAll[lo] as number) + w;
  }
  if (wAll <= 0) return;

  let totalW = 0;
  let k = 0;
  while (k < n) {
    const val = sortedVal[k] as number;
    let e = k;
    while (e < n && (sortedVal[e] as number) === val) e++;

    let gw = 0;
    for (let t = k; t < e; t++) {
      const ai = sortedIdx[t] as number;
      const w = oppW[ai] as number;
      if (w <= 0) continue;
      gw += w;
      const hi = HI[ai] as number;
      const lo = LO[ai] as number;
      gc[hi] = (gc[hi] as number) + w;
      gc[lo] = (gc[lo] as number) + w;
    }

    for (let t = k; t < e; t++) {
      const ai = sortedIdx[t] as number;
      const sw = subjW[ai] as number;
      if (sw <= 0) continue;
      const hi = HI[ai] as number;
      const lo = LO[ai] as number;
      const selfOpp = oppW[ai] as number;
      const winW = totalW - (cardW[hi] as number) - (cardW[lo] as number);
      const tieW = gw - (gc[hi] as number) - (gc[lo] as number) + selfOpp;
      const tot = wAll - (cardAll[hi] as number) - (cardAll[lo] as number) + selfOpp;
      if (tot <= 0) continue;
      num[ai] = (num[ai] as number) + winW + tieW / 2;
      den[ai] = (den[ai] as number) + tot;
      tieAcc[ai] = (tieAcc[ai] as number) + tieW;
    }

    for (let t = k; t < e; t++) {
      const ai = sortedIdx[t] as number;
      const hi = HI[ai] as number;
      const lo = LO[ai] as number;
      const w = oppW[ai] as number;
      if (w > 0) {
        cardW[hi] = (cardW[hi] as number) + w;
        cardW[lo] = (cardW[lo] as number) + w;
      }
      gc[hi] = 0;
      gc[lo] = 0;
    }
    totalW += gw;
    k = e;
  }
}

function aggregate(
  w: Range,
  num: Float64Array,
  den: Float64Array,
  tieAcc: Float64Array,
): { equity: number; win: number; tie: number; denom: number } {
  let nAgg = 0;
  let dAgg = 0;
  let tAgg = 0;
  for (let i = 0; i < N; i++) {
    const wi = w[i] as number;
    if (wi <= 0) continue;
    const d = den[i] as number;
    if (d <= 0) continue;
    nAgg += wi * (num[i] as number);
    dAgg += wi * d;
    tAgg += wi * (tieAcc[i] as number);
  }
  if (dAgg <= 0) return { equity: NaN, win: NaN, tie: NaN, denom: 0 };
  const equity = nAgg / dAgg;
  const tie = tAgg / dAgg;
  return { equity, win: equity - tie / 2, tie, denom: dAgg };
}

function perComboOut(num: Float64Array, den: Float64Array): Float32Array {
  const out = new Float32Array(COMBO_COUNT);
  for (let i = 0; i < N; i++) {
    const d = den[i] as number;
    out[i] = d > 0 ? (num[i] as number) / d : NaN;
  }
  return out;
}

function exactRangeVsRange(
  hero: Range,
  villain: Range,
  board: readonly Card[],
): RangeEquityResult {
  if (board.length < 3) {
    throw new UnsupportedError(
      `exact range-vs-range needs a board of 3..5 cards (got ${String(board.length)}). ` +
        'Preflop exact would be 1.7M boards x 1326 combos; use mode "monte-carlo".',
    );
  }

  const heroList: ComboIndex[] = [];
  const villainList: ComboIndex[] = [];
  const active: ComboIndex[] = [];
  for (let i = 0; i < N; i++) {
    const hw = hero[i] as number;
    const vw = villain[i] as number;
    if (hw <= 0 && vw <= 0) continue;
    if (blockedByBoard(i, board)) continue;
    if (hw > 0) heroList.push(i);
    if (vw > 0) villainList.push(i);
    active.push(i);
  }
  const matchups = countMatchups(heroList, villainList);
  if (matchups === 0) {
    throw new EmptyRangeError('no valid hero/villain combo pair survives the board and card removal');
  }

  const deck = remainingDeck(board);
  const need = 5 - board.length;
  const bm = masksOfCards(board);

  const heroNum = new Float64Array(COMBO_COUNT);
  const heroDen = new Float64Array(COMBO_COUNT);
  const heroTie = new Float64Array(COMBO_COUNT);
  const vilNum = new Float64Array(COMBO_COUNT);
  const vilDen = new Float64Array(COMBO_COUNT);
  const vilTie = new Float64Array(COMBO_COUNT);

  const packed = new Float64Array(active.length);
  const sortedVal = new Float64Array(active.length);
  const sortedIdx = new Uint16Array(active.length);
  const cardW = new Float64Array(52);
  const cardAll = new Float64Array(52);
  const gc = new Float64Array(52);
  const activeArr = Uint16Array.from(active);

  runoutLoop(deck, need, bm, (m1, m2, m3, m4, s0, s1, s2, s3) => {
    let n = 0;
    for (let k = 0; k < activeArr.length; k++) {
      const ai = activeArr[k] as number;
      if (
        (((CS0[ai] as number) & s0) |
          ((CS1[ai] as number) & s1) |
          ((CS2[ai] as number) & s2) |
          ((CS3[ai] as number) & s3)) !== 0
      ) {
        continue;
      }
      const v = mergeEval(
        CM1[ai] as number,
        CM2[ai] as number,
        CS0[ai] as number,
        CS1[ai] as number,
        CS2[ai] as number,
        CS3[ai] as number,
        m1,
        m2,
        m3,
        m4,
        s0,
        s1,
        s2,
        s3,
      );
      // 값(<2^24) * 2048 + 콤보인덱스(<2048). double 에 정확히 담기고, 숫자 정렬이
      // 곧 (값, 인덱스) 사전순 정렬이 된다 → 비교 함수 없는 TypedArray.sort 사용 가능.
      packed[n] = v * 2048 + ai;
      n++;
    }
    if (n === 0) return;
    packed.subarray(0, n).sort();
    for (let k = 0; k < n; k++) {
      const p = packed[k] as number;
      const v = Math.floor(p / 2048);
      sortedVal[k] = v;
      sortedIdx[k] = p - v * 2048;
    }
    sweep(hero, villain, heroNum, heroDen, heroTie, sortedVal, sortedIdx, n, cardW, cardAll, gc);
    sweep(villain, hero, vilNum, vilDen, vilTie, sortedVal, sortedIdx, n, cardW, cardAll, gc);
  });

  const h = aggregate(hero, heroNum, heroDen, heroTie);
  const v = aggregate(villain, vilNum, vilDen, vilTie);

  return {
    hero: h.equity,
    villain: v.equity,
    tie: h.tie,
    heroWin: h.win,
    villainWin: v.win,
    heroPerCombo: perComboOut(heroNum, heroDen),
    villainPerCombo: perComboOut(vilNum, vilDen),
    matchups,
  };
}

function buildSampler(r: Range, list: readonly ComboIndex[]): { cum: Float64Array; total: number } {
  const cum = new Float64Array(list.length);
  let acc = 0;
  for (let k = 0; k < list.length; k++) {
    acc += r[list[k] as ComboIndex] as number;
    cum[k] = acc;
  }
  return { cum, total: acc };
}

function sampleIndex(cum: Float64Array, total: number, u: number): number {
  const x = u * total;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((cum[mid] as number) <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function monteCarloRangeVsRange(
  hero: Range,
  villain: Range,
  board: readonly Card[],
  samples: number,
  seed: number,
): RangeEquityResult {
  const heroList: ComboIndex[] = [];
  const villainList: ComboIndex[] = [];
  for (let i = 0; i < N; i++) {
    if (blockedByBoard(i, board)) continue;
    if ((hero[i] as number) > 0) heroList.push(i);
    if ((villain[i] as number) > 0) villainList.push(i);
  }
  const matchups = countMatchups(heroList, villainList);
  if (matchups === 0) {
    throw new EmptyRangeError('no valid hero/villain combo pair survives the board and card removal');
  }

  const hs = buildSampler(hero, heroList);
  const vs = buildSampler(villain, villainList);
  const rng = createRng(seed);
  const deck = remainingDeck(board);
  const need = 5 - board.length;
  const bm = masksOfCards(board);

  const heroNum = new Float64Array(COMBO_COUNT);
  const heroDen = new Float64Array(COMBO_COUNT);
  const vilNum = new Float64Array(COMBO_COUNT);
  const vilDen = new Float64Array(COMBO_COUNT);

  let win = 0;
  let tie = 0;
  let lose = 0;
  const drawn = new Int32Array(5);

  for (let s = 0; s < samples; s++) {
    let hi: ComboIndex = 0;
    let vi: ComboIndex = 0;
    let hHi = 0;
    let hLo = 0;
    let vHi = 0;
    let vLo = 0;
    let attempts = 0;
    for (;;) {
      hi = heroList[sampleIndex(hs.cum, hs.total, rng.nextFloat())] as ComboIndex;
      vi = villainList[sampleIndex(vs.cum, vs.total, rng.nextFloat())] as ComboIndex;
      hHi = HI[hi] as number;
      hLo = LO[hi] as number;
      vHi = HI[vi] as number;
      vLo = LO[vi] as number;
      if (hHi !== vHi && hHi !== vLo && hLo !== vHi && hLo !== vLo) break;
      attempts++;
      if (attempts > 10000) {
        throw new UnsupportedError('monte-carlo could not find a non-conflicting combo pair');
      }
    }

    // 런아웃 추출 (거절 샘플링). 사용 카드는 52비트를 두 개의 32비트로 나눠 표시.
    // 핫 루프라 클로저를 쓰지 않고 비트 연산을 인라인한다.
    let usedLo = 0;
    let usedHi = 0;
    if (hHi < 32) usedLo |= 1 << hHi;
    else usedHi |= 1 << (hHi - 32);
    if (hLo < 32) usedLo |= 1 << hLo;
    else usedHi |= 1 << (hLo - 32);
    if (vHi < 32) usedLo |= 1 << vHi;
    else usedHi |= 1 << (vHi - 32);
    if (vLo < 32) usedLo |= 1 << vLo;
    else usedHi |= 1 << (vLo - 32);

    let m1 = bm.m1;
    let m2 = bm.m2;
    let m3 = bm.m3;
    let m4 = bm.m4;
    let s0 = bm.s0;
    let s1 = bm.s1;
    let s2 = bm.s2;
    let s3 = bm.s3;
    for (let d = 0; d < need; d++) {
      let c = 0;
      for (;;) {
        c = deck[rng.nextInt(deck.length)] as number;
        const hit = c < 32 ? (usedLo >>> c) & 1 : (usedHi >>> (c - 32)) & 1;
        if (hit === 0) break;
      }
      if (c < 32) usedLo |= 1 << c;
      else usedHi |= 1 << (c - 32);
      drawn[d] = c;
      const bit = 1 << (c >> 2);
      m4 |= m3 & bit;
      m3 |= m2 & bit;
      m2 |= m1 & bit;
      m1 |= bit;
      const su = c & 3;
      if (su === 0) s0 |= bit;
      else if (su === 1) s1 |= bit;
      else if (su === 2) s2 |= bit;
      else s3 |= bit;
    }

    const hv = mergeEval(
      CM1[hi] as number,
      CM2[hi] as number,
      CS0[hi] as number,
      CS1[hi] as number,
      CS2[hi] as number,
      CS3[hi] as number,
      m1,
      m2,
      m3,
      m4,
      s0,
      s1,
      s2,
      s3,
    );
    const vv = mergeEval(
      CM1[vi] as number,
      CM2[vi] as number,
      CS0[vi] as number,
      CS1[vi] as number,
      CS2[vi] as number,
      CS3[vi] as number,
      m1,
      m2,
      m3,
      m4,
      s0,
      s1,
      s2,
      s3,
    );

    let heroScore: number;
    if (hv > vv) {
      win++;
      heroScore = 1;
    } else if (hv < vv) {
      lose++;
      heroScore = 0;
    } else {
      tie++;
      heroScore = 0.5;
    }
    heroNum[hi] = (heroNum[hi] as number) + heroScore;
    heroDen[hi] = (heroDen[hi] as number) + 1;
    vilNum[vi] = (vilNum[vi] as number) + (1 - heroScore);
    vilDen[vi] = (vilDen[vi] as number) + 1;
  }

  const total = win + tie + lose;
  const tieFrac = tie / total;
  const heroEq = (win + tie / 2) / total;

  return {
    hero: heroEq,
    villain: 1 - heroEq,
    tie: tieFrac,
    heroWin: win / total,
    villainWin: lose / total,
    heroPerCombo: perComboOut(heroNum, heroDen),
    villainPerCombo: perComboOut(vilNum, vilDen),
    matchups,
  };
}

export function equityRangeVsRange(
  hero: Range,
  villain: Range,
  board: readonly Card[],
  opts: RangeEquityOptions,
): RangeEquityResult {
  assertRangeArg(hero, 'hero range');
  assertRangeArg(villain, 'villain range');
  if (board.length > 5) throw new CardSyntaxError('board must be 0..5 cards');
  validateDistinct(board, 'equityRangeVsRange board');

  if (opts.mode === 'exact') return exactRangeVsRange(hero, villain, board);
  if (opts.mode === 'monte-carlo') {
    const samples = opts.samples ?? 100_000;
    if (!Number.isInteger(samples) || samples < 1) {
      throw new RangeError(`samples must be a positive integer: ${String(samples)}`);
    }
    return monteCarloRangeVsRange(hero, villain, board, samples, opts.seed ?? 0);
  }
  throw new UnsupportedError(`unknown equity mode: ${JSON.stringify(opts.mode)}`);
}
