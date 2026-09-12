/**
 * 슈트 순열. P0.md 3.6.
 * perm[s] = 원본 슈트 s 가 가는 슈트.
 */

import { CardSyntaxError, type Card } from './card.js';

export type SuitPerm = readonly [number, number, number, number];

export const IDENTITY_PERM: SuitPerm = [0, 1, 2, 3];

function buildAllPerms(): SuitPerm[] {
  const out: SuitPerm[] = [];
  const base = [0, 1, 2, 3];
  // 사전순 생성 → ALL_SUIT_PERMS[0] === IDENTITY_PERM. 동률 정규형 선택이 결정적이 된다.
  for (const a of base) {
    for (const b of base) {
      if (b === a) continue;
      for (const c of base) {
        if (c === a || c === b) continue;
        for (const d of base) {
          if (d === a || d === b || d === c) continue;
          out.push([a, b, c, d]);
        }
      }
    }
  }
  return out;
}

export const ALL_SUIT_PERMS: readonly SuitPerm[] = buildAllPerms();

export function isSuitPerm(p: readonly number[]): boolean {
  if (p.length !== 4) return false;
  const seen = [false, false, false, false];
  for (const v of p) {
    if (!Number.isInteger(v) || v < 0 || v > 3 || seen[v] === true) return false;
    seen[v] = true;
  }
  return true;
}

export function invertPerm(perm: SuitPerm): SuitPerm {
  if (!isSuitPerm(perm)) throw new CardSyntaxError(`not a suit permutation: ${JSON.stringify(perm)}`);
  const inv = [0, 0, 0, 0];
  for (let s = 0; s < 4; s++) inv[perm[s] as number] = s;
  return inv as unknown as SuitPerm;
}

export function composePerm(first: SuitPerm, second: SuitPerm): SuitPerm {
  // (second ∘ first)[s] = second[first[s]]
  return [
    second[first[0] as number] as number,
    second[first[1] as number] as number,
    second[first[2] as number] as number,
    second[first[3] as number] as number,
  ] as const;
}

export function applyPermToCard(c: Card, perm: SuitPerm): Card {
  return (c & ~3) | (perm[c & 3] as number);
}

export function permEquals(a: SuitPerm, b: SuitPerm): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}
