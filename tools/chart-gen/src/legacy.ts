/**
 * 옛 HU 시드 6개의 은퇴 (P7.md 7.1, D35).
 *
 * 옛 파일은 `gameType:'cash'` · `name:"HU push/fold Nbb (generated)"` 였고 새 파일은
 * `gameType:'mtt'` · `"2-max (HU) push/fold Nbb, no ante (generated)"` 다. 이름과
 * `source.params` 가 달라 **해시는 반드시 바뀐다** — 바이트 동일 재현을 요구하지 않고
 * 대신 5.2 의 회귀 게이트가 "같은 균형" 임을 고정한다.
 *
 * 아래 해시는 현 `data/ggto.db` 의 `chart_set.content_hash` 에서 읽은 값이다. 이 상수는
 * **과거의 사실**이므로 다시 계산하지 않는다 (옛 생성기는 이미 지워질 수 있다).
 */

import { ALIAS_FORMAT, ALIAS_VERSION, AliasFileError, type AliasFile, type ChartAlias } from '@ggto/preflop';

/** 옛 HU 차트의 스택 */
export const LEGACY_HU_STACKS = [5, 8, 10, 12, 15, 20] as const;
export type LegacyHuStack = (typeof LEGACY_HU_STACKS)[number];

export const LEGACY_HU_HASHES: Record<LegacyHuStack, string> = {
  5: 'f30fc450bfae6d6bb29ea856579f691d05bd13ba5dbae2fe6aa8bd7c30ef901a',
  8: '67311975c98989352bec536386c6133fcae4576d962b0f04e5a9952161a81ba3',
  10: 'deb0595b69da343cd7cbee5fbeb3d1868e9a9e261deba729cebf953cdde13dfe',
  12: 'd646c8a23df475c032e15b65a0ca9c68223c530a745a1c4623be9fe17519dead',
  15: '5622f2ee2b7fa68bb0ace527172364cb559a78e1bc8fd40c6dbf50b1ddb449fa',
  20: '9e09d8de1135f84ea55de8cba7129c7e04b4395b9d0c0bda057f69a628fffbad',
};

export const ALIAS_REASON = 'P7: same model and stack, regenerated as mtt 2-max';

export function isLegacyHuStack(stack: number): stack is LegacyHuStack {
  return (LEGACY_HU_STACKS as readonly number[]).includes(stack);
}

/**
 * 새로 쓴 2-max/none 차트들의 (스택 -> 새 해시) 에서 별칭 파일을 만든다.
 * 옛 해시가 있는 스택만 들어간다 (3bb·17bb 등 새 사다리 스택은 대응이 없다).
 * `from === to` 는 있을 수 없다 (이름·gameType 이 다르다) — 나오면 계산이 틀린 것이다.
 */
export function buildAliases(newHashesByStack: ReadonlyMap<number, string>): AliasFile {
  const aliases: ChartAlias[] = [];
  for (const stack of LEGACY_HU_STACKS) {
    const to = newHashesByStack.get(stack);
    if (to === undefined) continue;
    const from = LEGACY_HU_HASHES[stack];
    if (from === to) throw new AliasFileError(`alias for ${String(stack)}bb maps a hash onto itself: ${from}`);
    aliases.push({ from, to, reason: ALIAS_REASON });
  }
  return { format: ALIAS_FORMAT, version: ALIAS_VERSION, aliases };
}
