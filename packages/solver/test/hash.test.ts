/**
 * P4.md 8.1 — 정규화·해시 (3.3) 와 슈트 순열 왕복 (5.4).
 *
 * D6 의 음성 테스트가 여기 있다: **보드만 정규화하면 서로 다른 게임이 같은 키를 받는다.**
 * 기댓값은 구현이 아니라 포커 규칙에서 온다 — `Ks7h2h` 와 `Kd7s2s` 는 슈트 이름만 바꾼
 * 같은 보드이므로, 레인지가 슈트 대칭이면 같은 게임(같은 해시)이고 `AsKs` 처럼 슈트를
 * 지목한 레인지면 다른 게임(다른 해시)이다.
 */

import { COMBO_COUNT, comboIndex, invertPerm, parseCard, permuteRangeSuits } from '@ggto/core';
import { describe, expect, it } from 'vitest';
import { buildConfig } from '../src/config.js';
import { canonicalConfigJson, configHash } from '../src/hash.js';
import { permuteBoardString, permuteLine, assertCanonicalLine } from '../src/line.js';
import { SolveConfigError, type SolveRequest } from '../src/types.js';

const BASE: SolveRequest = {
  oop: '22+,A2s+,K9s+,QTs+,ATo+,KJo+',
  ip: 'TT-22,AJs-A2s,KTs+,QJs,AQo-ATo',
  board: 'Ks7h2h',
  potBb: 20,
  stackBb: 80,
  sizings: 'simple',
};

const req = (over: Partial<SolveRequest>): SolveRequest => ({ ...BASE, ...over });
const SOLVER = 'test-solver@1';
const hashOf = (over: Partial<SolveRequest>): string => configHash(buildConfig(req(over)), SOLVER);

describe('P4 3.3 캐시 키 — 보드 동형 (D5 · D6)', () => {
  it('P4 3.3 슈트 대칭 레인지면 Ks7h2h · Kd7s2s · Kh7s2s 가 같은 해시다', () => {
    // 이 레인지들은 슈트 이름을 지목하지 않는다 ("K9s+" 는 네 슈트 전부).
    const a = hashOf({ board: 'Ks7h2h' });
    const b = hashOf({ board: 'Kd7s2s' });
    const c = hashOf({ board: 'Kh7s2s' });
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('P4 3.3 (D6 음성) 슈트를 지목한 레인지면 Ks7h2h 와 Kd7s2s 가 다른 해시다', () => {
    // AsKs 는 Ks7h2h 에서 **보드의 K 를 블록**하지만 Kd7s2s 에서는 아니다. 보드만
    // 정규화하고 레인지에 perm 을 안 걸면 이 둘이 같은 키를 받는다 — 서로 다른 게임인데.
    // Ks 는 보드에 있으니 AsQs 를 쓴다: Ks7h2h 는 보드 스페이드 1장, Kd7s2s 는 2장이라
    // 같은 AsQs 도 전혀 다른 게임이다 (플러시 드로 유무).
    const suited: Partial<SolveRequest> = { oop: 'AsQs', ip: 'JhJd' };
    const a = hashOf({ ...suited, board: 'Ks7h2h' });
    const b = hashOf({ ...suited, board: 'Kd7s2s' });
    expect(a).not.toBe(b);
  });

  it('P4 3.3 (알려진 한계) 보드와 레인지를 함께 돌린 표기는 캐시를 **놓친다** — 틀리지는 않는다', () => {
    // s <-> d 를 보드와 레인지에 **동시에** 적용한 것은 사실 같은 게임이다. 그런데
    // D5 의 정규화는 "레인지의 stabilizer 안에서 최소 보드" 라 레인지 자체는 정규화하지
    // 않는다 — 두 표기는 서로 다른 stabilizer 를 가지므로 다른 대표를 고른다.
    //
    // 결과는 **캐시 미스 한 번**이지 오답이 아니다 (서로 다른 게임이 같은 키를 받는 일은
    // 없다 — 그것이 D6 음성 테스트다). 여기에 이 사실을 고정해 두어, 나중에 정규화를
    // "24 순열 전체에서 (board, ranges) 결합 키 최소화" 로 바꾸면 이 테스트가 깨지고
    // 개선을 인지하게 한다.
    const a = hashOf({ oop: 'AsQs', ip: 'JhJd', board: 'Ks7h2h' });
    const b = hashOf({ oop: 'AdQd', ip: 'JhJs', board: 'Kd7h2h' });
    expect(a).not.toBe(b);
  });

  it('P4 3.3 보드·팟·스택·사이징이 바뀌면 해시가 갈라진다', () => {
    const base = hashOf({});
    expect(hashOf({ board: 'Ks7h3h' })).not.toBe(base);
    expect(hashOf({ potBb: 21 })).not.toBe(base);
    expect(hashOf({ stackBb: 81 })).not.toBe(base);
    expect(hashOf({ sizings: 'standard' })).not.toBe(base);
    expect(hashOf({ compressed: true })).not.toBe(base);
    expect(hashOf({ rake: { mode: 'pot', pct: 5, capBb: 3 } })).not.toBe(base);
  });

  it('P4 3.3 targetExploitabilityPct · maxIterations 는 해시에 영향이 없다', () => {
    const base = hashOf({});
    expect(hashOf({ targetExploitabilityPct: 0.1 })).toBe(base);
    expect(hashOf({ maxIterations: 50_000 })).toBe(base);
  });

  it('P4 3.3 정규 JSON 은 키 순서에 불변이고 부동소수를 hex 로 찍는다', () => {
    const json = canonicalConfigJson(buildConfig(BASE), SOLVER);
    const keys = Object.keys(JSON.parse(json) as Record<string, unknown>);
    expect(keys).toEqual([...keys].sort());
    // 레인지는 10진 소수가 아니라 f32 비트 패턴이다 (플랫폼 간 toString 차이를 배제).
    expect(/^[0-9a-f]+$/.test((JSON.parse(json) as { oop: string }).oop)).toBe(true);
    expect((JSON.parse(json) as { oop: string }).oop.length).toBe(COMBO_COUNT * 8);
  });

  it('P4 3.3 사이징 문자열은 공백·순서에 불변이다', () => {
    const a = hashOf({
      sizings: {
        flop: { bet: '75%,33%', raise: '2.5x' },
        turn: { bet: '75%', raise: '2.5x' },
        river: { bet: '75%', raise: '2.5x' },
      },
    });
    const b = hashOf({
      sizings: {
        flop: { bet: ' 33% , 75% ', raise: ' 2.5x ' },
        turn: { bet: '75%', raise: '2.5x' },
        river: { bet: '75%', raise: '2.5x' },
      },
    });
    expect(a).toBe(b);
    expect(a).toBe(hashOf({ sizings: 'simple' }));
  });
});

describe('P4 3.1 buildConfig — 실패 코드', () => {
  it('P4 3.1 각 실패에 고유한 코드를 준다', () => {
    const codeOf = (over: Partial<SolveRequest>): string => {
      try {
        buildConfig(req(over));
        return 'ok';
      } catch (e) {
        return e instanceof SolveConfigError ? e.code : 'other';
      }
    };
    expect(codeOf({ oop: 'T9s+' })).toBe('RangeSyntax'); // D11
    expect(codeOf({ board: 'KsKs2h' })).toBe('BoardSyntax');
    expect(codeOf({ board: 'Ks7h' })).toBe('BoardSyntax');
    expect(codeOf({ potBb: 0 })).toBe('OutOfRange');
    expect(codeOf({ stackBb: 20_000 })).toBe('OutOfRange');
    expect(codeOf({ maxIterations: 5 })).toBe('OutOfRange');
    // 보드가 레인지를 통째로 지우는 경우와 애초에 빈 경우는 다른 코드다.
    expect(codeOf({ oop: 'KsKh' })).toBe('BoardRangeConflict'); // Ks 가 보드에 있어 KsKh 가 죽는다
    expect(codeOf({})).toBe('ok');
  });

  it('P4 3.1 칩 단위는 0.01bb 를 정확히 담는다', () => {
    const cfg = buildConfig(req({ potBb: 20.01, stackBb: 80.5 }));
    expect(cfg.potChips).toBe(2001);
    expect(cfg.stackChips).toBe(8050);
    expect(cfg.chipsPerBb).toBe(100);
  });
});

describe('P4 5.4 슈트 순열 왕복', () => {
  it('P4 5.4 정규 보드에서 받은 1326 배열을 역순열하면 원본 자리로 돌아온다', () => {
    const cfg = buildConfig(req({ oop: 'AsQs', ip: 'JhJd', board: 'Ks7h2h' }));
    const inv = invertPerm(cfg.perm);
    // 원본의 AsQs 콤보가 정규 공간에서 어디로 갔는지 찾는다.
    const original = comboIndex(parseCard('As'), parseCard('Qs'));
    const canonicalSlot = cfg.ranges[0].findIndex((w) => w > 0);
    expect(canonicalSlot).toBeGreaterThanOrEqual(0);
    // 역순열하면 원래 레인지가 나온다.
    const back = permuteRangeSuits(cfg.ranges[0], inv);
    expect(back[original]).toBeGreaterThan(0);
    let nonZero = 0;
    for (const w of back) if (w > 0) nonZero += 1;
    expect(nonZero).toBe(1);
  });

  it('P4 5.4 line 안의 카드와 board 는 순/역순열 왕복이 항등이다', () => {
    const cfg = buildConfig(req({ oop: 'AsQs', ip: 'JhJd', board: 'Ks7h2h' }));
    const inv = invertPerm(cfg.perm);
    for (const line of ['', 'B6.6-C', 'B6.6-C/Qc', 'B6.6-C/Qc/X-B15', 'X-X/2c/X-X/Ad']) {
      expect(permuteLine(permuteLine(line, cfg.perm), inv)).toBe(line);
    }
    expect(permuteBoardString(permuteBoardString('Ks7h2h', cfg.perm), inv)).toBe('Ks7h2h');
  });

  it('P4 5.4 액션 토큰은 순열에 불변이다 (슈트를 모른다)', () => {
    const perm = [1, 0, 3, 2] as const;
    expect(permuteLine('B6.6-C-R22.5-A-F-X', perm)).toBe('B6.6-C-R22.5-A-F-X');
  });

  it('P4 5.4 (D3) 비정규 line 은 거부된다 — `.` 은 구분자가 아니다', () => {
    expect(() => assertCanonicalLine('')).not.toThrow();
    expect(() => assertCanonicalLine('B6.6-C')).not.toThrow();
    expect(() => assertCanonicalLine('B6.6-C/Qc/X')).not.toThrow();
    expect(() => assertCanonicalLine('b33.c')).toThrow(/canonical action token/);
    expect(() => assertCanonicalLine('B6.6.C')).toThrow();
    expect(() => assertCanonicalLine('/B1')).toThrow();
    expect(() => assertCanonicalLine('B1--C')).toThrow();
    expect(() => assertCanonicalLine('B01')).toThrow(); // 선행 0 은 정규형이 아니다
    expect(() => assertCanonicalLine('B1.50')).toThrow(); // 후행 0 은 정규형이 아니다
  });

  it('P5 12 R1-9 소문자 액션 토큰은 전부 거부된다 (대문자 정규형만)', () => {
    // R1 의 뮤턴트가 여기서 살아남았다: `ACTION_RE` 에 `i` 플래그를 붙여도 옛 테스트는
    // `b33.c`(점 때문에 어차피 실패) 하나뿐이라 죽지 않았다. 점 없는 소문자를 박는다.
    for (const bad of ['x', 'c', 'f', 'a', 'b6.6', 'r15', 'X-x', 'X-X/Qc/x']) {
      expect(() => assertCanonicalLine(bad), bad).toThrow(/canonical action token/);
    }
    for (const good of ['X', 'C', 'F', 'A', 'B6.6', 'R15', 'X-X/Qc/X']) {
      expect(() => assertCanonicalLine(good), good).not.toThrow();
    }
  });
});
