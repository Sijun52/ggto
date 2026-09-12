/**
 * ggto-json 도메인 검증 (P2.md 6.2-2..7) + 1326 전개.
 *
 * 단일 진실은 core 상태 기계다. 파일이 주는 hero_pos/pot 은 애초에 받지 않고 여기서 만든다.
 * 결함은 전부 모아서 한 번에 던진다 (P2.md 4.3).
 */

import {
  ActionSyntaxError,
  IllegalActionError,
  PreflopConfigError,
  formatAction,
  parseActionSequence,
  preflopState,
  type Action,
  type PreflopConfig,
  type PreflopState,
} from '@ggto/core';
import { ChartValidationError, type ChartIssue, type GgtoJson } from './types.js';
import { buildRows } from './rows.js';

export interface ValidatedNode {
  seq: string;
  heroPos: string;
  potBb: number;
  actions: string[];
  /** [a] → 1326 (169 문서는 클래스 콤보에 같은 행을 복사) */
  strategy: Float32Array[];
  ev: Float32Array[] | null;
}

export interface ValidatedChart {
  nodes: ValidatedNode[];
  /** 모든 노드에 EV 가 있을 때만 true (P2.md 3.3) */
  hasEv: boolean;
  /** 거부가 아닌 경고 (트리 폐쇄성). --strict 면 호출 측이 거부로 올린다 */
  warnings: ChartIssue[];
}

/** seq 의 자식 노드 키. 루트는 접두 '-' 가 없다 (D3: 구분자는 '-') */
export function childSeq(seq: string, action: string): string {
  return seq === '' ? action : `${seq}-${action}`;
}

function street(seq: string): Action[] {
  if (seq === '') return [];
  const parsed = parseActionSequence(seq);
  if (parsed.length !== 1) {
    throw new ActionSyntaxError(`preflop action sequence must have exactly one street: ${JSON.stringify(seq)}`);
  }
  return parsed[0] as Action[];
}

/** 이 상태에서 토큰을 적용할 수 있는가. 금액 후보 열거를 하지 않는 legalActions 대신 상태 기계로 직접 묻는다. */
function isApplicable(config: PreflopConfig, prefix: readonly Action[], token: string): boolean {
  let action: Action;
  try {
    action = street(token)[0] as Action;
  } catch {
    return false;
  }
  try {
    preflopState(config, [...prefix, action]);
    return true;
  } catch (e) {
    if (e instanceof IllegalActionError) return false;
    throw e;
  }
}

function stateOf(config: PreflopConfig, actions: readonly Action[]): PreflopState {
  return preflopState(config, [...actions]);
}

interface NodeRows {
  strategy: Float32Array[];
  ev: Float32Array[] | null;
}

/**
 * 문서 전체 검증. 성공하면 1326 으로 전개된 노드들을 돌려준다.
 * 실패하면 발견한 결함 전부를 담은 `ChartValidationError`.
 */
export function validateChart(doc: GgtoJson, opts: { strict?: boolean } = {}): ValidatedChart {
  const issues: ChartIssue[] = [];
  const warnings: ChartIssue[] = [];

  // 6.2-2: config 자체가 상태 기계에서 살아 있는가
  try {
    preflopState(doc.config, []);
  } catch (e) {
    if (e instanceof PreflopConfigError) {
      issues.push({ path: 'config', reason: e.message });
      // config 가 깨졌으면 노드 검증이 전부 무의미한 에러를 쏟아낸다. 여기서 끝낸다.
      throw new ChartValidationError(issues);
    }
    throw e;
  }

  const seen = new Set<string>();
  const nodes: ValidatedNode[] = [];
  // EV 유무는 다른 결함과 독립적으로 센다 — 어떤 노드가 다른 이유로 탈락했다고 해서
  // "EV 가 없다" 는 2차 에러가 따라 나오면 사람이 진짜 원인을 못 찾는다.
  const evCount = doc.nodes.filter((n) => n.ev !== undefined).length;

  doc.nodes.forEach((n, i) => {
    const path = `nodes[${String(i)}]`;
    if (seen.has(n.seq)) {
      issues.push({ path: `${path}.seq`, reason: `duplicate action sequence ${JSON.stringify(n.seq)}` });
      return;
    }
    seen.add(n.seq);

    let prefix: Action[];
    try {
      prefix = street(n.seq);
    } catch (e) {
      if (e instanceof ActionSyntaxError) {
        issues.push({ path: `${path}.seq`, reason: e.message });
        return;
      }
      throw e;
    }

    let state: PreflopState;
    try {
      state = stateOf(doc.config, prefix);
    } catch (e) {
      if (e instanceof IllegalActionError) {
        issues.push({ path: `${path}.seq`, reason: e.message });
        return;
      }
      throw e;
    }

    // 6.2-3: 터미널 노드에는 전략이 없다
    if (state.isTerminal || state.toAct === null) {
      issues.push({ path: `${path}.seq`, reason: 'node is terminal (preflop is over); it has no strategy' });
      return;
    }

    const dup = new Set<string>();
    let actionsOk = true;
    for (const [ai, token] of n.actions.entries()) {
      if (dup.has(token)) {
        issues.push({ path: `${path}.actions[${String(ai)}]`, reason: `duplicate action ${JSON.stringify(token)}` });
        actionsOk = false;
        continue;
      }
      dup.add(token);
      if (!isApplicable(doc.config, prefix, token)) {
        issues.push({
          path: `${path}.actions[${String(ai)}]`,
          reason: `${JSON.stringify(token)} is not a legal action for ${JSON.stringify(state.toAct)} at this node`,
        });
        actionsOk = false;
      }
    }
    if (!actionsOk) return;

    const rows = buildRows(issues, path, doc.resolution, n.actions, n.strategy, n.ev, doc.evBasis);
    if (rows === null) return;

    // 6.2-6: 트리 폐쇄성은 경고다 (차트가 트리 일부만 담는 것은 정상)
    for (const token of n.actions) {
      const child = childSeq(n.seq, token);
      const childState = stateOf(doc.config, street(child));
      if (!childState.isTerminal && !doc.nodes.some((m) => m.seq === child)) {
        warnings.push({ path: `${path}.actions`, reason: `child node ${JSON.stringify(child)} is missing (tree is not closed)` });
      }
    }

    nodes.push({
      seq: n.seq,
      heroPos: state.toAct,
      potBb: state.pot,
      actions: [...n.actions],
      strategy: rows.strategy,
      ev: rows.ev,
    });
  });

  // 6.2-7
  if (!seen.has('')) issues.push({ path: 'nodes', reason: 'the root node (seq "") is missing' });

  // 3.3: EV 는 차트셋 단위로 있거나 없다 (P3 채점이 graded_by 를 셋 단위로 정한다)
  if (evCount > 0 && evCount !== doc.nodes.length) {
    issues.push({
      path: 'nodes',
      reason: `ev is present on ${String(evCount)} of ${String(doc.nodes.length)} nodes; it must be on all or none`,
    });
  }
  if (evCount > 0 && doc.evBasis === 'none') {
    issues.push({ path: 'evBasis', reason: 'nodes carry "ev" but evBasis is "none"' });
  }
  if (evCount === 0 && doc.evBasis !== 'none') {
    issues.push({ path: 'evBasis', reason: `evBasis is ${JSON.stringify(doc.evBasis)} but no node carries "ev"` });
  }

  if (opts.strict === true) issues.push(...warnings);
  if (issues.length > 0) throw new ChartValidationError(issues);
  return { nodes, hasEv: evCount > 0, warnings };
}

/** 액션 토큰 목록 → 사람이 읽는 문자열 (에러 메시지용) */
export function formatActions(actions: readonly Action[]): string {
  return actions.map(formatAction).join(', ');
}
