/**
 * 우측 패널: 선택한 클래스의 액션표 + 콤보표. P2.md 9.
 *
 * 클래스 액션표의 빈도는 격자와 **같은 집계**(3.5)를 쓴다. 콤보표는 1326 원본을 그대로
 * 보여준다 — 169 해상도 차트면 콤보별 값이 전부 같다는 사실을 안내문으로 밝힌다
 * (없는 정보를 있는 것처럼 보여주지 않는다).
 */

import { comboCards, formatCard, handClassCombos, type HandClassIndex } from '@ggto/core';
import { formatEv, formatPct, type ChartCellModel } from '../lib/chartGrid';
import type { ChartNodeView } from '../api/charts';
import { TEXT_BODY, TEXT_DIM, TEXT_STRONG, TEXT_WARN } from '../lib/palette';

export interface ChartComboPanelProps {
  node: ChartNodeView | null;
  cells: ChartCellModel[] | null;
  selected: HandClassIndex | null;
  resolution: '169' | '1326';
  colors: Record<string, string>;
}

export function ChartComboPanel(props: ChartComboPanelProps): React.JSX.Element {
  const { node, cells, selected, resolution, colors } = props;
  if (node === null || cells === null || selected === null) {
    return (
      <div className={`text-sm ${TEXT_DIM}`} data-testid="chart-combo-panel">
        셀을 클릭하면 콤보별 빈도와 EV가 나옵니다.
      </div>
    );
  }
  const cell = cells[selected];
  if (cell === undefined) return <div data-testid="chart-combo-panel" />;
  const combos = handClassCombos(selected);

  return (
    <div data-testid="chart-combo-panel" className="text-sm">
      <h2 className={`mb-1 font-semibold ${TEXT_STRONG}`}>
        {cell.label} ({String(cell.comboCount)} combos)
      </h2>
      <p className={`mb-2 font-mono text-xs ${TEXT_DIM}`} data-testid="chart-panel-reach">
        {cell.inRange
          ? `reach ${formatPct(cell.weightSum / cell.comboCount)} (${cell.weightSum.toFixed(2)} / ${String(cell.comboCount)})`
          : 'not in range (reach 0)'}
      </p>

      <table className="mb-3 w-full font-mono text-xs tabular-nums">
        <tbody>
          {node.actions.map((a, i) => (
            <tr key={a} data-testid={`chart-action-${a}`}>
              <td className="py-0.5">
                <span
                  className="mr-2 inline-block h-2 w-2 rounded-sm align-middle"
                  style={{ backgroundColor: colors[a] ?? '#a855f7' }}
                />
                {a}
              </td>
              <td className="py-0.5 text-right">{formatPct(cell.freq[i] as number)}</td>
              <td className={`py-0.5 text-right ${TEXT_DIM}`}>
                {cell.ev === null ? '—' : formatEv(cell.ev[i] as number)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {resolution === '169' ? (
        <p className={`mb-2 text-xs ${TEXT_WARN}`} data-testid="chart-resolution-note">
          169 해상도 차트 — 콤보별 값은 모두 동일합니다.
        </p>
      ) : null}

      <ul className={`grid grid-cols-1 gap-x-4 font-mono text-xs ${TEXT_BODY}`}>
        {combos.map((c) => {
          const [hi, lo] = comboCards(c);
          const w = node.reach[c] ?? 0;
          return (
            <li key={c} className="flex flex-wrap justify-between gap-2 tabular-nums">
              <span className={w > 0 ? TEXT_STRONG : TEXT_DIM}>
                {formatCard(hi) + formatCard(lo)}
              </span>
              <span className="flex gap-2">
                {node.actions.map((a, i) => (
                  <span key={a} style={{ color: colors[a] ?? '#a855f7' }}>
                    {a} {((node.strategy[i] as Float32Array)[c] ?? 0).toFixed(2)}
                    {node.ev === null ? '' : ` / ${formatEv((node.ev[i] as Float32Array)[c] ?? 0)}`}
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
