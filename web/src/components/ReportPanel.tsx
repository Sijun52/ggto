/**
 * 세션 / 30일 리포트 (P3.md 6·8.2 / P3M 6.4). 그래프는 없다 (P3 v1).
 *
 * `bb/100` 은 "이 스팟 100개를 실전에서 이렇게 플레이했을 때의 손실" 이다. EV 평균의
 * 분모는 **ev 채점 횟수**이고 `InStrategy`/`OffStrategy` 는 개수만 센다 — 두 채점 체계는
 * 합산되지 않는다 (D8).
 *
 * 375px 에서 7열 표는 성립하지 않는다 (열이 겹쳐 `161816180.061` 로 붙어 읽혔다 —
 * P3M 1절 실측). `< md` 에서는 표 대신 **카드 목록**이다.
 */

import type { AggDto, ReportDto, Verdict } from '@ggto/protocol';
import { CATEGORY_LABEL } from '../api/trainer';
import { useIsDesktop } from '../lib/layout';
import { SURFACE, TEXT_BODY, TEXT_DIM, TEXT_STRONG, TEXT_WARN } from '../lib/palette';

const VERDICT_ORDER: Verdict[] = ['Perfect', 'Minor', 'Mistake', 'Blunder', 'InStrategy', 'OffStrategy'];

function num(x: number | null, digits: number): string {
  return x === null ? '—' : x.toFixed(digits);
}

function verdictLine(agg: AggDto): string {
  return VERDICT_ORDER.filter((v) => agg.byVerdict[v] > 0)
    .map((v) => `${v} ${String(agg.byVerdict[v])}`)
    .join(' · ');
}

function mixedText(agg: AggDto): string {
  return agg.mixedShare === null ? '—' : `${(agg.mixedShare * 100).toFixed(0)}%`;
}

function AggRow(props: { label: string; agg: AggDto; testId: string }): React.JSX.Element {
  const { agg } = props;
  return (
    <tr data-testid={props.testId} className="border-t border-[#334155]">
      <td className="py-1 pr-3">{props.label}</td>
      <td className="py-1 text-right">{String(agg.attempts)}</td>
      <td className="py-1 text-right">{String(agg.evGraded)}</td>
      <td className="py-1 text-right">{num(agg.meanEvLossBb, 3)}</td>
      <td className="py-1 text-right">{num(agg.bb100, 1)}</td>
      <td className="py-1 text-right">{mixedText(agg)}</td>
      <td className={`py-1 pl-3 ${TEXT_DIM}`}>{verdictLine(agg)}</td>
    </tr>
  );
}

/** 같은 수치를 세 줄로 편 카드. 열 폭 경쟁이 없으니 375px 에서 겹치지 않는다. */
function AggCard(props: { label: string; agg: AggDto; testId: string }): React.JSX.Element {
  const { agg } = props;
  return (
    <div data-testid={`report-card-${props.testId}`} className={`rounded p-3 ${SURFACE}`}>
      <p className={`font-semibold ${TEXT_STRONG}`}>{props.label}</p>
      <p className={`mt-1 font-mono text-xs tabular-nums ${TEXT_BODY}`}>
        {`attempts ${String(agg.attempts)} · ev ${String(agg.evGraded)} · mean ${num(agg.meanEvLossBb, 3)}bb`}
      </p>
      <p className={`font-mono text-xs tabular-nums ${TEXT_BODY}`}>
        {`bb/100 ${num(agg.bb100, 1)} · mixed ${mixedText(agg)}`}
      </p>
      <p className={`mt-1 font-mono text-xs ${TEXT_DIM}`}>{verdictLine(agg) === '' ? '—' : verdictLine(agg)}</p>
    </div>
  );
}

export function ReportPanel(props: { report: ReportDto; title: string }): React.JSX.Element {
  const { report } = props;
  const isDesktop = useIsDesktop();

  const rows: { label: string; testId: string; agg: AggDto }[] = [
    { label: '총계', testId: 'totals', agg: report.totals },
    ...report.byCategory.map((c) => ({
      label: CATEGORY_LABEL[c.category],
      testId: `cat-${c.category}`,
      agg: c as AggDto,
    })),
    ...report.bySet.map((s) => ({
      label: s.name ?? `(사라진 차트 ${s.contentHash.slice(0, 8)})`,
      testId: `set-${s.contentHash.slice(0, 8)}`,
      agg: s as AggDto,
    })),
  ];

  return (
    <div data-testid="report-panel" className={`min-w-0 text-sm ${TEXT_BODY}`}>
      <h2 className={`mb-1 font-semibold ${TEXT_STRONG}`}>{props.title}</h2>
      <p className={`mb-2 text-sm md:text-xs ${TEXT_DIM}`}>
        bb/100 = 이 스팟 100개를 실전에서 이렇게 플레이했을 때의 손실(bb). EV 평균의 분모는 ev 채점 횟수입니다.
      </p>

      {isDesktop ? (
        <table className="w-full font-mono text-xs tabular-nums">
          <thead>
            <tr className={TEXT_DIM}>
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
            {rows.map((r) => (
              <AggRow key={r.testId} label={r.label} agg={r.agg} testId={`report-${r.testId}`} />
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <AggCard key={r.testId} label={r.label} agg={r.agg} testId={r.testId} />
          ))}
        </div>
      )}

      <div className="mt-3" data-testid="report-leaks">
        <h3 className={`mb-1 text-sm font-semibold md:text-xs ${TEXT_BODY}`}>리크</h3>
        {report.leaks.length === 0 ? (
          <p className={`text-sm md:text-xs ${TEXT_DIM}`}>
            아직 리크가 없습니다 (ev 채점 20회 이상 + 평균 0.10bb 이상인 카테고리만 표시).
          </p>
        ) : (
          <ul className={`font-mono text-xs ${TEXT_WARN}`}>
            {report.leaks.map((l) => (
              <li key={l.category} data-testid={`leak-${l.category}`}>
                {`${CATEGORY_LABEL[l.category]} · 평균 ${l.meanEvLossBb.toFixed(2)}bb · ${String(l.attempts)}회`}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className={`mt-2 font-mono text-xs ${TEXT_DIM}`} data-testid="report-srs">
        {`SRS: due ${String(report.srs.due)} · leech ${String(report.srs.leeches)}`}
      </p>
    </div>
  );
}
