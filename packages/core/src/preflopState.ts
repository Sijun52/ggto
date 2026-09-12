/**
 * 프리플랍 상태 기계. P0.md 4.8.
 *
 * 액션 시퀀스 문자열에는 포지션이 없다. 누가 행동하는지는 이 상태 기계가 정한다
 * (그래야 같은 문자열이 항상 같은 게임을 가리키고 캐시 키로 쓸 수 있다).
 */

import type { Action, Street } from './action.js';
import { MAX_AMOUNT, formatAction } from './action.js';

export interface PreflopConfig {
  /** 액션 순서. 6max: ["UTG","HJ","CO","BTN","SB","BB"]. 2max: ["SB","BB"] */
  positions: readonly string[];
  /** [{pos:"SB",amount:0.5},{pos:"BB",amount:1}]. 스트래들은 항목 추가 (마지막이 가장 늦은 블라인드) */
  blinds: readonly { pos: string; amount: number }[];
  ante: { mode: 'none' } | { mode: 'per_player'; amount: number } | { mode: 'bb_ante'; amount: number };
  /** 유효 스택 (bb). 전원 동일 (P0 범위) */
  stack: number;
}

export interface PreflopState {
  /** null = 프리플랍 종료 */
  toAct: string | null;
  pot: number;
  /** 포지션별 이번 스트리트 투입 (블라인드 포함). 투입 0인 포지션은 키가 없다. */
  contributions: Record<string, number>;
  folded: ReadonlySet<string>;
  allIn: ReadonlySet<string>;
  currentBet: number;
  minRaiseTo: number;
  playersIn: string[];
  actionsTaken: Action[];
  isTerminal: boolean;
}

export class IllegalActionError extends Error {
  readonly index: number;
  readonly position: string | null;
  constructor(index: number, position: string | null, reason: string) {
    super(`illegal action #${String(index)} by ${position ?? '(nobody: hand is over)'}: ${reason}`);
    this.name = 'IllegalActionError';
    this.index = index;
    this.position = position;
  }
}

export class PreflopConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreflopConfigError';
  }
}

const EPS = 1e-9;

function validateConfig(config: PreflopConfig): void {
  if (config.positions.length < 2) {
    throw new PreflopConfigError('need at least 2 positions');
  }
  const seen = new Set<string>();
  for (const p of config.positions) {
    if (seen.has(p)) throw new PreflopConfigError(`duplicate position ${JSON.stringify(p)}`);
    seen.add(p);
  }
  if (config.blinds.length === 0) throw new PreflopConfigError('need at least one blind');
  for (const b of config.blinds) {
    if (!seen.has(b.pos)) throw new PreflopConfigError(`blind position ${JSON.stringify(b.pos)} is not in positions`);
    if (!(b.amount > 0)) throw new PreflopConfigError(`blind amount must be > 0: ${String(b.amount)}`);
  }
  if (!(config.stack > 0)) throw new PreflopConfigError(`stack must be > 0: ${String(config.stack)}`);
  // P0 R2 MINOR 6: stack > MAX_AMOUNT 이면 합법 레이즈의 formatAction 이 ActionSyntaxError 를
  // 던진다 (상태 기계가 만든 액션을 문자열로 못 쓰는 상태). config 단계에서 막는다.
  if (config.stack > MAX_AMOUNT) {
    throw new PreflopConfigError(`stack must be <= ${String(MAX_AMOUNT)}: ${String(config.stack)}`);
  }
  if (config.ante.mode !== 'none' && !(config.ante.amount >= 0)) {
    throw new PreflopConfigError(`ante amount must be >= 0: ${String(config.ante.amount)}`);
  }
  // P0 R2 MINOR 1 (P0.md 4.8): 포스트한 블라인드 합계가 stack 이상인 포지션이 있으면
  // 그 포지션은 액션하기 전에 이미 올인이거나 스택을 초과 투입한 상태가 된다.
  // 그러면 legalActions 가 [F] 만 주는데 call 은 성공하는 등 "legalActions ⊇ 성공 액션"
  // 계약이 깨진다. 실사용 config(100bb) 에서는 발생하지 않지만 계약 위반이므로 거부한다.
  const posted = new Map<string, number>();
  for (const b of config.blinds) {
    posted.set(b.pos, (posted.get(b.pos) ?? 0) + b.amount);
  }
  for (const [pos, amount] of posted) {
    if (amount >= config.stack - EPS) {
      throw new PreflopConfigError(
        `posted blinds for ${JSON.stringify(pos)} (${String(amount)}) must be < stack (${String(config.stack)})`,
      );
    }
  }
}

interface Engine {
  readonly config: PreflopConfig;
  readonly n: number;
  contrib: Float64Array;
  folded: boolean[];
  allIn: boolean[];
  acted: boolean[];
  currentBet: number;
  lastRaiseSize: number;
  antePot: number;
  cursor: number;
}

function anteTotal(config: PreflopConfig): number {
  switch (config.ante.mode) {
    case 'none':
      return 0;
    case 'per_player':
      return config.ante.amount * config.positions.length;
    case 'bb_ante':
      return config.ante.amount;
    default: {
      const never: never = config.ante;
      throw new PreflopConfigError(`unknown ante mode: ${JSON.stringify(never)}`);
    }
  }
}

function createEngine(config: PreflopConfig): Engine {
  const n = config.positions.length;
  const contrib = new Float64Array(n);
  let currentBet = 0;
  let maxBlind = 0;
  for (const b of config.blinds) {
    const i = config.positions.indexOf(b.pos);
    contrib[i] = (contrib[i] as number) + b.amount;
    if ((contrib[i] as number) > currentBet) currentBet = contrib[i] as number;
    if (b.amount > maxBlind) maxBlind = b.amount;
  }
  // 첫 액터 = 마지막 블라인드/스트래들 다음 포지션
  const lastBlindPos = (config.blinds[config.blinds.length - 1] as { pos: string }).pos;
  const cursor = (config.positions.indexOf(lastBlindPos) + 1) % n;

  return {
    config,
    n,
    contrib,
    folded: new Array<boolean>(n).fill(false),
    allIn: new Array<boolean>(n).fill(false),
    acted: new Array<boolean>(n).fill(false),
    currentBet,
    // 첫 레이즈의 최소 증분은 가장 큰 블라인드(스트래들 포함) 1개.
    lastRaiseSize: maxBlind,
    antePot: anteTotal(config),
    cursor,
  };
}

function needsToAct(e: Engine, i: number): boolean {
  if (e.folded[i] === true) return false;
  if (e.allIn[i] === true) return false;
  return e.acted[i] !== true;
}

function activeCount(e: Engine): number {
  let n = 0;
  for (let i = 0; i < e.n; i++) if (e.folded[i] !== true) n++;
  return n;
}

/** 다음 액터 인덱스. 없으면 -1. */
function nextActor(e: Engine): number {
  if (activeCount(e) <= 1) return -1;
  for (let k = 0; k < e.n; k++) {
    const i = (e.cursor + k) % e.n;
    if (needsToAct(e, i)) return i;
  }
  return -1;
}

function minRaiseTo(e: Engine): number {
  return e.currentBet + e.lastRaiseSize;
}

function applyAction(e: Engine, i: number, a: Action, index: number): void {
  const pos = e.config.positions[i] as string;
  const stack = e.config.stack;
  const own = e.contrib[i] as number;

  switch (a.kind) {
    case 'fold': {
      e.folded[i] = true;
      e.acted[i] = true;
      break;
    }
    case 'check': {
      if (own < e.currentBet - EPS) {
        throw new IllegalActionError(
          index,
          pos,
          `cannot check facing a bet (contributed ${String(own)}, current bet ${String(e.currentBet)})`,
        );
      }
      e.acted[i] = true;
      break;
    }
    case 'call': {
      if (own >= e.currentBet - EPS) {
        throw new IllegalActionError(index, pos, 'nothing to call; use check ("X")');
      }
      const to = Math.min(e.currentBet, stack);
      e.contrib[i] = to;
      if (to >= stack - EPS) e.allIn[i] = true;
      e.acted[i] = true;
      break;
    }
    case 'bet': {
      // 이 분기 전체는 프리플랍에서 도달 불가다: validateConfig 가 블라인드를 최소 1개 요구하므로
      // 항상 currentBet > 0 이고 바로 아래 줄에서 throw 된다. 아래 규칙들(풀스택 B<stack> 금지 포함)은
      // P4 포스트플랍 상태 기계가 상속할 정규형 규칙을 선반영한 것이며 P0 테스트로 커버되지 않는다
      // (P0.md 4.8, R2 반박 3 / MINOR 4).
      if (e.currentBet > EPS) {
        throw new IllegalActionError(index, pos, 'there is already a bet on this street; use raise ("R")');
      }
      if (a.amount > stack + EPS) {
        throw new IllegalActionError(index, pos, `bet ${String(a.amount)} exceeds stack ${String(stack)}`);
      }
      // 올인 정규형 (P0.md 4.8): 스택 전부를 넣는 공격의 문자열은 오직 "A" 다.
      // "B<stack>" 을 허용하면 같은 상태에 두 개의 캐시 키가 생긴다.
      if (a.amount >= stack - EPS) {
        throw new IllegalActionError(index, pos, 'bet of the full stack must be written as A');
      }
      e.contrib[i] = a.amount;
      e.currentBet = a.amount;
      e.lastRaiseSize = a.amount;
      e.acted.fill(false);
      e.acted[i] = true;
      break;
    }
    case 'raise': {
      const min = minRaiseTo(e);
      if (a.amount > stack + EPS) {
        throw new IllegalActionError(index, pos, `raise to ${String(a.amount)} exceeds stack ${String(stack)}`);
      }
      // 올인 정규형 (P0.md 4.8): "R<stack>" 과 "A" 는 같은 상태를 만든다. 이 문자열이
      // 캐시 키이자 pf_node.action_seq UNIQUE 컬럼이므로 표현은 정확히 하나여야 한다.
      if (a.amount >= stack - EPS) {
        throw new IllegalActionError(index, pos, 'raise to the full stack must be written as A');
      }
      if (a.amount < min - EPS) {
        throw new IllegalActionError(
          index,
          pos,
          `raise to ${String(a.amount)} is below the minimum raise-to ${String(min)}`,
        );
      }
      e.lastRaiseSize = a.amount - e.currentBet;
      e.currentBet = a.amount;
      e.contrib[i] = a.amount;
      e.acted.fill(false);
      e.acted[i] = true;
      break;
    }
    case 'allin': {
      if (own >= stack - EPS) {
        throw new IllegalActionError(index, pos, 'player is already all-in');
      }
      // 올인 정규형 (P0.md 4.8): "A" 는 레이즈가 될 때만 합법하다. 스택이 currentBet 이하라
      // 베팅을 올리지 못하는 콜 올인은 "C" 와 결과 상태가 완전히 같으므로 "C" 로 쓴다.
      if (stack <= e.currentBet + EPS) {
        throw new IllegalActionError(
          index,
          pos,
          `all-in that does not raise must be written as C ` +
            `(stack ${String(stack)} <= current bet ${String(e.currentBet)})`,
        );
      }
      // 공격적 올인: 레이즈로 취급 (최소 레이즈 증분 미만이어도 올인은 합법)
      e.lastRaiseSize = Math.max(stack - e.currentBet, e.lastRaiseSize);
      e.currentBet = stack;
      e.contrib[i] = stack;
      e.acted.fill(false);
      e.allIn[i] = true;
      e.acted[i] = true;
      break;
    }
    default: {
      const never: never = a;
      throw new IllegalActionError(index, pos, `unknown action ${JSON.stringify(never)}`);
    }
  }
  e.cursor = (i + 1) % e.n;
}

function snapshot(e: Engine, actions: readonly Action[]): PreflopState {
  const nextIdx = nextActor(e);
  const contributions: Record<string, number> = {};
  let pot = e.antePot;
  for (let i = 0; i < e.n; i++) {
    const c = e.contrib[i] as number;
    pot += c;
    if (c > 0) contributions[e.config.positions[i] as string] = c;
  }
  const folded = new Set<string>();
  const allIn = new Set<string>();
  const playersIn: string[] = [];
  for (let i = 0; i < e.n; i++) {
    const p = e.config.positions[i] as string;
    if (e.folded[i] === true) folded.add(p);
    else playersIn.push(p);
    if (e.allIn[i] === true) allIn.add(p);
  }
  return {
    toAct: nextIdx < 0 ? null : (e.config.positions[nextIdx] as string),
    pot,
    contributions,
    folded,
    allIn,
    currentBet: e.currentBet,
    minRaiseTo: minRaiseTo(e),
    playersIn,
    actionsTaken: actions.slice(),
    isTerminal: nextIdx < 0,
  };
}

export function preflopState(config: PreflopConfig, seq: Street): PreflopState {
  validateConfig(config);
  const e = createEngine(config);
  for (let k = 0; k < seq.length; k++) {
    const i = nextActor(e);
    if (i < 0) {
      throw new IllegalActionError(
        k,
        null,
        `preflop is already over, cannot apply ${formatAction(seq[k] as Action)}`,
      );
    }
    applyAction(e, i, seq[k] as Action, k);
  }
  return snapshot(e, seq);
}

/**
 * 합법 액션 목록. 금액은 minRaiseTo 만 넣는다 (사이즈 후보 열거는 호출 측 몫).
 */
export function legalActions(config: PreflopConfig, state: PreflopState): Action[] {
  validateConfig(config);
  if (state.toAct === null) return [];
  const pos = state.toAct;
  const own = state.contributions[pos] ?? 0;
  const stack = config.stack;
  const out: Action[] = [];

  out.push({ kind: 'fold' });
  if (own >= state.currentBet - EPS) out.push({ kind: 'check' });
  else if (stack > own + EPS) out.push({ kind: 'call' });

  if (stack > own + EPS) {
    const min = state.minRaiseTo;
    if (state.currentBet <= EPS) {
      if (min < stack - EPS) out.push({ kind: 'bet', amount: min });
    } else if (min < stack - EPS) {
      out.push({ kind: 'raise', amount: min });
    }
    // 올인은 레이즈가 될 때만 목록에 넣는다. stack <= currentBet 이면 "A" 와 "C" 의 결과
    // 상태가 동일해서 트레이너가 EV 가 같은 선택지 두 개를 출제하게 된다 (P0.md 4.8).
    if (stack > state.currentBet + EPS) out.push({ kind: 'allin' });
  }
  return out;
}
