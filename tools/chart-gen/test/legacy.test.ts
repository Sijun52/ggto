/**
 * 옛 HU 시드의 은퇴 (P7.md 7.1, D35).
 *
 * `LEGACY_HU_HASHES` 는 **과거의 사실**이다 (현 `data/ggto.db` 에서 읽은 값). 다시 계산할
 * 수 없으므로 여기서는 형태와 별칭 생성 규칙만 고정한다. 실제 은퇴 동작은
 * `tools/chart-import/test/cli.test.ts` 가 DB 로 검사한다.
 */

import { describe, expect, it } from 'vitest';
import { parseAliasFile } from '@ggto/preflop';
import { chartFileNameNmax, chartName } from '../src/chartNmax.js';
import { ALIAS_REASON, LEGACY_HU_HASHES, LEGACY_HU_STACKS, buildAliases, isLegacyHuStack } from '../src/legacy.js';

describe('7.1 옛 HU 해시와 별칭 생성', () => {
  it('7.1 옛 해시 6개는 64자 소문자 hex 이고 서로 다르다', () => {
    const values = Object.values(LEGACY_HU_HASHES);
    expect(values).toHaveLength(6);
    expect(new Set(values).size).toBe(6);
    for (const h of values) expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect([...LEGACY_HU_STACKS]).toEqual([5, 8, 10, 12, 15, 20]);
    expect(isLegacyHuStack(5)).toBe(true);
    expect(isLegacyHuStack(3)).toBe(false);
  });

  it('7.1 여섯 스택이 다 있으면 별칭 6개를 만들고 파서를 통과한다', () => {
    const hashes = new Map(LEGACY_HU_STACKS.map((s, i) => [s, String(i).repeat(64).slice(0, 64)]));
    const file = buildAliases(hashes);
    expect(file.aliases).toHaveLength(6);
    expect(file.aliases.map((a) => a.from)).toEqual(LEGACY_HU_STACKS.map((s) => LEGACY_HU_HASHES[s]));
    expect(new Set(file.aliases.map((a) => a.reason))).toEqual(new Set([ALIAS_REASON]));
    expect(parseAliasFile(JSON.stringify(file), 'built').aliases).toHaveLength(6);
  });

  it('7.1 옛 해시가 없는 스택(3bb·17bb)은 별칭을 만들지 않는다', () => {
    const file = buildAliases(new Map([[3, '0'.repeat(64)], [10, '1'.repeat(64)]]));
    expect(file.aliases.map((a) => a.from)).toEqual([LEGACY_HU_HASHES[10]]);
  });

  it('7.1 새 해시가 옛 해시와 같으면 throw (이름·gameType 이 달라 있을 수 없다)', () => {
    expect(() => buildAliases(new Map([[10, LEGACY_HU_HASHES[10]]]))).toThrow(/onto itself/);
  });

  it('6 새 2-max 차트의 이름·파일명 규약', () => {
    expect(chartName(2, 'none', 10)).toBe('2-max (HU) push/fold 10bb, no ante (generated)');
    expect(chartName(9, 'bba1', 10)).toBe('9-max push/fold 10bb, BB ante 1bb (generated)');
    expect(chartName(6, 'pp0.125', 7)).toBe('6-max push/fold 7bb, ante 0.125bb each (generated)');
    expect(chartFileNameNmax(9, 'bba1', 10)).toBe('pf-9max-bba1-10bb.json');
    // 옛 이름과 다르다 — 그래서 해시가 반드시 바뀐다 (D35)
    expect(chartName(2, 'none', 10)).not.toBe('HU push/fold 10bb (generated)');
  });
});
