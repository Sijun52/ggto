/**
 * 캐시 키 (P4.md 3.3 · D5 · D6 · D21).
 *
 * **레인지에도 SuitMap 을 적용한다 (D6).** 보드만 정규화하면 `Ks7h2h + AsKs` 와
 * `Kd7s2s + AsKs` 가 같은 키를 받는다 — 두 번째는 보드와 슈트 관계가 전혀 다른 게임이다.
 * 여기서 해싱하는 레인지는 `canonicalize` 가 이미 perm 을 적용한 것이다.
 *
 * 해시는 `node:crypto` **sha256** 이다 (D21). blake3 는 새 의존성이고, 입력이 11KB 라
 * 해시 속도는 무관하다.
 */

import { createHash } from 'node:crypto';
import { formatCards, type Range } from '@ggto/core';
import type { CanonicalConfig, SolveTicket } from './types.js';

/**
 * 1326 f32 를 hex 로. **부동소수를 문자열로 찍지 않는다**: `0.1` 의 `toString` 은
 * 플랫폼/런타임에 따라 흔들릴 수 있고, f32 비트 패턴은 그렇지 않다. 같은 레인지가
 * 항상 같은 16진 문자열을 낸다.
 */
export function rangeHex(r: Range): string {
  // Float32Array 의 buffer 를 그대로 보면 byteOffset/length 를 잘못 잡을 수 있으므로 뷰로 감싼다.
  const bytes = new Uint8Array(r.buffer, r.byteOffset, r.length * 4);
  return Buffer.from(bytes).toString('hex');
}

/** 정규 JSON 의 버전. `v:1` 에는 `solver` 가 없었다 (P4 R1 MINOR 7) — 캐시가 그 행을 버린다. */
export const CONFIG_JSON_VERSION = 2;

/**
 * 해시의 입력이 되는 정규 JSON. 키는 **사전순 고정**이고, `targetExploitabilityPct` 와
 * `maxIterations` 는 **빠진다** — 정확도는 4.3 의 `≤` 비교로 처리한다 (더 정확한 캐시는
 * 재사용하고, 덜 정확하면 재솔브한다). 둘을 해시에 넣으면 같은 게임이 목표치마다
 * 다른 `.bin` 을 만들어 20GB 가 금방 찬다.
 *
 * **`solverId` 는 들어간다** (P4 R1 MINOR 7): `.bin` 은 그 솔버의 직렬화 형식이고 전략
 * 자체도 엔진마다 다르다. 넣지 않으면 엔진을 바꿨을 때 같은 키로 **다른 엔진의 결과**를
 * 답하고, P6 이 저장할 `Solve{hash,line}` 기록이 어느 엔진의 답이었는지 말할 수 없게 된다.
 * 인자를 옵션으로 두지 않는 이유는 호출부가 조용히 잊는 것을 막기 위해서다.
 */
export function canonicalConfigJson(cfg: CanonicalConfig, solverId: string): string {
  const sizings = cfg.sizings;
  const value = {
    v: CONFIG_JSON_VERSION,
    board: formatCards(cfg.board),
    compressed: cfg.compressed,
    ip: rangeHex(cfg.ranges[1]),
    oop: rangeHex(cfg.ranges[0]),
    pot: cfg.potChips,
    rake:
      cfg.rake.mode === 'none'
        ? { mode: 'none' }
        : { capBb: cfg.rake.capBb, mode: 'pot', pct: cfg.rake.pct },
    sizings: {
      flop: { bet: sizings.flop.bet, raise: sizings.flop.raise },
      river: { bet: sizings.river.bet, raise: sizings.river.raise },
      turn: { bet: sizings.turn.bet, raise: sizings.turn.raise },
    },
    solver: solverId,
    stack: cfg.stackChips,
  };
  // 손으로 유지되는 키 순서에 기대지 않는다.
  //
  // **`JSON.stringify(v, keys)` 를 쓰면 안 된다**: 배열 replacer 는 allowlist 라
  // **모든 깊이**에 적용돼 `sizings.flop.bet` 처럼 목록에 없는 중첩 키를 통째로 지운다.
  // 그러면 `simple` 과 `standard` 가 같은 해시를 받는다 (테스트가 실제로 잡았다).
  return stableStringify(value);
}

/** 키를 재귀적으로 사전순 정렬해 직렬화한다. 배열 순서는 의미가 있으므로 보존한다. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function configHash(cfg: CanonicalConfig, solverId: string): string {
  return createHash('sha256').update(canonicalConfigJson(cfg, solverId), 'utf8').digest('hex');
}

/** 정규 JSON 문자열이 지금 버전인가. 캐시 `repair()` 가 옛 행을 버릴 때 쓴다. */
export function isCurrentConfigJson(json: string): boolean {
  try {
    const v = (JSON.parse(json) as { v?: unknown }).v;
    return v === CONFIG_JSON_VERSION;
  } catch (e) {
    // 깨진 JSON 도 "지금 버전이 아니다" 다 — 행을 버리는 판단은 호출자가 한다.
    if (e instanceof SyntaxError) return false;
    throw e;
  }
}

/**
 * `perm` 은 티켓으로 호출자에게 돌아가지만 **해시에는 안 들어간다** — 같은 게임의 다른
 * 슈트 표기가 같은 해시를 받아야 캐시가 성립한다 (P4.md 3.3-3). 캐시 행에도 저장하지
 * 않는다: 한 해시에 여러 perm 이 대응하므로 저장하면 모순이 생긴다 (4.1).
 */
export function ticketFor(cfg: CanonicalConfig, solverId: string): SolveTicket {
  const canonicalJson = canonicalConfigJson(cfg, solverId);
  return {
    hash: createHash('sha256').update(canonicalJson, 'utf8').digest('hex'),
    perm: cfg.perm,
    canonical: cfg,
    canonicalJson,
  };
}
