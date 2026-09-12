/**
 * 채점 박스 (P3.md 8.2). **화면에 "정답/오답" 이라는 말이 없다** (D8).
 *
 * 혼합 스팟에서 37% 쪽을 골라도 EV 손실이 0.05bb 미만이면 Perfect 다. 빈도로 채점하면
 * "자주 하는 쪽"을 외우게 되고 그것은 균형이 아니다.
 */

import type { GradeDto, Verdict } from '@ggto/protocol';
import { formatEv, formatPct } from '../lib/chartGrid';

const VERDICT_CLASS: Record<Verdict, string> = {
  Perfect: 'bg-emerald-600 text-emerald-50',
  Minor: 'bg-amber-500 text-amber-50',
  Mistake: 'bg-orange-600 text-orange-50',
  Blunder: 'bg-red-600 text-red-50',
  InStrategy: 'bg-sky-600 text-sky-50',
  OffStrategy: 'bg-slate-600 text-slate-50',
};

export interface GradeBoxProps {
  grade: GradeDto;
  colors: Record<string, string>;
  onNext: () => void;
  nextLabel: string;
}

export function GradeBox(props: GradeBoxProps): React.JSX.Element {
  const { grade, colors } = props;
  return (
    <div data-testid="grade-box" className="text-sm">
      <div className="mb-2 flex items-center gap-2">
        <span
          data-testid="grade-verdict"
          className={`rounded px-2 py-0.5 text-sm font-semibold ${VERDICT_CLASS[grade.verdict]}`}
        >
          {grade.verdict}
        </span>
        <span className="font-mono text-sm text-slate-200" data-testid="grade-evloss">
          {grade.evLossBb === null ? '빈도 채점 (EV 없음)' : `EV loss ${grade.evLossBb.toFixed(2)}bb`}
        </span>
        {grade.mixed ? (
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300" data-testid="grade-mixed">
            혼합 스팟
          </span>
        ) : null}
      </div>

      <p className="mb-2 font-mono text-xs text-slate-300" data-testid="grade-summary">
        {`당신: ${grade.chosenAction} (${formatPct(grade.chosenFreq)})`}
        {'   '}
        {`최선: ${grade.bestAction}`}
        {grade.bestEvBb === null ? '' : ` ${formatEv(grade.bestEvBb)}`}
      </p>

      <table className="mb-3 w-full font-mono text-xs tabular-nums">
        <tbody>
          {grade.actions.map((row) => (
            <tr
              key={row.action}
              data-testid={`grade-action-${row.action}`}
              className={row.action === grade.chosenAction ? 'text-slate-100' : 'text-slate-400'}
            >
              <td className="py-0.5">
                <span
                  className="mr-2 inline-block h-2 w-2 rounded-sm align-middle"
                  style={{ backgroundColor: colors[row.action] ?? '#a855f7' }}
                />
                {row.action}
                {row.action === grade.chosenAction ? ' ←' : ''}
              </td>
              <td className="py-0.5 text-right">{formatPct(row.freq)}</td>
              <td className="py-0.5 text-right">{row.evBb === null ? '—' : formatEv(row.evBb)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <button
        type="button"
        data-testid="next-spot"
        className="rounded bg-sky-600 px-3 py-1 text-sm font-semibold text-sky-50"
        onClick={props.onNext}
      >
        {props.nextLabel}
      </button>
    </div>
  );
}
