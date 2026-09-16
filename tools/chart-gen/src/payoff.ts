/**
 * 지불과 앤티 (P7.md 1.2 · 1.3).
 *
 * 한 판 전체 기준, 터미널 z 에서 올인 집합 J, 폴더 집합 F, 블라인드 b_i:
 * ```
 * Pot(z)  = A + Σ_{i∉J} b_i + |J|·S
 * u_i(z)  = share_i·Pot(z) − c_i(z),   c_i(z) = ante_i + (i∈J ? S : b_i)
 * ```
 * 노드 기준 EV (P2 3.3 `stack_delta_from_node`) 는 `u_i(fold now) = −(ante_i + b_i)` 를 빼서
 * `EV = share_i·Pot − S + b_i` 가 된다. `EV_F ≡ 0` 이다.
 *
 * **지불 텐서를 만들지 않는 이유** (스펙 2.2 의 `payoffMatrices` 시그니처와 다르다):
 * 3-way 터미널의 169³ Float64 텐서는 하나가 38.6MB 이고 9-max 에 84개라 3.2GB 다.
 * 지불은 공유 `share3` 텐서의 **아핀 함수** `share·pot + base` 이므로 계수 두 개만 들고
 * 축약 루프 안에서 곧바로 계산한다. 근사가 아니라 같은 값이다.
 */

import type { PreflopConfig } from '@ggto/core';
import { tablePositions } from '@ggto/preflop';
import type { PushFoldTree, Terminal } from './tree.js';

export type AntePreset = 'none' | 'bba1' | 'pp0.125';

export const ANTE_PRESETS: readonly AntePreset[] = ['none', 'bba1', 'pp0.125'];

export const SB_BLIND = 0.5;
export const BB_BLIND = 1;

/**
 * D36: `stack` = 앤티 납부 후, 포스팅한 블라인드를 포함한 인핸드 스택. 전원 동일.
 * 이 문장이 그대로 `source.params.stackConvention` 에 들어간다.
 */
export const STACK_CONVENTION =
  'stack = in-hand chips incl. posted blind, after ante; equal for all players';

export function isAntePreset(v: string): v is AntePreset {
  return (ANTE_PRESETS as readonly string[]).includes(v);
}

/** 프리셋 → core `PreflopConfig.ante` (P0 형식 그대로). */
export function anteOf(preset: AntePreset): PreflopConfig['ante'] {
  switch (preset) {
    case 'none':
      return { mode: 'none' };
    case 'bba1':
      // 온라인 MTT 표준: BB 가 앤티 1bb 를 대신 낸다. 테이블 사이즈와 무관하게 1bb.
      return { mode: 'bb_ante', amount: 1 };
    case 'pp0.125':
      // 전원 앤티 (100/200/25 관례).
      return { mode: 'per_player', amount: 0.125 };
    default: {
      const never: never = preset;
      throw new RangeError(`unknown ante preset: ${JSON.stringify(never)}`);
    }
  }
}

export interface GameSpec {
  n: number;
  stack: number;
  antePreset: AntePreset;
  config: PreflopConfig;
  /** 앤티 팟 A */
  antePot: number;
  /** 플레이어별 자기 앤티 (게임값에만 나타난다 — EV 에서는 상쇄된다) */
  ante: Float64Array;
  /** 플레이어별 블라인드 (SB 0.5, BB 1, 그 외 0) */
  blind: Float64Array;
  positions: readonly string[];
}

export function gameSpec(n: number, antePreset: AntePreset, stack: number): GameSpec {
  const positions = tablePositions(n);
  const ante = anteOf(antePreset);
  const config: PreflopConfig = {
    positions,
    blinds: [
      { pos: 'SB', amount: SB_BLIND },
      { pos: 'BB', amount: BB_BLIND },
    ],
    ante,
    stack,
  };
  const anteArr = new Float64Array(n);
  const blind = new Float64Array(n);
  blind[n - 2] = SB_BLIND;
  blind[n - 1] = BB_BLIND;
  let antePot = 0;
  if (ante.mode === 'per_player') {
    for (let i = 0; i < n; i++) anteArr[i] = ante.amount;
    antePot = ante.amount * n;
  } else if (ante.mode === 'bb_ante') {
    anteArr[n - 1] = ante.amount;
    antePot = ante.amount;
  }
  return { n, stack, antePreset, config, antePot, ante: anteArr, blind, positions };
}

/** `Pot(z) = A + Σ_{i∉J} b_i + |J|·S`. 전원 폴드(J 가 빔)면 A + 0.5 + 1 이다. */
export function potOf(terminal: Terminal, spec: GameSpec): number {
  let pot = spec.antePot + terminal.J.length * spec.stack;
  const inJ = new Set(terminal.J);
  for (let i = 0; i < spec.n; i++) {
    if (!inJ.has(i)) pot += spec.blind[i] as number;
  }
  return pot;
}

export interface TerminalPayoff {
  pot: number;
  /**
   * 노드 기준 EV 의 상수항: `base[i] = −S + b_i` (i ∈ J). EV = share_i·pot + base[i].
   * i ∉ J 는 NaN — 쓰면 안 된다는 뜻이다.
   */
  base: Float64Array;
  /** 한 판 전체 기준 지불의 상수항: `absBase[i] = −c_i(z)` */
  absBase: Float64Array;
}

/** 터미널마다 팟과 아핀 계수를 미리 잰다 (1.3). */
export function terminalPayoffs(tree: PushFoldTree, spec: GameSpec): TerminalPayoff[] {
  return tree.terminals.map((z) => {
    const pot = potOf(z, spec);
    const base = new Float64Array(spec.n).fill(Number.NaN);
    const absBase = new Float64Array(spec.n);
    const inJ = new Set(z.J);
    for (let i = 0; i < spec.n; i++) {
      const contributed = (spec.ante[i] as number) + (inJ.has(i) ? spec.stack : (spec.blind[i] as number));
      absBase[i] = -contributed;
      if (inJ.has(i)) base[i] = -spec.stack + (spec.blind[i] as number);
    }
    // 전원 폴드 터미널은 히어로의 결정 노드가 없다 — base 는 전부 NaN 으로 남는다.
    return { pot, base, absBase };
  });
}

/** `u_i(fold now) = −(ante_i + b_i)` — 노드 기준 EV 의 기준점 (P2 3.3). */
export function foldNowValue(spec: GameSpec, player: number): number {
  return -((spec.ante[player] as number) + (spec.blind[player] as number));
}
