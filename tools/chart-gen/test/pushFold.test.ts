import { resolve } from 'node:path';
import { COMBO_COUNT, comboCards, handClassCombos, parseHandClass } from '@ggto/core';
import {
  CLASS_KEYS,
  formatGgtoJson,
  openRepository,
  parseGgtoJson,
  toGgtoJson,
  validateChart,
} from '@ggto/preflop';
import { describe, expect, it } from 'vitest';
import { loadEquityTable } from '../src/equityTable.js';
import { EXPLOITABILITY_GATE_BB, PUSH_FOLD_STACKS, pushFoldChart } from '../src/chart.js';
import { jamCombos, pairCounts, solvePushFold } from '../src/pushFold.js';

const table = loadEquityTable(resolve(import.meta.dirname, '../data/equity169.json'));
const w = pairCounts();
const solved = PUSH_FOLD_STACKS.map((stack) => ({
  stack,
  ...pushFoldChart(table, { stack, generatorVersion: 'test' }),
}));

function freq(stack: number, seq: '' | 'A', hand: string): number {
  const entry = solved.find((s) => s.stack === stack);
  const node = entry?.doc.nodes.find((n) => n.seq === seq);
  return (node?.strategy[hand] as number[])[1] as number;
}

describe('7.1 손패 분포 (카드 제거)', () => {
  it('7.1 클래스 쌍 콤보 수의 합 = 1326 x 1225 (충돌 제외 순서쌍 전수)', () => {
    let sum = 0;
    for (const x of w) sum += x;
    // 히어로 콤보 1326 개 각각에 대해 남은 50 장으로 만드는 상대 콤보 C(50,2)=1225 개
    expect(sum).toBe(COMBO_COUNT * ((50 * 49) / 2));
    expect(sum).toBe(1326 * 1225);
  });

  it('7.1 AA 대 AA 는 6콤보 중 서로 겹치지 않는 순서쌍만 남는다', () => {
    const aa = CLASS_KEYS.indexOf('AA');
    // AsAh 와 겹치지 않는 AA 콤보는 AdAc 하나뿐 → 6 x 1 = 6
    expect(w[aa * 169 + aa]).toBe(6);
    // AA vs KK 는 겹치는 카드가 없으므로 6 x 6 = 36
    const kk = CLASS_KEYS.indexOf('KK');
    expect(w[aa * 169 + kk]).toBe(36);
    // AKs vs AKo: AKs 4콤보 x AKo 12콤보 중 A 나 K 를 공유하는 것을 뺀다
    const aks = CLASS_KEYS.indexOf('AKs');
    const ako = CLASS_KEYS.indexOf('AKo');
    let expected = 0;
    for (const c1 of handClassCombos(parseHandClass('AKs'))) {
      for (const c2 of handClassCombos(parseHandClass('AKo'))) {
        const s1 = new Set<number>(comboCards(c1));
        if (comboCards(c2).every((x) => !s1.has(x))) expected++;
      }
    }
    expect(w[aks * 169 + ako]).toBe(expected);
  });
});

describe('7.1 성질 게이트', () => {
  it('7.1 (d) 모든 스택에서 exploitability 가 게이트 아래다', () => {
    for (const { stack, solve } of solved) {
      expect(solve.exploitabilityBb, `${String(stack)}bb`).toBeLessThan(EXPLOITABILITY_GATE_BB);
      // 실제로는 1e-7 급이어야 한다 (게이트에 겨우 걸치면 수렴이 안 된 것)
      expect(solve.exploitabilityBb).toBeLessThan(1e-5);
      expect(solve.nashConvBb).toBeLessThan(EXPLOITABILITY_GATE_BB);
    }
  });

  it('7.1 (a) 모든 스택에서 AA 는 SB 잼 100%, BB 콜 100%', () => {
    for (const { stack } of solved) {
      expect(freq(stack, '', 'AA'), `${String(stack)}bb SB AA`).toBe(1);
      expect(freq(stack, 'A', 'AA'), `${String(stack)}bb BB AA`).toBe(1);
    }
    // KK/QQ 도 마찬가지여야 한다 (푸시/폴드에서 프리미엄은 항상 순수 전략)
    for (const { stack } of solved) {
      expect(freq(stack, '', 'KK')).toBe(1);
      expect(freq(stack, 'A', 'KK')).toBe(1);
    }
  });

  it('7.1 (b) 스택이 줄수록 SB 잼 레인지(1326 가중)가 단조 증가한다', () => {
    const sizes = solved.map((s) => ({ stack: s.stack, combos: jamCombos(s.solve.sbJam) }));
    for (let i = 1; i < sizes.length; i++) {
      const prev = sizes[i - 1] as { stack: number; combos: number };
      const cur = sizes[i] as { stack: number; combos: number };
      expect(cur.combos, `${String(prev.stack)}bb=${String(prev.combos)} -> ${String(cur.stack)}bb=${String(cur.combos)}`).toBeLessThan(prev.combos);
    }
    // 절대 수준도 상식 범위에 있어야 한다 (5bb 는 광범위, 20bb 는 절반 이하)
    expect((sizes[0] as { combos: number }).combos / COMBO_COUNT).toBeGreaterThan(0.6);
    expect((sizes[sizes.length - 1] as { combos: number }).combos / COMBO_COUNT).toBeLessThan(0.5);
  });

  it('7.1 (c) 20bb 에서 72o 잼 0%', () => {
    expect(freq(20, '', '72o')).toBe(0);
    // 이 스택 구간 전체에서 72o 는 0% 다. (72o 가 균형 잼 레인지에 들어오는 것은
    // 2~3bb 구간이고 7.1 의 최소 스택은 5bb 다 — 5bb 에서 0% 인 것은 정상이다.)
    for (const { stack } of solved) expect(freq(stack, '', '72o'), `${String(stack)}bb`).toBe(0);
  });

  it('7.1 (e) 같은 입력이면 바이트 동일 출력 (결정적)', () => {
    const a = pushFoldChart(table, { stack: 10, generatorVersion: 'test' }).doc;
    const b = pushFoldChart(table, { stack: 10, generatorVersion: 'test' }).doc;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(formatGgtoJson(b)).toBe(formatGgtoJson(a));
  });

  it('7.1 EV 부호 상식: AA 잼 EV > 0, 72o 20bb 잼 EV < 0, 폴드 EV 는 정확히 0', () => {
    const doc = (solved.find((s) => s.stack === 20) as { doc: { nodes: { seq: string; ev?: Record<string, number[]> }[] } }).doc;
    const root = doc.nodes.find((n) => n.seq === '');
    expect((root?.ev?.['AA'] as number[])[1]).toBeGreaterThan(0);
    expect((root?.ev?.['72o'] as number[])[1]).toBeLessThan(0);
    for (const key of CLASS_KEYS) expect((root?.ev?.[key] as number[])[0]).toBe(0);
  });

  it('7.1 EV 와 전략의 일관성: 잼 EV > 0 이면 잼 100%, < 0 이면 0% (균형의 정의)', () => {
    for (const { stack, doc } of solved) {
      const root = doc.nodes.find((n) => n.seq === '');
      for (const key of CLASS_KEYS) {
        const ev = (root?.ev?.[key] as number[])[1] as number;
        const p = (root?.strategy[key] as number[])[1] as number;
        // 폴드 EV 가 0 이므로 잼 EV 의 부호가 곧 최적 액션이다. 경계(|EV| < 0.002bb)는 혼합 허용.
        // CFR+ 평균 전략은 초기 반복의 잔차를 남긴다 (순수해가 0.999813 처럼 찍힌다).
        // 잔차는 그 핸드가 무차별점에서 얼마나 먼지에 반비례하므로 두 단계로 본다.
        const why = `${String(stack)}bb ${key} ev=${String(ev)} p=${String(p)}`;
        if (ev > 0.05) expect(Math.abs(1 - p), why).toBeLessThan(1e-3);
        else if (ev > 0.002) expect(p, why).toBeGreaterThan(0.99);
        if (ev < -0.05) expect(Math.abs(p), why).toBeLessThan(1e-3);
        else if (ev < -0.002) expect(p, why).toBeLessThan(0.01);
      }
    }
  });
});

describe('7.1 독립 재계산 대조 (같은 표, 다른 경로)', () => {
  it('7.1 SB 잼 EV 를 정의식으로 다시 계산하면 파일 값과 1e-6 안에서 같다', () => {
    // 파일의 EV 를 만든 코드와 다른 식으로 계산한다:
    //   EV_A[h] = Σ_v p(v|h) [ (1-c_v)·1.5 + c_v·(2S·eq - (S-0.5)) ]
    const S = 10;
    const entry = solved.find((s) => s.stack === S);
    const solve = entry?.solve;
    const root = entry?.doc.nodes.find((n) => n.seq === '');
    for (const name of ['AA', 'AKs', '72o', 'T9s', '44']) {
      const h = CLASS_KEYS.indexOf(name);
      let num = 0;
      let den = 0;
      for (let v = 0; v < 169; v++) {
        const weight = w[h * 169 + v] as number;
        if (weight === 0) continue;
        const c = (solve?.bbCall[v] as number);
        const eq = (table.equity[h] as number[])[v] as number;
        num += weight * ((1 - c) * 1.5 + c * (2 * S * eq - (S - 0.5)));
        den += weight;
      }
      const expected = num / den;
      const actual = (root?.ev?.[name] as number[])[1] as number;
      expect(Math.abs(actual - expected), `${name}: ${String(actual)} vs ${String(expected)}`).toBeLessThan(1e-5);
    }
  });

  it('7.1 BB 콜 EV 도 정의식과 일치한다', () => {
    const S = 10;
    const entry = solved.find((s) => s.stack === S);
    const solve = entry?.solve;
    const node = entry?.doc.nodes.find((n) => n.seq === 'A');
    for (const name of ['AA', 'A5s', 'KTo', '22']) {
      const v = CLASS_KEYS.indexOf(name);
      let num = 0;
      let den = 0;
      for (let h = 0; h < 169; h++) {
        const weight = (w[h * 169 + v] as number) * (solve?.sbJam[h] as number);
        if (weight === 0) continue;
        const eqBb = 1 - ((table.equity[h] as number[])[v] as number);
        num += weight * (2 * S * eqBb - (S - 1));
        den += weight;
      }
      const actual = (node?.ev?.[name] as number[])[1] as number;
      expect(Math.abs(actual - num / den)).toBeLessThan(1e-5);
    }
  });

  it('7.1 반복 수를 4배로 늘려도 전략이 거의 변하지 않는다 (수렴 확인)', () => {
    const a = solvePushFold(table.equity, 10, 5000, w);
    const b = solvePushFold(table.equity, 10, 20000, w);
    let linf = 0;
    for (let h = 0; h < 169; h++) {
      linf = Math.max(linf, Math.abs((a.sbJam[h] as number) - (b.sbJam[h] as number)));
      linf = Math.max(linf, Math.abs((a.bbCall[h] as number) - (b.bbCall[h] as number)));
    }
    expect(linf).toBeLessThan(0.01);
  });
});

describe('6.4 생성기 출력 왕복', () => {
  it('6.4 생성 문서 → importSet → getNode → toGgtoJson → formatGgtoJson 이 바이트 동일', () => {
    const repo = openRepository(':memory:');
    try {
      const doc = (solved.find((s) => s.stack === 10) as { doc: ReturnType<typeof parseGgtoJson> }).doc;
      const res = repo.importSet(doc, { source: 'generated' });
      expect(res.nodes).toBe(2);
      const set = repo.getSet(res.id);
      const nodes = repo.listNodes(res.id).map((n) => repo.getNode(res.id, n.seq));
      const round = toGgtoJson(
        set as NonNullable<typeof set>,
        nodes.map((n) => n as NonNullable<typeof n>),
      );
      expect(formatGgtoJson(round)).toBe(formatGgtoJson(doc));
    } finally {
      repo.close();
    }
  });

  it('6.4 생성 문서는 파일로 쓴 뒤 다시 읽어도 검증을 통과한다', () => {
    const doc = (solved.find((s) => s.stack === 5) as { doc: unknown }).doc;
    const reparsed = parseGgtoJson(JSON.stringify(doc));
    const v = validateChart(reparsed, { strict: true });
    expect(v.hasEv).toBe(true);
    expect(v.warnings).toEqual([]);
    expect(v.nodes.map((n) => n.heroPos)).toEqual(['SB', 'BB']);
  });
});

describe('7.1 (d) exploitability 독립 재계산', () => {
  /**
   * 파일에 적힌 전략 자체의 exploitability 를 **생성기를 부르지 않고** 다시 계산한다.
   * 콤보 가중치 w(h,v) 와 지불식을 여기서 core 로부터 다시 유도하므로, pushFold.ts 의
   * 행렬 구성이 통째로 틀렸다면 이 테스트가 잡는다 (solve 가 자기 값을 확인하는 동어반복이 아니다).
   */
  function nashConvOf(stack: number, jam: number[], call: number[]): number {
    const n = CLASS_KEYS.length;
    const eq = table.equity;
    let total = 0;
    for (const x of w) total += x;
    let sbGain = 0;
    for (let h = 0; h < n; h++) {
      let acc = 0;
      let rowTotal = 0;
      for (let v = 0; v < n; v++) {
        const ww = w[h * n + v] as number;
        rowTotal += ww;
        // 한 판 전체 기준: 잼 → BB 폴드 +1, BB 콜 2S·eq − S
        acc += ww * ((1 - (call[v] as number)) * 1 + (call[v] as number) * (2 * stack * ((eq[h] as number[])[v] as number) - stack));
      }
      const d = acc + 0.5 * rowTotal; // − (−0.5·W) = 폴드 대비 차이
      sbGain += Math.max(0, d) - (jam[h] as number) * d;
    }
    let bbGain = 0;
    for (let v = 0; v < n; v++) {
      let d = 0;
      for (let h = 0; h < n; h++) {
        const ww = (w[h * n + v] as number) * (jam[h] as number);
        if (ww === 0) continue;
        d += ww * (stack - 2 * stack * ((eq[h] as number[])[v] as number) + 1);
      }
      bbGain += Math.max(0, d) - (call[v] as number) * d;
    }
    return (sbGain + bbGain) / total;
  }

  it('7.1 파일 전략의 nashConv 가 독립 계산으로도 1e-5bb 미만이다 (게이트 0.005)', () => {
    for (const { stack, doc } of solved) {
      const root = doc.nodes.find((n) => n.seq === '');
      const bb = doc.nodes.find((n) => n.seq === 'A');
      const jam = CLASS_KEYS.map((k) => (root?.strategy[k] as number[])[1] as number);
      const call = CLASS_KEYS.map((k) => (bb?.strategy[k] as number[])[1] as number);
      const nc = nashConvOf(stack, jam, call);
      expect(nc, `${String(stack)}bb nashConv=${nc.toExponential(3)}`).toBeLessThan(1e-5);
      expect(nc).toBeGreaterThanOrEqual(0);
    }
  });

  it('7.1 혼합 전략이 나오는 클래스는 정확히 무차별점이다 (|EV| < 0.001bb)', () => {
    // 균형의 정의를 반대 방향에서 확인한다: 0 도 1 도 아닌 빈도가 나왔다면 그 핸드의 EV 는 0 이어야 한다.
    // 순수해 근처의 잔차(CFR+ 평균이 남기는 1e-3 이하)는 "혼합" 이 아니므로 제외한다.
    let mixedSeen = 0;
    for (const { stack, doc } of solved) {
      for (const node of doc.nodes) {
        for (const key of CLASS_KEYS) {
          const p = (node.strategy[key] as number[])[1] as number;
          if (p <= 0.01 || p >= 0.99) continue;
          mixedSeen++;
          const ev = (node.ev?.[key] as number[])[1] as number;
          expect(Math.abs(ev), `${String(stack)}bb "${node.seq}" ${key} p=${String(p)} ev=${String(ev)}`).toBeLessThan(0.001);
        }
      }
    }
    // 균형에는 플레이어당 무차별 클래스가 보통 정확히 하나 있다. 하나도 없으면 위 루프가
    // 아무것도 검사하지 않은 것이므로(=동어반복) 최소 개수를 못 박는다.
    expect(mixedSeen).toBeGreaterThanOrEqual(solved.length);
  });
});
