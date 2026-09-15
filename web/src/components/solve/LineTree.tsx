/**
 * 액션 트리 (≥ 1280 좌측 열, DESIGN 5.4 / P5.md 3.2).
 *
 * **전체 트리를 미리 받지 않는다.** 노드 이동마다 요청은 하나이고, 트리는 지금까지
 * 지나온 조상들의 **캐시된 응답**에서 형제 액션을 읽어 그린다 (TanStack 캐시가 정본 —
 * P1.md 4.4). 캐시에 없는 조상(딥링크로 바로 들어온 경우)은 액션 줄 없이 라인만 보인다.
 */

import { useQueryClient } from '@tanstack/react-query';
import type { SolveNodeResult } from '../../api/solve';
import { childLine, crumbs, STREET_LABEL, type StreetName } from '../../lib/solveLine';
import { notationKey, type SolveNotation } from '../../lib/solveNotation';
import { BTN_ACTIVE, BTN_NEUTRAL, TEXT_DIM } from '../../lib/palette';

export interface LineTreeProps {
  hash: string;
  notation: SolveNotation | null;
  line: string;
  rootStreet: StreetName;
  onGo: (line: string) => void;
}

export function LineTree(props: LineTreeProps): React.JSX.Element {
  const qc = useQueryClient();
  const key = notationKey(props.notation);
  const path = ['', ...crumbs(props.line, props.rootStreet).map((c) => c.line)];
  // 마지막 항목은 현재 노드다 — 그 자식은 하단/우측의 액션 버튼이 그린다.
  const ancestors = path.slice(0, -1).length === 0 ? [''] : path.slice(0, path.length - 1);

  return (
    <nav className="flex min-w-0 flex-col gap-2 text-sm" data-testid="line-tree">
      {ancestors.map((ancestor, depth) => {
        const cached = qc.getQueryData<SolveNodeResult>(['solve-node', props.hash, ancestor, key]);
        const actions = cached !== undefined && cached.kind === 'node' ? cached.node.actions : [];
        const next = path[depth + 1] ?? props.line;
        return (
          <div key={ancestor === '' ? 'root' : ancestor} className="flex min-w-0 flex-col gap-1">
            <button
              type="button"
              data-testid={`tree-node-${ancestor === '' ? 'root' : ancestor}`}
              className={`min-h-11 truncate rounded px-2 text-left font-mono text-xs ${
                ancestor === props.line ? BTN_ACTIVE : BTN_NEUTRAL
              }`}
              onClick={() => {
                props.onGo(ancestor);
              }}
            >
              {ancestor === '' ? STREET_LABEL[props.rootStreet] : ancestor}
            </button>
            <div className="flex flex-wrap gap-1 pl-2">
              {actions.map((a) => {
                const target = childLine(ancestor, a);
                return (
                  <button
                    key={a}
                    type="button"
                    data-testid={`tree-action-${target}`}
                    className={`min-h-11 rounded px-2 font-mono text-xs ${
                      target === next ? BTN_ACTIVE : BTN_NEUTRAL
                    }`}
                    onClick={() => {
                      props.onGo(target);
                    }}
                  >
                    {a}
                  </button>
                );
              })}
              {actions.length === 0 ? <span className={`text-xs ${TEXT_DIM}`}>…</span> : null}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
