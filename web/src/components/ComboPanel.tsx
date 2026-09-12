/**
 * 선택한 클래스의 콤보별 가중치. 클래스 크기(4/6/12)는 core 가 정한다.
 */

import { comboCards, formatCard, handClassCombos, handClassName, type HandClassIndex, type Range } from '@ggto/core';

export interface ComboPanelProps {
  weights: Range | null;
  selected: HandClassIndex | null;
}

export function ComboPanel(props: ComboPanelProps): React.JSX.Element {
  const { weights, selected } = props;
  if (weights === null || selected === null) {
    return (
      <div className="text-sm text-slate-400" data-testid="combo-panel">
        셀을 클릭하면 콤보별 가중치가 나옵니다.
      </div>
    );
  }
  const combos = handClassCombos(selected);
  const name = handClassName(selected);
  return (
    <div data-testid="combo-panel">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">
        {name} ({String(combos.length)} combos)
      </h2>
      <ul className="grid grid-cols-2 gap-x-4 font-mono text-xs text-slate-300">
        {combos.map((i) => {
          const [hi, lo] = comboCards(i);
          const w = weights[i] ?? 0;
          return (
            <li key={i} className="flex justify-between tabular-nums">
              <span className={w > 0 ? 'text-slate-100' : 'text-slate-500'}>
                {formatCard(hi) + formatCard(lo)}
              </span>
              <span className={w > 0 ? 'text-emerald-400' : 'text-slate-600'}>{w.toFixed(2)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
