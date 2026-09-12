import { describe, expect, it } from 'vitest';
import {
  IllegalActionError,
  MAX_AMOUNT,
  PreflopConfigError,
  createRng,
  formatAction,
  legalActions,
  parseActionSequence,
  preflopState,
  type Action,
  type PreflopConfig,
} from '../src/index.js';

const SIX_MAX: PreflopConfig = {
  positions: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  blinds: [
    { pos: 'SB', amount: 0.5 },
    { pos: 'BB', amount: 1 },
  ],
  ante: { mode: 'none' },
  stack: 100,
};

const street = (s: string): Action[] => {
  const seq = parseActionSequence(s);
  return seq.length === 0 ? [] : (seq[0] as Action[]);
};

const st = (s: string, cfg: PreflopConfig = SIX_MAX) => preflopState(cfg, street(s));

describe('4.8 preflopState (6max 100bb, SB 0.5 / BB 1)', () => {
  it('4.8 "" → toAct UTG, pot 1.5, currentBet 1, minRaiseTo 2', () => {
    const s = st('');
    expect(s.toAct).toBe('UTG');
    expect(s.pot).toBe(1.5);
    expect(s.currentBet).toBe(1);
    expect(s.minRaiseTo).toBe(2);
    expect(s.isTerminal).toBe(false);
    expect(s.playersIn).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    expect(s.contributions).toEqual({ SB: 0.5, BB: 1 });
  });

  it('4.8 "F-F-R2.5-F-F-R11-C" → terminal, playersIn [CO,BB], pot 22.5', () => {
    const s = st('F-F-R2.5-F-F-R11-C');
    expect(s.isTerminal).toBe(true);
    expect(s.toAct).toBeNull();
    expect(s.playersIn).toEqual(['CO', 'BB']);
    expect(s.pot).toBe(22.5);
    expect(s.contributions).toEqual({ CO: 11, BB: 11, SB: 0.5 });
    expect([...s.folded].sort()).toEqual(['BTN', 'HJ', 'SB', 'UTG']);
  });

  it('4.8 "F-F-R2.5-F-F-R11-C" 의 액터 순서는 UTG,HJ,CO,BTN,SB,BB,CO', () => {
    const tokens = ['F', 'F', 'R2.5', 'F', 'F', 'R11', 'C'];
    const expected = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB', 'CO'];
    for (let k = 0; k < tokens.length; k++) {
      const prefix = tokens.slice(0, k).join('-');
      expect(st(prefix).toAct, prefix).toBe(expected[k]);
    }
  });

  it('4.8 "F-F-F-F-F" → terminal, playersIn [BB], toAct null (BB 워크)', () => {
    const s = st('F-F-F-F-F');
    expect(s.isTerminal).toBe(true);
    expect(s.toAct).toBeNull();
    expect(s.playersIn).toEqual(['BB']);
    expect(s.pot).toBe(1.5);
  });

  it('4.8 "F-F-F-F-C" → toAct BB, legalActions 에 check 포함 / call 미포함', () => {
    const s = st('F-F-F-F-C');
    expect(s.toAct).toBe('BB');
    const legal = legalActions(SIX_MAX, s);
    const kinds = legal.map((a) => a.kind);
    expect(kinds).toContain('check');
    expect(kinds).not.toContain('call');
    expect(kinds).toContain('fold');
    expect(kinds).toContain('raise');
    expect(kinds).toContain('allin');

    const after = st('F-F-F-F-C-X');
    expect(after.isTerminal).toBe(true);
    expect(after.pot).toBe(2);
    expect(after.playersIn).toEqual(['SB', 'BB']);
  });

  // P0.md 4.8 의 이 항목은 문자열("F-F-F-F-R3-R10-R22", F 4개)과 서술("UTG F, HJ F, CO F,
  // BTN R3, SB R10, BB R22" = F 3개)이 서로 어긋난다. 서술 쪽이 자기 정합적이므로
  // (toAct BTN 은 BTN 이 R3 를 쳤을 때만 나온다) 서술을 정본으로 보고 둘 다 못박는다.
  it('4.8 "F-F-F-R3-R10-R22" → 액터 UTG,HJ,CO,BTN,SB,BB → toAct BTN, currentBet 22, minRaiseTo 34', () => {
    const s = st('F-F-F-R3-R10-R22');
    expect(s.toAct).toBe('BTN');
    expect(s.currentBet).toBe(22);
    expect(s.minRaiseTo).toBe(34); // 마지막 증분 22-10 = 12
    expect(s.contributions).toEqual({ BTN: 3, SB: 10, BB: 22 });

    const actors = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    const tokens = ['F', 'F', 'F', 'R3', 'R10', 'R22'];
    for (let k = 0; k < tokens.length; k++) {
      expect(st(tokens.slice(0, k).join('-')).toAct, String(k)).toBe(actors[k]);
    }
  });

  it('4.8 F 4개 버전("F-F-F-F-R3-R10-R22")은 SB 가 R3 를 치므로 toAct 가 BB 다', () => {
    const s = st('F-F-F-F-R3-R10-R22');
    expect(s.toAct).toBe('BB');
    expect(s.currentBet).toBe(22);
    expect(s.minRaiseTo).toBe(34);
    expect(s.contributions).toEqual({ SB: 22, BB: 10 });
  });

  it('4.8 불법 액션: currentBet 존재 시 체크 불가', () => {
    expect(() => st('C-X')).toThrow(IllegalActionError);
    try {
      st('C-X');
    } catch (e) {
      expect(e).toBeInstanceOf(IllegalActionError);
      expect((e as IllegalActionError).index).toBe(1);
      expect((e as IllegalActionError).position).toBe('HJ');
    }
  });

  it('4.8 불법 액션: 최소 레이즈 미만 / 스택 초과 / 종료 후 액션', () => {
    expect(() => st('R1.5')).toThrow(IllegalActionError);
    expect(() => st('R101')).toThrow(IllegalActionError);
    expect(() => st('F-F-F-F-F-C')).toThrow(IllegalActionError);
    // 최소 레이즈 정확히 2 는 합법
    expect(st('R2').currentBet).toBe(2);
  });

  it('4.8 불법 액션: 콜할 게 없으면 call 불가', () => {
    expect(() => st('F-F-F-F-C-C')).toThrow(IllegalActionError);
  });

  it('4.8 2max ["SB","BB"]: "" → toAct SB, "R2.5-C" → terminal pot 5', () => {
    const HU: PreflopConfig = {
      positions: ['SB', 'BB'],
      blinds: [
        { pos: 'SB', amount: 0.5 },
        { pos: 'BB', amount: 1 },
      ],
      ante: { mode: 'none' },
      stack: 100,
    };
    expect(st('', HU).toAct).toBe('SB');
    expect(st('', HU).pot).toBe(1.5);
    const s = st('R2.5-C', HU);
    expect(s.isTerminal).toBe(true);
    expect(s.pot).toBe(5);
    expect(s.contributions).toEqual({ SB: 2.5, BB: 2.5 });
  });

  it('4.8 스트래들: blinds 에 {UTG:2} 추가 시 첫 액터 HJ, currentBet 2, minRaiseTo 4', () => {
    const straddle: PreflopConfig = {
      ...SIX_MAX,
      blinds: [
        { pos: 'SB', amount: 0.5 },
        { pos: 'BB', amount: 1 },
        { pos: 'UTG', amount: 2 },
      ],
    };
    const s = st('', straddle);
    expect(s.toAct).toBe('HJ');
    expect(s.currentBet).toBe(2);
    expect(s.minRaiseTo).toBe(4);
    expect(s.pot).toBe(3.5);
    expect(s.contributions).toEqual({ SB: 0.5, BB: 1, UTG: 2 });
  });

  it('4.8 앤티: bb_ante 1 → pot 2.5, per_player 0.1 (6인) → pot 2.1', () => {
    const bbAnte: PreflopConfig = { ...SIX_MAX, ante: { mode: 'bb_ante', amount: 1 } };
    expect(st('', bbAnte).pot).toBe(2.5);
    const perPlayer: PreflopConfig = { ...SIX_MAX, ante: { mode: 'per_player', amount: 0.1 } };
    expect(st('', perPlayer).pot).toBeCloseTo(2.1, 9);
  });

  it('4.8 legalActions: terminal 이면 빈 배열, raise 금액은 minRaiseTo', () => {
    expect(legalActions(SIX_MAX, st('F-F-F-F-F'))).toEqual([]);
    const open = legalActions(SIX_MAX, st(''));
    expect(open).toContainEqual({ kind: 'fold' });
    expect(open).toContainEqual({ kind: 'call' });
    expect(open).toContainEqual({ kind: 'raise', amount: 2 });
    expect(open).toContainEqual({ kind: 'allin' });
    expect(open.map((a) => a.kind)).not.toContain('check');
  });

  it('4.8 올인 이후 남은 플레이어가 계속 액션할 수 있다', () => {
    const s = st('F-F-A');
    expect(s.toAct).toBe('BTN');
    expect(s.currentBet).toBe(100);
    expect(s.allIn.has('CO')).toBe(true);
    const done = st('F-F-A-C-F-F');
    expect(done.isTerminal).toBe(true);
    expect(done.playersIn).toEqual(['CO', 'BTN']);
    expect(done.pot).toBe(201.5);
  });

  it('4.8 올인 정규형: "R100" 은 IllegalActionError ("A" 로 써라)', () => {
    // 이 문자열은 캐시 키이자 pf_node.action_seq UNIQUE 컬럼이다. 같은 상태에 두 개의
    // 표현("R100" 과 "A")이 있으면 같은 노드가 두 번 저장되고 캐시가 두 번 빗나간다.
    expect(() => st('R100')).toThrow(IllegalActionError);
    expect(() => st('R100')).toThrow(/must be written as A/);
    // 스택 미만은 그대로 합법
    expect(st('R99.5').currentBet).toBe(99.5);
    // 스택 초과는 종전대로 "초과" 에러
    expect(() => st('R101')).toThrow(/exceeds stack/);
  });

  it('4.8 올인 정규형: "A" → UTG allIn, currentBet 100, toAct HJ, legalActions = [fold, call]', () => {
    const s = st('A');
    expect(s.allIn.has('UTG')).toBe(true);
    expect(s.currentBet).toBe(100);
    expect(s.toAct).toBe('HJ');
    expect(s.contributions).toEqual({ UTG: 100, SB: 0.5, BB: 1 });
    // HJ 는 스택 100 을 전부 넣어도 currentBet 을 못 올린다 → allin 은 call 과 결과가 같다
    expect(legalActions(SIX_MAX, s).map((a) => a.kind)).toEqual(['fold', 'call']);
  });

  it('4.8 올인 정규형: "A-A" 는 IllegalActionError ("C" 로 써라)', () => {
    expect(() => st('A-A')).toThrow(IllegalActionError);
    expect(() => st('A-A')).toThrow(/must be written as C/);
  });

  it('4.8 올인 정규형: "A-C" → HJ 도 allIn, pot 201.5', () => {
    const s = st('A-C');
    expect(s.allIn.has('UTG')).toBe(true);
    expect(s.allIn.has('HJ')).toBe(true);
    expect(s.contributions).toEqual({ UTG: 100, HJ: 100, SB: 0.5, BB: 1 });
    expect(s.pot).toBe(201.5);
    expect(s.toAct).toBe('CO');
  });

  it('4.8 올인 정규형: "R99.5" 뒤 legalActions = [fold, call, allin], "R99.5-A" 합법', () => {
    const s = st('R99.5');
    // 올인(100)이 0.5 만큼 레이즈이므로 allin 은 call 과 다른 결과다 → 합법
    expect(legalActions(SIX_MAX, s).map((a) => a.kind)).toEqual(['fold', 'call', 'allin']);
    const after = st('R99.5-A');
    expect(after.currentBet).toBe(100);
    expect(after.allIn.has('HJ')).toBe(true);
    // 최소 증분(98.5) 미만인 올인이라도 합법. minRaiseTo = currentBet + max(0.5, 98.5)
    expect(after.minRaiseTo).toBe(198.5);
  });

  it('4.8 legalActions 에 결과 상태가 같은 액션 두 개가 없다 (무작위 합법 시퀀스 2,000개)', () => {
    const rng = createRng(480808);
    const snap = (x: ReturnType<typeof preflopState>): string =>
      JSON.stringify({
        toAct: x.toAct,
        pot: x.pot,
        contributions: x.contributions,
        folded: [...x.folded].sort(),
        allIn: [...x.allIn].sort(),
        currentBet: x.currentBet,
        minRaiseTo: x.minRaiseTo,
        playersIn: x.playersIn,
        isTerminal: x.isTerminal,
      });

    const configs: PreflopConfig[] = [
      SIX_MAX,
      { ...SIX_MAX, stack: 12 }, // 숏스택: 콜올인/레이즈올인 경계가 자주 나온다
      { ...SIX_MAX, stack: 2.5 },
      { positions: ['SB', 'BB'], blinds: SIX_MAX.blinds, ante: { mode: 'none' }, stack: 20 },
    ];

    let checkedStates = 0;
    let sawAllin = 0;
    for (let trial = 0; trial < 2000; trial++) {
      const cfg = configs[rng.nextInt(configs.length)] as PreflopConfig;
      const taken: Action[] = [];
      for (let depth = 0; depth < 12; depth++) {
        const state = preflopState(cfg, taken);
        if (state.isTerminal) break;
        const legal = legalActions(cfg, state);
        expect(legal.length, `${String(trial)}/${String(depth)}`).toBeGreaterThan(0);

        // 각 합법 액션을 적용한 결과 상태가 전부 서로 달라야 한다
        const seen = new Map<string, string>();
        for (const a of legal) {
          const next = snap(preflopState(cfg, [...taken, a]));
          const dup = seen.get(next);
          expect(
            dup,
            `duplicate result state: ${JSON.stringify(a)} == ${String(dup)} after ${JSON.stringify(taken)}`,
          ).toBeUndefined();
          seen.set(next, JSON.stringify(a));
          if (a.kind === 'allin') sawAllin++;
        }
        checkedStates++;
        taken.push(legal[rng.nextInt(legal.length)] as Action);
      }
    }
    expect(checkedStates).toBeGreaterThan(2000);
    expect(sawAllin).toBeGreaterThan(0);
  });

  it('4.8 잘못된 config 는 throw', () => {
    expect(() => preflopState({ ...SIX_MAX, positions: ['SB'] }, [])).toThrow();
    expect(() => preflopState({ ...SIX_MAX, stack: 0 }, [])).toThrow();
    expect(() =>
      preflopState({ ...SIX_MAX, blinds: [{ pos: 'NOPE', amount: 1 }] }, []),
    ).toThrow();
  });

  // P0 R2 MINOR 1
  it('4.8 포스트 블라인드 >= stack 인 config 는 PreflopConfigError', () => {
    // 리뷰 실측 케이스: stack 0.5 인데 BB 가 1 을 포스트 → BB 는 액션 전에 스택 초과 투입
    expect(() => preflopState({ ...SIX_MAX, stack: 0.5 }, [])).toThrow(PreflopConfigError);
    // stack === BB: BB 가 포스트만으로 이미 올인인데 allIn 집합에 없었다
    expect(() => preflopState({ ...SIX_MAX, stack: 1 }, [])).toThrow(PreflopConfigError);
    // 같은 포지션의 블라인드 항목이 여러 개면 합계로 본다 (스트래들 겹침)
    expect(() =>
      preflopState(
        { ...SIX_MAX, stack: 2, blinds: [{ pos: 'SB', amount: 0.5 }, { pos: 'BB', amount: 1 }, { pos: 'BB', amount: 1 }] },
        [],
      ),
    ).toThrow(PreflopConfigError);
    // 경계 바로 위는 통과해야 한다 (stack 이 BB 보다 크면 정상)
    expect(() => preflopState({ ...SIX_MAX, stack: 1.01 }, [])).not.toThrow();
  });

  // P0 R2 MINOR 6
  it('4.8 stack > MAX_AMOUNT 인 config 는 PreflopConfigError (formatAction 이 못 쓰는 상태 방지)', () => {
    expect(() => preflopState({ ...SIX_MAX, stack: MAX_AMOUNT + 1 }, [])).toThrow(PreflopConfigError);
    expect(() => preflopState({ ...SIX_MAX, stack: MAX_AMOUNT }, [])).not.toThrow();
    // 경계 스택에서 legalActions 가 만든 액션은 전부 문자열로 쓸 수 있어야 한다
    const cfg: PreflopConfig = { ...SIX_MAX, stack: MAX_AMOUNT };
    for (const a of legalActions(cfg, preflopState(cfg, []))) {
      expect(() => formatAction(a)).not.toThrow();
    }
  });

  // P0 R2 MINOR 1: 위반의 실체 — "성공하는 액션은 전부 legalActions 안에 있다" 계약
  it('4.8 성공하는 액션은 legalActions 의 kind 집합 안에 있다 (소형 스택 config 전수)', () => {
    const tokens: Action[] = [
      { kind: 'fold' },
      { kind: 'check' },
      { kind: 'call' },
      { kind: 'allin' },
      ...[0.5, 1, 1.5, 2, 2.5, 3].map((amount): Action => ({ kind: 'raise', amount })),
    ];
    let checked = 0;
    const configs: PreflopConfig[] = [
      { positions: ['SB', 'BB'], blinds: [{ pos: 'SB', amount: 0.5 }, { pos: 'BB', amount: 1 }], ante: { mode: 'none' }, stack: 1.5 },
      { positions: ['SB', 'BB'], blinds: [{ pos: 'SB', amount: 0.5 }, { pos: 'BB', amount: 1 }], ante: { mode: 'none' }, stack: 3 },
      { positions: ['UTG', 'SB', 'BB'], blinds: [{ pos: 'SB', amount: 0.5 }, { pos: 'BB', amount: 1 }], ante: { mode: 'none' }, stack: 2 },
    ];
    for (const cfg of configs) {
      const walk = (prefix: Action[]): void => {
        const state = preflopState(cfg, prefix);
        if (state.isTerminal) return;
        const legalKinds = new Set(legalActions(cfg, state).map((a) => a.kind));
        for (const t of tokens) {
          let ok = true;
          try {
            preflopState(cfg, [...prefix, t]);
          } catch (e) {
            if (!(e instanceof IllegalActionError)) throw e;
            ok = false;
          }
          checked++;
          if (ok) {
            expect(legalKinds.has(t.kind), `${t.kind} succeeded but is not in legalActions`).toBe(true);
          }
        }
        for (const a of legalActions(cfg, state)) walk([...prefix, a]);
      };
      walk([]);
    }
    expect(checked).toBeGreaterThan(100);
  });
});
