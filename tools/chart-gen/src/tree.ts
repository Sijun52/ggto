/**
 * n-max 푸시/폴드 트리 (P7.md 1.1). 액션은 `{F,A}` (잼 전) / `{F,C}` (잼을 마주함) 뿐이고
 * 각 플레이어는 **한 번만** 행동한다.
 *
 * 두 가지가 결정 노드를 없앤다:
 *   1. **전원 폴드**: 마지막 한 명(BB)만 남으면 게임이 끝난다 — BB 는 행동하지 않는다.
 *      그래서 n=9 의 BB 결정 노드가 37 이 아니라 36 이다.
 *   2. **콜러 상한 `capCallers`** (D31): 잼에 콜이 2명 붙은 뒤의 플레이어는 강제 폴드다.
 *      그 자리는 `truncated` 에 기록만 하고 노드를 만들지 않는다. 절단이 만드는 편차는
 *      `truncation.ts` 가 측정해 차트에 적는다.
 *
 * 포지션 인덱스는 `tablePositions(n)` 의 순서(= 액션 순서)와 같다. BB 는 항상 n−1 이다.
 */

import { childSeq } from '@ggto/preflop';

export const FOLD = 'F';
export const JAM = 'A';
export const CALL = 'C';

/** 잼 하나에 붙을 수 있는 콜러 수의 상한 (D31). 3-way 쇼다운까지. */
export const CAP_CALLERS = 2;

export type NodeKind = 'open' | 'facing';

/** 결정 노드의 자식이 가리키는 곳. 절단은 자식이 아니라 터미널로 이어진다 (강제 폴드는 결정이 아니다). */
export type Edge = { kind: 'node'; index: number } | { kind: 'terminal'; index: number };

export interface TreeNode {
  /** 정규 액션 문자열. 루트는 '' */
  seq: string;
  /** 행동하는 플레이어 인덱스 */
  actor: number;
  kind: NodeKind;
  /** 항상 [F, <비폴드>] — 인덱스 0 이 폴드라는 것이 파일 계약이다 */
  actions: readonly [string, string];
  /** [폴드 자식, 비폴드 자식] */
  children: readonly [Edge, Edge];
  /**
   * 이 노드에 오기까지 **비폴드**를 한 플레이어들 (잼 → 콜1 순서). 길이 0..2.
   * 히어로 시점 조건부 트리(1.4)의 조건 집합이 여기서 나온다.
   */
  priorActive: readonly number[];
  /** 이 노드에 오기까지 폴드한 플레이어들 (액션 순서) */
  priorFolders: readonly FolderInfo[];
}

export interface FolderInfo {
  player: number;
  /** 이 폴더가 결정한 시점에 이미 비폴드를 한 플레이어들 (잼 → 콜1 → 콜2 순서). 길이 0..3 */
  priorActive: readonly number[];
  /** 콜러 상한에 걸린 강제 폴드인가 (확률 1, 전략이 없다) */
  forced: boolean;
  /** 강제 폴드가 아니면 그 결정 노드의 인덱스 */
  node: number;
}

export interface Terminal {
  seq: string;
  /** 올인 집합. [잼, 콜1, 콜2] 순서. 전원 폴드 터미널은 빈 배열 */
  J: readonly number[];
  /** J 와 같은 순서의 결정 노드 인덱스 (그 플레이어가 비폴드를 고른 노드) */
  activeNodes: readonly number[];
  /** 폴드한 플레이어들 (강제 폴드 포함) */
  F: readonly number[];
  folders: readonly FolderInfo[];
  /** 잼 전에 폴드 (앞선 활성 플레이어 0명) */
  foldersBefore: readonly number[];
  /** 잼 뒤 · 첫 콜 전에 폴드 (앞선 활성 1명) */
  foldersBetween: readonly number[];
  /** 첫 콜 뒤에 폴드 (앞선 활성 2명) */
  foldersAfter: readonly number[];
  /** 콜러 상한에 걸린 강제 폴드 (앞선 활성 3명) */
  foldersForced: readonly number[];
  /** 전원 폴드 → BB 가 걷는다 */
  walk: boolean;
}

export interface TruncatedNode {
  seq: string;
  actor: number;
  /** 이미 올인인 세 명 [잼, 콜1, 콜2] */
  J: readonly number[];
}

export interface PushFoldTree {
  n: number;
  capCallers: number;
  nodes: TreeNode[];
  terminals: Terminal[];
  truncated: TruncatedNode[];
  /** 플레이어별 결정 노드 인덱스 (P7.md 1.1 의 포지션별 표를 고정한다) */
  nodesByPlayer: number[][];
  /** 히어로가 비폴드로 도달하는 터미널: byHeroNode[i][nodeIndex] = 터미널 인덱스들 */
  heroTerminals: Map<number, number[]>[];
  /** seq -> 노드 인덱스 */
  bySeq: Map<string, number>;
}

interface Frame {
  actor: number;
  seq: string;
  /** 비폴드를 한 플레이어들 (잼 → 콜) */
  active: number[];
  folders: FolderInfo[];
}

function terminalOf(seq: string, active: readonly number[], folders: readonly FolderInfo[]): Terminal {
  const bucket = (len: number): number[] => folders.filter((f) => f.priorActive.length === len).map((f) => f.player);
  return {
    seq,
    J: [...active],
    activeNodes: [],
    F: folders.map((f) => f.player),
    folders: folders.map((f) => ({ ...f, priorActive: [...f.priorActive] })),
    foldersBefore: bucket(0),
    foldersBetween: bucket(1),
    foldersAfter: bucket(2),
    foldersForced: folders.filter((f) => f.forced).map((f) => f.player),
    walk: active.length === 0,
  };
}

/**
 * 트리를 **결정적으로** 편다: 노드는 깊이 우선 · 폴드 먼저 순서로 붙고, 그 순서가 곧
 * `nodes` 배열의 인덱스다. 같은 (n, capCallers) 는 언제나 같은 배열을 만든다.
 */
export function buildTree(n: number, capCallers: number = CAP_CALLERS): PushFoldTree {
  if (!Number.isInteger(n) || n < 2 || n > 9) throw new RangeError(`table size must be an integer in 2..9: ${String(n)}`);
  if (!Number.isInteger(capCallers) || capCallers < 1) {
    throw new RangeError(`capCallers must be a positive integer: ${String(capCallers)}`);
  }

  const nodes: TreeNode[] = [];
  const terminals: Terminal[] = [];
  const truncated: TruncatedNode[] = [];

  /** 프레임을 풀어 (노드 또는 터미널) 인덱스를 돌려준다. 강제 폴드는 여기서 소진된다. */
  const expand = (frame: Frame): Edge => {
    let { actor, seq } = frame;
    const folders = [...frame.folders];
    const active = frame.active;

    for (;;) {
      // 남은 활성 플레이어가 1명뿐이면 게임이 끝난다 (전원 폴드 → BB 가 걷는다).
      if (active.length === 0 && folders.length === n - 1) {
        terminals.push(terminalOf(seq, active, folders));
        return { kind: 'terminal', index: terminals.length - 1 };
      }
      if (actor >= n) {
        terminals.push(terminalOf(seq, active, folders));
        return { kind: 'terminal', index: terminals.length - 1 };
      }
      // 콜러 상한: 결정 노드가 없다. 강제 폴드로 소진하고 다음 액터로 넘어간다 (D31).
      if (active.length >= 1 + capCallers) {
        truncated.push({ seq, actor, J: [...active] });
        folders.push({ player: actor, priorActive: [...active], forced: true, node: -1 });
        seq = childSeq(seq, FOLD);
        actor += 1;
        continue;
      }
      break;
    }

    const kind: NodeKind = active.length === 0 ? 'open' : 'facing';
    const nonFold = kind === 'open' ? JAM : CALL;
    const index = nodes.length;
    // 자식을 만들기 전에 자리를 잡아 둔다 — 인덱스가 곧 DFS 순서다.
    nodes.push({
      seq,
      actor,
      kind,
      actions: [FOLD, nonFold],
      children: [
        { kind: 'terminal', index: -1 },
        { kind: 'terminal', index: -1 },
      ],
      priorActive: [...active],
      priorFolders: folders.map((f) => ({ ...f, priorActive: [...f.priorActive] })),
    });

    const foldEdge = expand({
      actor: actor + 1,
      seq: childSeq(seq, FOLD),
      active,
      folders: [...folders, { player: actor, priorActive: [...active], forced: false, node: index }],
    });
    const playEdge = expand({
      actor: actor + 1,
      seq: childSeq(seq, nonFold),
      active: [...active, actor],
      folders,
    });
    (nodes[index] as TreeNode).children = [foldEdge, playEdge];
    return { kind: 'node', index };
  };

  expand({ actor: 0, seq: '', active: [], folders: [] });

  const nodesByPlayer: number[][] = Array.from({ length: n }, () => []);
  for (const [i, node] of nodes.entries()) (nodesByPlayer[node.actor] as number[]).push(i);

  // 히어로가 비폴드로 도달하는 터미널 목록. 히어로의 결정 노드는 경로상 유일하다
  // (플레이어가 한 번만 행동하므로) — 터미널마다 J 의 각 멤버에 대해 정확히 하나다.
  const bySeq = new Map<string, number>();
  for (const [i, node] of nodes.entries()) bySeq.set(node.seq, i);
  const heroTerminals: Map<number, number[]>[] = Array.from({ length: n }, () => new Map<number, number[]>());
  for (const [t, term] of terminals.entries()) {
    const activeNodes: number[] = [];
    for (const hero of term.J) {
      const prefix = seqPrefix(term.seq, hero);
      const nodeIndex = bySeq.get(prefix);
      if (nodeIndex === undefined) throw new Error(`terminal ${JSON.stringify(term.seq)} has no decision node for player ${String(hero)}`);
      activeNodes.push(nodeIndex);
      const map = heroTerminals[hero] as Map<number, number[]>;
      const list = map.get(nodeIndex);
      if (list === undefined) map.set(nodeIndex, [t]);
      else list.push(t);
    }
    terminals[t] = { ...term, activeNodes };
  }

  return { n, capCallers, nodes, terminals, truncated, nodesByPlayer, heroTerminals, bySeq };
}

/**
 * `(h, y)` 조건부 행렬(169², 계산 169³)이 실제로 필요한 노드 집합.
 *
 * 이것을 세지 않으면 반복마다 모든 노드의 169³ 을 돌게 된다 — n=2 는 그 행렬을 **한 번도
 * 쓰지 않는데** 차트 한 장이 5초가 걸렸다 (실측). 구조적 계산이라 솔버·BR 이 같이 쓴다.
 */
export function matrixNodes(tree: PushFoldTree): Set<number> {
  const set = new Set<number>();
  const at = (seq: string, player: number): number => {
    const index = tree.bySeq.get(seqPrefix(seq, player));
    if (index === undefined) throw new Error(`no decision node for player ${String(player)} on path ${JSON.stringify(seq)}`);
    return index;
  };
  for (const node of tree.nodes) {
    // 도달 확률: 두 번째 활성 상대의 비폴드 확률은 (h, y) 조건이다
    if (node.priorActive.length === 2) set.add(at(node.seq, node.priorActive[1] as number));
    for (const f of node.priorFolders) {
      if (!f.forced && f.priorActive.length > 0) set.add(f.node);
    }
  }
  for (const z of tree.terminals) {
    for (const hero of z.J) {
      for (const f of z.folders) {
        if (f.forced) continue;
        if (f.priorActive.some((p) => p !== hero)) set.add(f.node);
      }
    }
  }
  return set;
}

/** 터미널 seq 에서 플레이어 p 가 행동하기 **직전**까지의 접두사 (= p 의 결정 노드 seq) */
function seqPrefix(seq: string, player: number): string {
  const tokens = seq === '' ? [] : seq.split('-');
  return tokens.slice(0, player).join('-');
}

/** P7.md 1.1 의 표를 계산으로 재현한다 (테스트가 트리와 대조한다). */
export function expectedTreeCounts(n: number): {
  decisions: number;
  twoWay: number;
  threeWay: number;
  jamAllFold: number;
  truncated: number;
  removedFourWayPlus: number;
  decisionsByPlayer: number[];
} {
  // 플레이어 m 의 결정 상태 = "잼 없음" 1개 + (잼한 사람 j, 콜러 0 또는 1명) 의 조합.
  // 콜러 2명 상태는 상한에 걸려 결정이 없다. 마지막 플레이어(BB)의 "전원 폴드" 는 터미널이다.
  const decisionsByPlayer = Array.from({ length: n }, (_unused, m) => 1 + m + (m * (m - 1)) / 2 - (m === n - 1 ? 1 : 0));
  const c = (a: number, b: number): number => {
    if (b < 0 || b > a) return 0;
    let r = 1;
    for (let t = 0; t < b; t++) r = (r * (a - t)) / (t + 1);
    return Math.round(r);
  };
  let truncatedCount = 0;
  for (let k = 2; k < n; k++) truncatedCount += (n - 1 - k) * c(k, 2);
  let removed = 0;
  for (let k = 4; k <= n; k++) removed += c(n, k);
  return {
    decisions: decisionsByPlayer.reduce((a, b) => a + b, 0),
    twoWay: c(n, 2),
    threeWay: c(n, 3),
    // BB 는 잼할 수 없다 (앞이 전원 폴드면 BB 는 행동하지 않고 걷는다).
    jamAllFold: n - 1,
    truncated: truncatedCount,
    removedFourWayPlus: removed,
    decisionsByPlayer,
  };
}
