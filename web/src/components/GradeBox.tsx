/**
 * 채점 표시 (P3.md 8.2 / P3M 4·6.1). **화면에 "정답/오답" 이라는 말이 없다** (D8).
 *
 * 혼합 스팟에서 37% 쪽을 골라도 EV 손실이 0.05bb 미만이면 Perfect 다. 빈도로 채점하면
 * "자주 하는 쪽"을 외우게 되고 그것은 균형이 아니다.
 *
 * P3M 에서 둘로 갈렸다: **verdict 줄**(`GradeVerdict`) 은 하단 고정 바에, **액션표**
 * (`GradeTable`) 는 격자 아래에. 모바일에서 엄지로 닿는 자리는 바 하나뿐이고 표는
 * 읽기만 하는 것이라 같이 둘 이유가 없다.
 */

import type { GradeDto } from '@ggto/protocol';
import { formatEv, formatPct } from '../lib/chartGrid';
import { BADGE_NEUTRAL, TEXT_BODY, TEXT_STRONG, VERDICT_CHIP } from '../lib/palette';

export function GradeVerdict(props: { grade: GradeDto }): React.JSX.Element {
  const { grade } = props;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        data-testid="grade-verdict"
        className={`rounded px-2 py-1 text-sm font-semibold ${VERDICT_CHIP[grade.verdict]}`}
      >
        {grade.verdict}
      </span>
      <span className={`font-mono text-sm ${TEXT_STRONG}`} data-testid="grade-evloss">
        {grade.evLossBb === null ? '빈도 채점 (EV 없음)' : `EV loss ${grade.evLossBb.toFixed(2)}bb`}
      </span>
      {grade.mixed ? (
        <span className={`rounded px-2 py-0.5 text-xs ${BADGE_NEUTRAL}`} data-testid="grade-mixed">
          혼합 스팟
        </span>
      ) : null}
    </div>
  );
}

export function GradeTable(props: { grade: GradeDto; colors: Record<string, string> }): React.JSX.Element {
  const { grade, colors } = props;
  return (
    <div data-testid="grade-table" className="min-w-0 text-sm">
      <p className={`mb-2 font-mono text-sm ${TEXT_BODY}`} data-testid="grade-summary">
        {`당신: ${grade.chosenAction} (${formatPct(grade.chosenFreq)})`}
        {'   '}
        {`최선: ${grade.bestAction}`}
        {grade.bestEvBb === null ? '' : ` ${formatEv(grade.bestEvBb)}`}
      </p>

      <table className="w-full font-mono text-xs tabular-nums">
        <tbody>
          {grade.actions.map((row) => (
            <tr
              key={row.action}
              data-testid={`grade-action-${row.action}`}
              className={row.action === grade.chosenAction ? TEXT_STRONG : TEXT_BODY}
            >
              <td className="py-1">
                <span
                  className="mr-2 inline-block h-3 w-3 rounded-sm align-middle"
                  style={{ backgroundColor: colors[row.action] ?? '#a855f7' }}
                />
                {row.action}
                {row.action === grade.chosenAction ? ' ←' : ''}
              </td>
              <td className="py-1 text-right">{formatPct(row.freq)}</td>
              <td className="py-1 text-right">{row.evBb === null ? '—' : formatEv(row.evBb)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
