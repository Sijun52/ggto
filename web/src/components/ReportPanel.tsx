/**
 * 세션 / 30일 리포트 표 (P3.md 6·8.2). 그래프는 없다 (P3 v1).
 *
 * `bb/100` 은 "이 스팟 100개를 실전에서 이렇게 플레이했을 때의 손실" 이다. EV 평균의
 * 분모는 **ev 채점 횟수**이고 `InStrategy`/`OffStrategy` 는 개수만 센다 — 두 채점 체계는
 * 합산되지 않는다 (D8).
 */

import type { AggDto, ReportDto, Verdict } from '@ggto/protocol';
import { CATEGORY_LABEL } from '../api/trainer';

const VERDICT_ORDER: Verdict[] = ['Perfect', 'Minor', 'Mistake', 'Blunder', 'InStrategy', 'OffStrategy'];

function num(x: number | null, digits: number): string {
  return x === null ? '—' : x.toFixed(digits);
}

function verdictLine(agg: AggDto): string {
  return VERDICT_ORDER.filter((v) => agg.byVerdict[v] > 0)
    .map((v) => `${v} ${String(agg.byVerdict[v])}`)
    .join(' · ');
}

function AggRow(props: { label: string; agg: AggDto; testId: string }): React.JSX.Element {
  const { agg } = props;
  return (
    <tr data-testid={props.testId} className="border-t border-slate-800">
      <td className="py-1 pr-3">{props.label}</td>
      <td className="py-1 text-right">{String(agg.attempts)}</td>
      <td className="py-1 text-right">{String(agg.evGraded)}</td>
      <td className="py-1 text-right">{num(agg.meanEvLossBb, 3)}</td>
      <td className="py-1 text-right">{num(agg.bb100, 1)}</td>
      <td className="py-1 text-right">{agg.mixedShare === null ? '—' : `${(agg.mixedShare * 100).toFixed(0)}%`}</td>
      <td className="py-1 pl-3 text-slate-400">{verdictLine(agg)}</td>
    </tr>
  );
}

export function ReportPanel(props: { report: ReportDto; title: string }): React.JSX.Element {
  const { report } = props;
  return (
    <div data-testid="report-panel" className="text-sm">
      <h2 className="mb-1 font-semibold text-slate-200">{props.title}</h2>
      <p className="mb-2 text-xs text-slate-400">
        bb/100 = 이 스팟 100개를 실전에서 이렇게 플레이했을 때의 손실(bb). EV 평균의 분모는 ev 채점 횟수입니다.
      </p>
      <table className="w-full font-mono text-xs tabular-nums">
        <thead>
          <tr className="text-slate-500">
            <th className="text-left font-normal">scope</th>
            <th className="text-right font-normal">attempts</th>
            <th className="text-right font-normal">ev</th>
            <th className="text-right font-normal">mean bb</th>
            <th className="text-right font-normal">bb/100</th>
            <th className="text-right font-normal">mixed</th>
            <th className="pl-3 text-left font-normal">verdicts</th>
          </tr>
        </thead>
        <tbody>
          <AggRow label="총계" agg={report.totals} testId="report-totals" />
          {report.byCategory.map((c) => (
            <AggRow
              key={c.category}
              label={CATEGORY_LABEL[c.category]}
              agg={c}
              testId={`report-cat-${c.category}`}
            />
          ))}
          {report.bySet.map((s) => (
            <AggRow
              key={s.contentHash}
              label={s.name ?? `(사라진 차트 ${s.contentHash.slice(0, 8)})`}
              agg={s}
              testId={`report-set-${s.contentHash.slice(0, 8)}`}
            />
          ))}
        </tbody>
      </table>

      <div className="mt-3" data-testid="report-leaks">
        <h3 className="mb-1 text-xs font-semibold text-slate-300">리크</h3>
        {report.leaks.length === 0 ? (
          <p className="text-xs text-slate-500">
            아직 리크가 없습니다 (ev 채점 20회 이상 + 평균 0.10bb 이상인 카테고리만 표시).
          </p>
        ) : (
          <ul className="font-mono text-xs text-amber-300">
            {report.leaks.map((l) => (
              <li key={l.category} data-testid={`leak-${l.category}`}>
                {`${CATEGORY_LABEL[l.category]} · 평균 ${l.meanEvLossBb.toFixed(2)}bb · ${String(l.attempts)}회`}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-2 font-mono text-xs text-slate-500" data-testid="report-srs">
        {`SRS: due ${String(report.srs.due)} · leech ${String(report.srs.leeches)}`}
      </p>
    </div>
  );
}
