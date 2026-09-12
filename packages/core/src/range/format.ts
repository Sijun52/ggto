/**
 * 레인지 포매터 (정규형). P0.md 3.5.
 *
 * 규칙:
 *  - 클래스 내 전 콤보 가중치가 같으면 클래스 표기, 아니면 콤보 표기.
 *  - 출력 순서: 페어(내림) → 수티드(하이카드 내림, 키커 내림) → 오프수트(같은 순서).
 *  - 연속 동일 가중치 런은 길이 >= 2 일 때만 압축. 최고까지 닿으면 "X+", 아니면 "Hi-Lo".
 *  - 가중치 1 은 생략, 아니면 ":w" (최대 소수 4자리, 후행 0 제거).
 *
 * 가중치 비교는 "4자리로 반올림한 문자열"로 한다. float32 마지막 ULP 차이 때문에
 * 같은 가중치가 콤보 표기로 흩어지는 걸 막으면서, 재파싱 오차는 5e-5 이하로 묶인다
 * (왕복 허용 오차 1e-4 의 절반).
 *
 * 알려진 손실 (P0 R1 MINOR 2, 의도된 동작): 가중치가 0 < w < 0.00005 인 콤보는 4자리
 * 반올림이 0 이 되므로 출력에서 **사라진다** (`AA:0.00004` → `""`). 오차 4e-5 는 3.5 의
 * 왕복 허용치 1e-4 안이다. 이보다 작은 가중치를 보존해야 하는 소비자가 생기면 그때
 * 자릿수를 늘린다 (정규형 문자열이 바뀌므로 캐시 키 마이그레이션을 동반한다).
 */

import { formatCard } from '../card.js';
import { COMBO_HI_TABLE, COMBO_LO_TABLE, type ComboIndex } from '../combo.js';
import {
  HAND_CLASS_COMBOS_TABLE,
  handClassFromRanks,
  handClassName,
} from '../handClass.js';
import { type Range } from './range.js';

/** 가중치를 정규 문자열 키로. "0" 은 "출력하지 않음"을 뜻한다. */
function weightKey(w: number): string {
  if (!(w > 0)) return '0';
  const r = Math.round(w * 10000) / 10000;
  if (r <= 0) return '0';
  if (r >= 1) return '1';
  return String(r);
}

function suffixOf(key: string): string {
  return key === '1' ? '' : `:${key}`;
}

/** 클래스가 균일하면 그 가중치 키, 아니면 null. */
function uniformKey(r: Range, h: number): string | null {
  const combos = HAND_CLASS_COMBOS_TABLE[h] as readonly ComboIndex[];
  const first = weightKey(r[combos[0] as ComboIndex] as number);
  for (let i = 1; i < combos.length; i++) {
    if (weightKey(r[combos[i] as ComboIndex] as number) !== first) return null;
  }
  return first;
}

/** 비균일 클래스를 콤보 표기로. 카드 id 내림차순(hi desc, lo desc). */
function emitCombos(r: Range, h: number, out: string[]): void {
  const combos = HAND_CLASS_COMBOS_TABLE[h] as readonly ComboIndex[];
  for (let i = combos.length - 1; i >= 0; i--) {
    const ci = combos[i] as ComboIndex;
    const key = weightKey(r[ci] as number);
    if (key === '0') continue;
    const hi = COMBO_HI_TABLE[ci] as number;
    const lo = COMBO_LO_TABLE[ci] as number;
    out.push(formatCard(hi) + formatCard(lo) + suffixOf(key));
  }
}

interface Run {
  hi: number; // 런의 높은 쪽 (페어면 랭크, 비페어면 키커 랭크)
  lo: number;
  key: string;
}

function emitPairSection(r: Range, out: string[]): void {
  let run: Run | null = null;
  const flush = (): void => {
    if (run === null) return;
    const len = run.hi - run.lo + 1;
    const nameHi = handClassName(handClassFromRanks(run.hi, run.hi, true));
    const nameLo = handClassName(handClassFromRanks(run.lo, run.lo, true));
    let token: string;
    if (len === 1) token = nameHi;
    else if (run.hi === 12) token = `${nameLo}+`;
    else token = `${nameHi}-${nameLo}`;
    out.push(token + suffixOf(run.key));
    run = null;
  };

  for (let rank = 12; rank >= 0; rank--) {
    const h = handClassFromRanks(rank, rank, true);
    const key = uniformKey(r, h);
    if (key !== null && key !== '0') {
      if (run !== null && run.key === key && run.lo === rank + 1) {
        run.lo = rank;
      } else {
        flush();
        run = { hi: rank, lo: rank, key };
      }
      continue;
    }
    flush();
    if (key === null) emitCombos(r, h, out);
  }
  flush();
}

function emitNonPairSection(r: Range, suited: boolean, out: string[]): void {
  for (let hiRank = 12; hiRank >= 1; hiRank--) {
    let run: Run | null = null;
    const flush = (): void => {
      if (run === null) return;
      const len = run.hi - run.lo + 1;
      const nameHi = handClassName(handClassFromRanks(hiRank, run.hi, suited));
      const nameLo = handClassName(handClassFromRanks(hiRank, run.lo, suited));
      let token: string;
      if (len === 1) token = nameHi;
      else if (run.hi === hiRank - 1) token = `${nameLo}+`;
      else token = `${nameHi}-${nameLo}`;
      out.push(token + suffixOf(run.key));
      run = null;
    };

    for (let k = hiRank - 1; k >= 0; k--) {
      const h = handClassFromRanks(hiRank, k, suited);
      const key = uniformKey(r, h);
      if (key !== null && key !== '0') {
        if (run !== null && run.key === key && run.lo === k + 1) {
          run.lo = k;
        } else {
          flush();
          run = { hi: k, lo: k, key };
        }
        continue;
      }
      flush();
      if (key === null) emitCombos(r, h, out);
    }
    flush();
  }
}

export function formatRange(r: Range): string {
  const out: string[] = [];
  emitPairSection(r, out);
  emitNonPairSection(r, true, out);
  emitNonPairSection(r, false, out);
  return out.join(',');
}
