/**
 * 보드 슈트 동형 정규화. P0.md 4.6.
 *
 * 핵심: "레인지가 비대칭이면 포기"가 아니라, 레인지들을 불변으로 두는 슈트 순열의
 * 부분군(stabilizer) 안에서 최소 보드를 고른다. 대칭 레인지면 24개 전부,
 * 완전 비대칭이면 항등 하나. 분기 없는 단일 코드 경로다.
 *
 * 캐시 키의 정당성: 보드에만 순열을 적용하고 레인지를 놔두면
 * (Ks7h2h, AsKs) 와 (Kd7s2s, AsKs) 가 같은 키를 받는다 — 서로 다른 게임이다.
 * 그래서 레인지에도 같은 perm 을 적용해 반환한다.
 */

import { CardSyntaxError, type Card } from './card.js';
import { COMBO_COUNT, comboHi, comboLo } from './combo.js';
import { permuteRangeSuits, type Range } from './range/range.js';
import { ALL_SUIT_PERMS, IDENTITY_PERM, applyPermToCard, type SuitPerm } from './suitPerm.js';

// 핫 루프(플랍 22,100 x 24 순열)에서 ESM 간접 참조를 없애기 위한 모듈 지역 별칭.
const PERMS = ALL_SUIT_PERMS;
const permCard = applyPermToCard;

/** 정렬된 보드를 하나의 수로. 각 자리 < 52 이므로 숫자 비교 = 사전순 비교. */
function packSorted(cards: Int32Array, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 52 + (cards[i] as number);
  return v;
}

function sortSmall(a: Int32Array, len: number): void {
  for (let i = 1; i < len; i++) {
    const x = a[i] as number;
    let j = i - 1;
    while (j >= 0 && (a[j] as number) > x) {
      a[j + 1] = a[j] as number;
      j--;
    }
    a[j + 1] = x;
  }
}

function validateBoard(board: readonly Card[]): void {
  if (board.length < 3 || board.length > 5) {
    throw new CardSyntaxError(`board must be 3..5 cards, got ${String(board.length)}`);
  }
  const seen = new Set<number>();
  for (const c of board) {
    if (!Number.isInteger(c) || c < 0 || c > 51) {
      throw new CardSyntaxError(`board card out of range 0..51: ${String(c)}`);
    }
    if (seen.has(c)) throw new CardSyntaxError(`duplicate board card ${String(c)}`);
    seen.add(c);
  }
}

/** 재사용 버퍼 (단일 스레드 전제). 22,100 플랍 x 24 순열에서 할당을 없앤다. */
const scratch = new Int32Array(5);

function minimalUnder(
  board: readonly Card[],
  perms: readonly SuitPerm[],
): { board: Card[]; perm: SuitPerm } {
  const len = board.length;
  let bestKey = Infinity;
  let bestPerm: SuitPerm = IDENTITY_PERM;
  const best = new Int32Array(len);

  for (let p = 0; p < perms.length; p++) {
    const perm = perms[p] as SuitPerm;
    for (let i = 0; i < len; i++) scratch[i] = permCard(board[i] as number, perm);
    sortSmall(scratch, len);
    const key = packSorted(scratch, len);
    if (key < bestKey) {
      bestKey = key;
      bestPerm = perm;
      for (let i = 0; i < len; i++) best[i] = scratch[i] as number;
    }
  }

  const out: Card[] = new Array<number>(len);
  for (let i = 0; i < len; i++) out[i] = best[i] as number;
  return { board: out, perm: bestPerm };
}

/**
 * 24개 슈트 순열 중 사전순 최소 보드를 고른다.
 * 같은 동치류의 모든 보드는 같은 결과 board 를 낸다.
 */
export function canonicalBoard(board: readonly Card[]): { board: Card[]; perm: SuitPerm } {
  validateBoard(board);
  return minimalUnder(board, PERMS);
}

/** 모든 레인지를 불변으로 두는 슈트 순열의 부분군. 항등 순열은 항상 포함된다. */
/**
 * 순열 p 에 대한 콤보 인덱스 사상표. `MAP[p][i] = comboIndex(p(hi_i), p(lo_i))`.
 *
 * 24 × 1326 × 2B = 63KB 를 한 번 만들고 계속 쓴다. 이 표가 없으면 stabilizer 검사가
 * 콤보마다 `applyPermToCard` 2회 + `comboIndex`(범위 검사 포함)를 다시 하고, 그것이
 * `buildConfig` 비용의 대부분이 된다 (P4 벤치 실측).
 */
let PERM_COMBO_MAP: Uint16Array[] | null = null;

function permComboMap(): Uint16Array[] {
  if (PERM_COMBO_MAP !== null) return PERM_COMBO_MAP;
  const maps: Uint16Array[] = [];
  for (const perm of PERMS) {
    const m = new Uint16Array(COMBO_COUNT);
    for (let i = 0; i < COMBO_COUNT; i++) {
      const a = applyPermToCard(comboHi(i), perm);
      const b = applyPermToCard(comboLo(i), perm);
      const hi = a > b ? a : b;
      const lo = a > b ? b : a;
      m[i] = (hi * (hi - 1)) / 2 + lo;
    }
    maps.push(m);
  }
  PERM_COMBO_MAP = maps;
  return maps;
}

/**
 * 모든 레인지를 불변으로 두는 슈트 순열의 부분군. 항등 순열은 항상 포함된다.
 *
 * `r` 이 순열 불변이라는 것은 `∀i: r[p(i)] === r[i]` 다. 예전 구현은 `permuteRangeSuits` 로
 * 1326 배열을 **만든 뒤** 비교해서 순열마다 5KB 를 할당했고 (24 × 레인지 수), 첫 불일치를
 * 보기 전에 배열 전체를 채웠다. 사상표를 쓰면 할당이 0 이고 불일치에서 바로 빠진다.
 */
export function suitStabilizer(ranges: readonly Range[], eps = 1e-6): SuitPerm[] {
  if (ranges.length === 0) return PERMS.slice();
  const maps = permComboMap();
  const out: SuitPerm[] = [];
  for (let p = 0; p < PERMS.length; p++) {
    const map = maps[p] as Uint16Array;
    let ok = true;
    for (const r of ranges) {
      for (let i = 0; i < COMBO_COUNT; i++) {
        if (Math.abs((r[map[i] as number] as number) - (r[i] as number)) > eps) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (ok) out.push(PERMS[p] as SuitPerm);
  }
  return out;
}

/**
 * 레인지들의 stabilizer 안에서만 최소 보드를 고르고, 레인지에도 같은 perm 을 적용한다.
 */
export function canonicalize(
  board: readonly Card[],
  ranges: readonly Range[],
): { board: Card[]; ranges: Range[]; perm: SuitPerm } {
  validateBoard(board);
  if (ranges.length === 0) throw new CardSyntaxError('canonicalize needs at least one range');
  const group = suitStabilizer(ranges);
  const { board: cb, perm } = minimalUnder(board, group);
  return { board: cb, ranges: ranges.map((r) => permuteRangeSuits(r, perm)), perm };
}
