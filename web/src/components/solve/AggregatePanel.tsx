/**
 * 어그리게이트 패널 (P5.md 3.2-5).
 *
 * 액션 빈도는 **도달 가중 평균**이다 (`Σ_c reach·strategy / Σ_c reach`) — 단순 평균은
 * 도달하지 않는 콤보를 같은 무게로 세서 틀린다. 서버가 준 169 집계에서 되집계한다 (1.5).
 *
 * `노드 EV OOP + IP = 팟` 을 **화면에 표시**한다: 이 항등식이 깨지면 EV 기준점(D25)이
 * 어긋난 것이고, 사용자가 먼저 본다. 도달 질량이 0 인 노드는 `—` 다 (NaN 을 그리지 않는다).
 */

import type { SolveNodeView } from '../../api/solve';
import { actionFrequencies, reachCombos, weightedMean } from '../../lib/solveGrid';
import { formatPct } from '../../lib/chartGrid';
import { SURFACE, TEXT_BODY, TEXT_DIM, TEXT_STRONG } from '../../lib/palette';

export interface AggregatePanelProps {
  node: SolveNodeView;
  colors: Record<string, string>;
}

const bb = (x: number | null): string => (x === null ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}`);

export function AggregatePanel(props: AggregatePanelProps): React.JSX.Element {
  const { node } = props;
  const freqs = actionFrequencies(node.aggregate, node.player);
  const potBb = node.potChips / 100;
  const evOop = node.reachable ? (node.evAvgBb[0] as number) : null;
  const evIp = node.reachable ? (node.evAvgBb[1] as number) : null;
  const eqOop = weightedMean(node.equity[0], node.reach[0]);
  const eqIp = weightedMean(node.equity[1], node.reach[1]);

  return (
    <div className={`flex min-w-0 flex-col gap-2 rounded p-3 text-sm ${SURFACE} ${TEXT_BODY}`} data-testid="aggregate">
      <div className="flex flex-col gap-1">
        {node.actions.map((a, i) => {
          const f = freqs[i] ?? 0;
          return (
            <div key={a} className="flex items-center gap-2">
              <span className="w-14 shrink-0 font-mono text-xs">{a}</span>
              <span className="h-3 min-w-0 flex-1 rounded-sm bg-[#1e293b]">
                <span
                  className="block h-3 rounded-sm"
                  style={{ width: `${String(Math.max(0, Math.min(1, f)) * 100)}%`, backgroundColor: props.colors[a] ?? '#a855f7' }}
                />
              </span>
              <span className="w-12 shrink-0 text-right font-mono text-xs" data-testid={`agg-freq-${a}`}>
                {formatPct(f)}
              </span>
            </div>
          );
        })}
      </div>

      <p className="font-mono text-xs" data-testid="node-ev">
        <span className={TEXT_DIM}>노드 EV </span>
        <span className={TEXT_STRONG}>{`OOP ${bb(evOop)}`}</span>
        <span className={TEXT_DIM}> · </span>
        <span className={TEXT_STRONG}>{`IP ${bb(evIp)}`}</span>
        <span className={TEXT_DIM}>{` = 팟 ${potBb.toFixed(2)}`}</span>
      </p>
      <p className="font-mono text-xs" data-testid="node-equity">
        <span className={TEXT_DIM}>에퀴티 </span>
        {`OOP ${eqOop === null ? '—' : formatPct(eqOop)} · IP ${eqIp === null ? '—' : formatPct(eqIp)}`}
      </p>
      <p className="font-mono text-xs" data-testid="node-reach">
        <span className={TEXT_DIM}>도달 레인지 </span>
        {`OOP ${String(reachCombos(node.reach[0]))}콤보 · IP ${String(reachCombos(node.reach[1]))}콤보`}
      </p>
      <p className={`font-mono text-xs ${TEXT_DIM}`} data-testid="node-stacks">
        {`팟 ${potBb.toFixed(2)}bb · 스택 ${(node.stacksChips[0] / 100).toFixed(2)} / ${(
          node.stacksChips[1] / 100
        ).toFixed(2)}bb · 행동 ${node.player.toUpperCase()}`}
      </p>
      {node.reachable ? null : (
        <p className={`text-xs ${TEXT_DIM}`} data-testid="node-unreachable">
          도달 질량이 0 인 라인입니다 — 평균 EV 가 없습니다.
        </p>
      )}
    </div>
  );
}
