/**
 * reach 모드 우측 패널 (P2 R1 MINOR 3). 전략 패널을 그대로 재사용하던 것을 갈랐다.
 *
 * reach 모드에는 액션도 EV 도 없다 — 있는 것은 "이 라인까지 살아남은 레인지" 뿐이므로
 * 포지션별 도달 질량과 콤보 수만 보여준다. 없는 정보를 빈칸으로 보여주지 않는다.
 */

import { formatPct } from '../lib/chartGrid';
import { TEXT_DIM, TEXT_STRONG } from '../lib/palette';

export interface PositionReach {
  pos: string;
  /** 이 노드에서 행동하는 포지션인가 */
  hero: boolean;
  /** 격자에 그려지고 있는 포지션인가 */
  active: boolean;
  /** Σ weights (1326 합) */
  weightSum: number | null;
  /** weight > 0 인 콤보 수 */
  combos: number | null;
}

const TOTAL_COMBOS = 1326;

export function ReachPanel(props: { positions: readonly PositionReach[] }): React.JSX.Element {
  return (
    <div data-testid="reach-panel" className="text-sm">
      <h2 className={`mb-1 font-semibold ${TEXT_STRONG}`}>도달 레인지</h2>
      <p className={`mb-2 text-sm md:text-xs ${TEXT_DIM}`}>
        이 라인까지 살아남은 레인지의 크기입니다. 액션·EV 는 strategy 모드에 있습니다.
      </p>
      <table className="w-full font-mono text-xs tabular-nums">
        <thead>
          <tr className={TEXT_DIM}>
            <th className="text-left font-normal">pos</th>
            <th className="text-right font-normal">mass</th>
            <th className="text-right font-normal">combos</th>
          </tr>
        </thead>
        <tbody>
          {props.positions.map((p) => (
            <tr key={p.pos} data-testid={`reach-row-${p.pos}`} className={p.active ? TEXT_STRONG : TEXT_DIM}>
              <td className="py-0.5">
                {p.pos}
                {p.hero ? ' •' : ''}
              </td>
              <td className="py-0.5 text-right">
                {p.weightSum === null ? '—' : formatPct(p.weightSum / TOTAL_COMBOS)}
              </td>
              <td className="py-0.5 text-right">
                {p.combos === null ? '—' : `${String(p.combos)} / ${String(TOTAL_COMBOS)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`mt-2 text-sm md:text-xs ${TEXT_DIM}`}>• = 이 노드에서 행동하는 포지션</p>
    </div>
  );
}
