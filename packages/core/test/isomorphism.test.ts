import { describe, expect, it } from 'vitest';
import {
  ALL_SUIT_PERMS,
  IDENTITY_PERM,
  applyPermToCard,
  canonicalBoard,
  canonicalize,
  createRng,
  equityRangeVsRange,
  formatCards,
  fullRange,
  invertPerm,
  parseCards,
  parseRange,
  permEquals,
  permuteRangeSuits,
  suitStabilizer,
  type Card,
  type SuitPerm,
} from '../src/index.js';

function key(cards: readonly Card[]): string {
  return [...cards].sort((a, b) => a - b).join(',');
}

function* flops(): Generator<Card[]> {
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      for (let c = b + 1; c < 52; c++) yield [a, b, c];
    }
  }
}

describe('4.6 isomorphism', () => {
  it('4.6 플랍 22,100개 → 서로 다른 정규 보드 1,755개, 클래스 크기 분포 {4:299, 12:1170, 24:286}', () => {
    const t0 = performance.now();
    const classes = new Map<string, number>();
    let n = 0;
    for (const f of flops()) {
      const { board } = canonicalBoard(f);
      const k = key(board);
      classes.set(k, (classes.get(k) ?? 0) + 1);
      n++;
    }
    const ms = performance.now() - t0;
    expect(n).toBe(22100);
    expect(classes.size).toBe(1755);

    const dist = new Map<number, number>();
    for (const size of classes.values()) dist.set(size, (dist.get(size) ?? 0) + 1);
    expect([...dist.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [4, 299],
      [12, 1170],
      [24, 286],
    ]);
    expect(ms, `${ms.toFixed(0)}ms`).toBeLessThan(3000);
  });

  it('4.6 턴 270,725개 → 16,432 정규 보드', () => {
    const classes = new Set<string>();
    let n = 0;
    for (let a = 0; a < 52; a++) {
      for (let b = a + 1; b < 52; b++) {
        for (let c = b + 1; c < 52; c++) {
          for (let d = c + 1; d < 52; d++) {
            classes.add(key(canonicalBoard([a, b, c, d]).board));
            n++;
          }
        }
      }
    }
    expect(n).toBe(270725);
    expect(classes.size).toBe(16432);
  });

  it('4.6 역변환: 모든 플랍에 invertPerm(perm) 을 적용하면 원본 집합 복원', () => {
    for (const f of flops()) {
      const { board, perm } = canonicalBoard(f);
      const inv = invertPerm(perm);
      const back = board.map((c) => applyPermToCard(c, inv));
      expect(key(back)).toBe(key(f));
    }
  });

  it('4.6 정규 보드는 결과 자체가 고정점이다', () => {
    for (const f of flops()) {
      const { board } = canonicalBoard(f);
      const again = canonicalBoard(board);
      expect(key(again.board)).toBe(key(board));
      expect(permEquals(again.perm, IDENTITY_PERM)).toBe(true);
    }
  });

  it('4.6 유일성: 무작위 슈트 순열을 적용한 보드가 같은 정규형을 낸다 (10,000회)', () => {
    const rng = createRng(424242);
    for (let t = 0; t < 10000; t++) {
      const len = 3 + rng.nextInt(3); // 3..5
      const cards: Card[] = [];
      const used = new Set<number>();
      while (cards.length < len) {
        const c = rng.nextInt(52);
        if (used.has(c)) continue;
        used.add(c);
        cards.push(c);
      }
      const perm = ALL_SUIT_PERMS[rng.nextInt(24)] as SuitPerm;
      const permuted = cards.map((c) => applyPermToCard(c, perm));
      expect(key(canonicalBoard(permuted).board), formatCards(cards)).toBe(key(canonicalBoard(cards).board));
    }
  });

  it('4.6 예제: Ks7h2h ≡ Kd7s2s ≡ Kc7d2d, 그러나 Ks7h2s 는 다르다', () => {
    const a = key(canonicalBoard(parseCards('Ks7h2h')).board);
    const b = key(canonicalBoard(parseCards('Kd7s2s')).board);
    const c = key(canonicalBoard(parseCards('Kc7d2d')).board);
    expect(a).toBe(b);
    expect(a).toBe(c);
    const d = key(canonicalBoard(parseCards('Ks7h2s')).board);
    expect(d).not.toBe(a);
  });

  it('4.6 canonicalBoard 는 3..5장만 받는다', () => {
    expect(() => canonicalBoard(parseCards('KsQs'))).toThrow();
    expect(() => canonicalBoard(parseCards('KsQsJsTs9s8s'))).toThrow();
  });

  it('4.6 suitStabilizer', () => {
    expect(suitStabilizer([fullRange()])).toHaveLength(24);
    // AsKs 만: 스페이드를 고정하는 순열 3! = 6개
    const s1 = suitStabilizer([parseRange('AsKs')]);
    expect(s1).toHaveLength(6);
    for (const p of s1) expect(p[3]).toBe(3);
    // AsKs + AhKh: s 와 h 를 각각 고정 → 2개 (항등, c<->d 스왑)
    const s2 = suitStabilizer([parseRange('AsKs'), parseRange('AhKh')]);
    expect(s2).toHaveLength(2);
    for (const p of s2) {
      expect(p[3]).toBe(3);
      expect(p[2]).toBe(2);
    }
    // AKs (4콤보 동일 가중치) → 24개
    expect(suitStabilizer([parseRange('AKs')])).toHaveLength(24);
    // 항등 순열은 항상 포함
    for (const ranges of [[parseRange('AsKs')], [parseRange('AsKs:1,AhKh:0.5')]]) {
      expect(ranges.length).toBeGreaterThan(0);
      expect(suitStabilizer(ranges).some((p) => permEquals(p, IDENTITY_PERM))).toBe(true);
    }
  });

  it('4.6 canonicalize(Kh7d2c, [AsKs]): 스페이드는 스페이드로 간다', () => {
    const heroRange = parseRange('AsKs');
    const { board, ranges, perm } = canonicalize(parseCards('Kh7d2c'), [heroRange]);
    expect(perm[3]).toBe(3);
    // 반환 레인지는 여전히 AsKs 에만 가중치
    const asks = ranges[0] as Float32Array;
    const [as, ks] = parseCards('AsKs') as [number, number];
    const idx = as > ks ? (as * (as - 1)) / 2 + ks : (ks * (ks - 1)) / 2 + as;
    expect(asks[idx]).toBe(1);
    let nonzero = 0;
    for (let i = 0; i < asks.length; i++) if ((asks[i] as number) > 0) nonzero++;
    expect(nonzero).toBe(1);
    expect(board).toHaveLength(3);
  });

  it('4.6 완전 비대칭 레인지 → stabilizer 1개, 정규 보드 = 정렬된 원본', () => {
    const r = parseRange('AsKs:1,AhKh:0.5,AdKd:0.25,AcKc:0.125');
    const stab = suitStabilizer([r]);
    expect(stab).toHaveLength(1);
    expect(permEquals(stab[0] as SuitPerm, IDENTITY_PERM)).toBe(true);

    const original = parseCards('Kh7d2c');
    const { board, perm } = canonicalize(original, [r]);
    expect(permEquals(perm, IDENTITY_PERM)).toBe(true);
    expect(board).toEqual([...original].sort((a, b) => a - b));
  });

  it('4.6 대칭 레인지면 canonicalize 가 canonicalBoard 와 같은 보드를 낸다', () => {
    const r = fullRange();
    for (const t of ['Ks7h2h', 'Kh7d2c', '9s9h2d', 'AsAhAd']) {
      const board = parseCards(t);
      expect(key(canonicalize(board, [r]).board)).toBe(key(canonicalBoard(board).board));
    }
  });

  it('4.6 순열 불변성: 정규화 결과의 exact 플랍 에퀴티가 원본과 1e-6 이내로 같다', () => {
    const hero = parseRange('AsKs:1,AhKh:0.5,QQ,JJ:0.25,T9s');
    const villain = parseRange('88+,ATs+,KJs+,AJo+');
    const board = parseCards('Kh7d2c');
    const before = equityRangeVsRange(hero, villain, board, { mode: 'exact' });

    const { board: cb, ranges, perm } = canonicalize(board, [hero, villain]);
    const after = equityRangeVsRange(ranges[0] as Float32Array, ranges[1] as Float32Array, cb, {
      mode: 'exact',
    });
    expect(after.hero).toBeCloseTo(before.hero, 6);
    expect(after.villain).toBeCloseTo(before.villain, 6);
    expect(after.tie).toBeCloseTo(before.tie, 6);
    expect(after.matchups).toBe(before.matchups);

    expect(perm).toBeDefined();
    // 임의의 슈트 순열을 보드와 두 레인지에 함께 적용해도 에퀴티는 불변이어야 한다.
    // (이게 캐시 공유의 정당성이고, 레인지를 빼먹으면 여기서 깨진다.)
    const rng = createRng(99);
    for (let t = 0; t < 8; t++) {
      const p = ALL_SUIT_PERMS[rng.nextInt(24)] as SuitPerm;
      const pb = board.map((c) => applyPermToCard(c, p));
      const ph = permuteRangeSuits(hero, p);
      const pv = permuteRangeSuits(villain, p);
      const moved = equityRangeVsRange(ph, pv, pb, { mode: 'exact' });
      expect(moved.hero, JSON.stringify(p)).toBeCloseTo(before.hero, 6);
      expect(moved.tie, JSON.stringify(p)).toBeCloseTo(before.tie, 6);
    }
  });

  it('4.6 보드만 정규화하고 레인지를 놔두면 에퀴티가 달라진다 (캐시 키에 레인지 순열이 필요한 이유)', () => {
    // 히어로가 스페이드 AK 이고 보드에 스페이드가 2장 → 플러시 드로.
    // 보드만 정규화하면 스페이드가 다이아로 옮겨가서 드로가 사라진다.
    const hero = parseRange('AsKs');
    const villain = parseRange('88');
    const board = parseCards('Qs7s2h');
    const withRanges = canonicalize(board, [hero, villain]);
    const boardOnly = canonicalBoard(board);

    const correct = equityRangeVsRange(
      withRanges.ranges[0] as Float32Array,
      withRanges.ranges[1] as Float32Array,
      withRanges.board,
      { mode: 'exact' },
    );
    const original = equityRangeVsRange(hero, villain, board, { mode: 'exact' });
    const wrong = equityRangeVsRange(hero, villain, boardOnly.board, { mode: 'exact' });

    expect(correct.hero).toBeCloseTo(original.hero, 6);
    expect(Math.abs(wrong.hero - original.hero)).toBeGreaterThan(1e-3);
  });
});
