/**
 * 169×169 표의 **전수** 계산 (P3.md 10.0 = P2 R1 MINOR 4).
 *
 * 클래스 쌍 (A,B) 의 에퀴티는 "카드가 겹치지 않는 콤보 순서쌍 (a,b) 전부에 대한 평균"
 * 으로 정의된다 (pushFold 의 가중치 w(h,v) 가 바로 그 쌍의 개수다).
 *
 * 그 평균을 콤보 쌍 전부로 돌리면 쌍마다 최대 12×12 번의 C(48,5) 전수가 필요하다.
 * 슈트 순열이 프리플랍 게임의 자기동형이라는 사실로 줄인다:
 *
 *   1. 임의의 a 에 대해 σ(a₀) = a 인 슈트 순열 σ 가 있고, equity(a,b) = equity(a₀, σ⁻¹(b)) 이며
 *      σ⁻¹ 은 "a 와 안 겹치는 B 콤보" 를 "a₀ 와 안 겹치는 B 콤보" 위로 전단사한다.
 *      → b 에 대한 평균은 a 를 무엇으로 잡든 같다. 대표 a₀ 하나만 돌리면 된다.
 *   2. a₀ 를 고정하는 부분군(stabilizer) 안에서 b 들을 궤도로 묶는다. 같은 궤도의 b 는
 *      equity 가 같으므로 대표 하나만 계산하고 궤도 크기를 가중치로 쓴다.
 *
 * 남는 계산량: 14,196 쌍 × 궤도 1~7개 = 46,683 번의 C(48,5) 전수.
 * 근사가 아니다 — 위 두 단계는 등식이고, 각 궤도 대표의 값은 core 의 전수 hand-vs-hand 다.
 */

import {
  ALL_SUIT_PERMS,
  applyPermToCard,
  comboCards,
  comboIndex,
  equityHandVsHand,
  handClassCombos,
  type Card,
  type ComboIndex,
  type SuitPerm,
} from '@ggto/core';

/** 클래스의 대표 콤보. core 가 주는 첫 번째 콤보 (규약이 바뀌어도 대표성은 유지된다). */
export function classRepresentative(handClass: number): ComboIndex {
  const combos = handClassCombos(handClass);
  const first = combos[0];
  if (first === undefined) throw new Error(`hand class ${String(handClass)} has no combos`);
  return first;
}

function permCombo(combo: ComboIndex, p: SuitPerm): ComboIndex {
  const [hi, lo] = comboCards(combo);
  return comboIndex(applyPermToCard(hi, p), applyPermToCard(lo, p));
}

/** combo 를 자기 자신으로 보내는 슈트 순열들. 페어 4개 / 수티드 6개 / 오프수트 2개. */
export function comboStabilizer(combo: ComboIndex): SuitPerm[] {
  return ALL_SUIT_PERMS.filter((p) => permCombo(combo, p) === combo);
}

export interface Orbit {
  rep: ComboIndex;
  /** 궤도 크기 = 이 대표가 대변하는 빌런 콤보 수 */
  weight: number;
}

/**
 * hero 와 카드가 겹치지 않는 villainClass 의 콤보들을, hero 의 stabilizer 궤도로 분할한다.
 * Σ weight = 겹치지 않는 콤보 수 (테스트가 고정한다).
 */
export function villainOrbits(hero: ComboIndex, villainClass: number): Orbit[] {
  const [hhi, hlo] = comboCards(hero);
  const stab = comboStabilizer(hero);
  const seen = new Set<number>();
  const out: Orbit[] = [];
  for (const b of handClassCombos(villainClass)) {
    const [bhi, blo] = comboCards(b);
    if (bhi === hhi || bhi === hlo || blo === hhi || blo === hlo) continue;
    if (seen.has(b)) continue;
    const orbit = new Set<number>();
    for (const p of stab) orbit.add(permCombo(b, p));
    for (const o of orbit) seen.add(o);
    out.push({ rep: b, weight: orbit.size });
  }
  return out;
}

/** 어느 쪽을 hero 로 두면 궤도가 적은가. stabilizer 가 큰 쪽 (수티드 6 > 페어 4 > 오프수트 2). */
export function preferHero(a: number, b: number): { hero: number; villain: number; flipped: boolean } {
  const sa = comboStabilizer(classRepresentative(a)).length;
  const sb = comboStabilizer(classRepresentative(b)).length;
  return sa >= sb ? { hero: a, villain: b, flipped: false } : { hero: b, villain: a, flipped: true };
}

/**
 * (a,b) 쌍의 equity 를 임의의 "슈트 동변(equivariant) 함수" 로 궤도 평균한다.
 * 실계산은 `f = equityHandVsHand` 이고, 테스트는 싼 동변 함수를 넣어 궤도 분해 자체를 검증한다.
 */
export function orbitAverage(
  heroClass: number,
  villainClass: number,
  f: (hero: readonly [Card, Card], villain: readonly [Card, Card]) => number,
): number {
  const hero = classRepresentative(heroClass);
  const orbits = villainOrbits(hero, villainClass);
  if (orbits.length === 0) {
    throw new Error(
      `hand classes ${String(heroClass)} and ${String(villainClass)} share all cards: no valid matchup`,
    );
  }
  const h = comboCards(hero);
  let acc = 0;
  let total = 0;
  for (const { rep, weight } of orbits) {
    acc += weight * f(h, comboCards(rep));
    total += weight;
  }
  return acc / total;
}

/** 클래스 i 의 클래스 j 대비 프리플랍 에퀴티. 전수 (C(48,5) = 1,712,304 런아웃 × 궤도 수). */
export function exactClassEquity(i: number, j: number): number {
  if (i === j) return 0.5; // 대칭성. 같은 클래스끼리의 평균은 정의상 정확히 0.5 다.
  const { hero, villain, flipped } = preferHero(i, j);
  const v = orbitAverage(hero, villain, (h, b) => equityHandVsHand(h, b, []).equity);
  return flipped ? 1 - v : v;
}
