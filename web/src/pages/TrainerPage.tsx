/**
 * 트레이너 (P3.md 8 / P3M 6.1). 출제 화면과 해설 화면은 **같은 화면**이다 — 답하면
 * 마스크만 벗는다 (DESIGN 6.5). 격자는 뷰어와 같은 `ChartNodeView` 컴포넌트다.
 *
 * 답하기 전에는 전략/EV 가 브라우저에 **존재하지 않는다**: `/api/trainer/next` 응답에
 * 그 배열들이 없고, `/api/charts/:id/node` 도 부르지 않는다 (web/test 가 요청 목록으로 검사).
 *
 * 배치 (P3M): `< md` 는 한 열 스택 + 하단 고정 바, `≥ md` 는 격자 왼쪽 / 바 오른쪽.
 * DOM 은 하나이고 `position` 만 CSS 로 갈린다.
 */

import { useEffect, useMemo } from 'react';
import { comboIndex, handClassOf, parseCards, type HandClassIndex } from '@ggto/core';
import type { Category, SpotDto } from '@ggto/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useAnswerSpot, useChartSets, useCreateSession, useTrainerNext, useTrainerPool, useTrainerReport } from '../api/queries';
import { CATEGORY_LABEL } from '../api/trainer';
import { AnswerBar } from '../components/AnswerBar';
import { ChartNodeView } from '../components/ChartNodeView';
import { GradeTable } from '../components/GradeBox';
import { HeroCards } from '../components/HeroCards';
import { ReportPanel } from '../components/ReportPanel';
import { SessionForm } from '../components/SessionForm';
import { actionColors } from '../lib/chartGrid';
import { BADGE_WARN, BTN_ACTIVE, BTN_NEUTRAL, BTN_PRIMARY, PAGE, TEXT_DIM, TEXT_ERROR, TEXT_LINK, TEXT_STRONG, TOUCH } from '../lib/palette';
import { usePageTitle } from '../lib/title';
import { useUiStore } from '../store/ui';

const REPORT_DAYS = 30;

/** 페이지 바깥 상자. 모바일은 한 열 스택이고 하단 바가 뷰포트에 붙는다 */
const PAGE_BOX = `flex min-h-screen flex-col p-4 md:p-6 ${PAGE}`;

/** 1326 키('As7d') → 169 클래스. 강조할 셀을 정하는 **표시 전용** 변환이다 (D4). */
function heroClassOf(combo: string): HandClassIndex | null {
  const [a, b] = parseCards(combo);
  if (a === undefined || b === undefined) return null;
  return handClassOf(comboIndex(a, b));
}

export function TrainerPage(): React.JSX.Element {
  usePageTitle('GGTO — Trainer');
  const queryClient = useQueryClient();

  const sessionId = useUiStore((s) => s.sessionId);
  const spotIndex = useUiStore((s) => s.spotIndex);
  const phase = useUiStore((s) => s.phase);
  const spotShownAt = useUiStore((s) => s.spotShownAt);
  const trainerTab = useUiStore((s) => s.trainerTab);
  const setTrainerTab = useUiStore((s) => s.setTrainerTab);
  const startSession = useUiStore((s) => s.startSession);
  const showSpot = useUiStore((s) => s.showSpot);
  const revealSpot = useUiStore((s) => s.revealSpot);
  const advanceSpot = useUiStore((s) => s.advanceSpot);
  const finishSession = useUiStore((s) => s.finishSession);
  const resetSession = useUiStore((s) => s.resetSession);
  const selectedClass = useUiStore((s) => s.selectedClass);
  const setSelectedClass = useUiStore((s) => s.setSelectedClass);
  const hoveredClass = useUiStore((s) => s.hoveredClass);
  const setHoveredClass = useUiStore((s) => s.setHoveredClass);

  const sets = useChartSets();
  const pool = useTrainerPool();
  const create = useCreateSession();
  const next = useTrainerNext(sessionId, spotIndex);
  const answer = useAnswerSpot();
  const report = useTrainerReport(REPORT_DAYS, trainerTab === 'report');

  const nextData = next.data;
  const spot: SpotDto | null = nextData !== undefined && !nextData.done ? nextData.spot : null;
  const sessionReport = nextData !== undefined && nextData.done ? nextData.report : null;

  // 세션이 끝났다는 사실은 서버 응답이 알려준다 (남은 문제 수를 화면이 세지 않는다).
  useEffect(() => {
    if (sessionReport !== null) finishSession();
  }, [sessionReport, finishSession]);

  // msTaken 의 기준점. 스팟이 바뀌는 순간 한 번만 찍는다.
  useEffect(() => {
    if (spot !== null && spotShownAt === 0) showSpot(Date.now());
  }, [spot, spotShownAt, showSpot]);

  const answered = answer.data ?? null;
  const revealed = phase === 'revealed' && answered !== null;
  const colors = useMemo(() => actionColors(spot?.actions ?? []), [spot?.actions]);
  const heroClass = spot === null ? null : heroClassOf(spot.combo);

  const submit = (action: string): void => {
    if (spot === null || sessionId === null || phase !== 'asking' || answer.isPending) return;
    const msTaken = spotShownAt === 0 ? 0 : Date.now() - spotShownAt;
    answer.mutate(
      { sessionId, spotKey: spot.spotKey, action, msTaken },
      {
        onSuccess: (data) => {
          // 뷰어 경로와 **같은 캐시 키**에 넣는다 — 해설 화면은 /charts 와 같은 데이터 소스다.
          queryClient.setQueryData(['node', spot.chartSetId, spot.seq], data.node);
          revealSpot();
        },
      },
    );
  };

  // 키보드 1..n 도 답이다 (데스크톱에서 마우스를 떠나지 않고 20문제를 돌 수 있어야 한다).
  useEffect(() => {
    if (spot === null || phase !== 'asking') return;
    const onKey = (e: KeyboardEvent): void => {
      const i = Number(e.key) - 1;
      const action = spot.actions[i];
      if (action !== undefined) submit(action);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });

  const goNext = (): void => {
    answer.reset();
    advanceSpot();
  };

  const tabClass = (on: boolean): string =>
    `rounded px-3 text-sm ${TOUCH} ${on ? BTN_ACTIVE : BTN_NEUTRAL}`;

  const header = (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <h1 className={`text-base font-semibold md:text-xl ${TEXT_STRONG}`}>Trainer</h1>
      <a
        className={`flex items-center justify-center rounded px-2 text-sm ${TOUCH} ${TEXT_LINK}`}
        href="/charts"
        aria-label="Charts 로"
        data-testid="to-charts"
      >
        ←<span className="ml-1 hidden md:inline">Charts</span>
      </a>
      <button
        type="button"
        data-testid="tab-session"
        aria-pressed={trainerTab === 'session'}
        className={tabClass(trainerTab === 'session')}
        onClick={() => {
          setTrainerTab('session');
        }}
      >
        세션
      </button>
      <button
        type="button"
        data-testid="tab-report"
        aria-pressed={trainerTab === 'report'}
        className={tabClass(trainerTab === 'report')}
        onClick={() => {
          setTrainerTab('report');
        }}
      >
        {`리포트 ${String(REPORT_DAYS)}d`}
      </button>
      {spot === null || phase === 'done' ? null : (
        <span className={`ml-auto font-mono text-sm ${TEXT_DIM}`} data-testid="spot-progress">
          {`스팟 ${String((nextData !== undefined && !nextData.done ? nextData.index : 0) + 1)} / ${String(
            nextData !== undefined && !nextData.done ? nextData.count : 0,
          )}`}
        </span>
      )}
    </div>
  );

  if (trainerTab === 'report') {
    return (
      <div className={PAGE_BOX}>
        {header}
        {report.data === undefined ? (
          <p className={`text-sm ${TEXT_DIM}`}>{report.isPending ? 'loading…' : '리포트가 없습니다.'}</p>
        ) : (
          <ReportPanel report={report.data} title={`최근 ${String(REPORT_DAYS)}일`} />
        )}
        {report.error === null || report.error === undefined ? null : (
          <p className={`text-sm ${TEXT_ERROR}`} data-testid="report-error">{`${report.error.code}: ${report.error.message}`}</p>
        )}
      </div>
    );
  }

  if (sessionId === null) {
    return (
      <div className={PAGE_BOX}>
        {header}
        <SessionForm
          sets={sets.data ?? []}
          categories={pool.data?.categories ?? []}
          pending={create.isPending}
          error={create.error === null || create.error === undefined ? null : `${create.error.code}: ${create.error.message}`}
          onStart={(req) => {
            create.mutate(
              { count: req.count, sets: req.sets, categories: req.categories as Category[] },
              {
                onSuccess: (res) => {
                  startSession(res.sessionId);
                },
              },
            );
          }}
        />
      </div>
    );
  }

  if (phase === 'done' && sessionReport !== null) {
    return (
      <div className={PAGE_BOX}>
        {header}
        <ReportPanel report={sessionReport} title="세션 리포트" />
        <button
          type="button"
          data-testid="new-session"
          className={`mt-3 w-full rounded px-3 text-base font-semibold md:w-auto min-h-12 ${BTN_PRIMARY}`}
          onClick={() => {
            answer.reset();
            resetSession();
          }}
        >
          새 세션
        </button>
      </div>
    );
  }

  return (
    <div className={PAGE_BOX}>
      {header}

      {next.error === null || next.error === undefined ? null : (
        <p className={`text-sm ${TEXT_ERROR}`} data-testid="next-error">{`${next.error.code}: ${next.error.message}`}</p>
      )}

      {spot === null ? (
        <p className={`text-sm ${TEXT_DIM}`}>{next.isPending ? 'loading…' : '스팟이 없습니다.'}</p>
      ) : (
        <>
          <div className="mb-1 flex min-w-0 items-center gap-2 text-sm" data-testid="spot-header">
            <span className={`shrink-0 font-semibold ${TEXT_STRONG}`}>{spot.chartName}</span>
            <span className={`min-w-0 truncate font-mono text-xs ${TEXT_DIM}`}>
              {`${spot.heroPos} · ${spot.seq === '' ? 'root' : spot.seq} · 팟 ${spot.potBb.toFixed(2)}bb · ${CATEGORY_LABEL[spot.category]}`}
            </span>
            {spot.gradedBy === 'frequency' ? (
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${BADGE_WARN}`} data-testid="frequency-badge">
                빈도 채점
              </span>
            ) : null}
          </div>

          <div className="mb-2 flex items-center gap-2">
            <span className={`text-sm ${TEXT_DIM}`}>히어로:</span>
            <HeroCards combo={spot.combo} />
          </div>

          <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-start md:gap-8">
            <div className="min-w-0 md:flex-1">
              <ChartNodeView
                node={revealed ? answered.node : null}
                masked={!revealed}
                highlightClass={heroClass}
                viewMode="strategy"
                colors={colors}
                resolution={spot.resolution}
                reachWeights={null}
                reachPos={spot.heroPos}
                positionReach={[]}
                selectedClass={revealed ? (selectedClass ?? heroClass) : heroClass}
                hoveredClass={hoveredClass}
                onSelectClass={setSelectedClass}
                onHoverClass={setHoveredClass}
                panel={revealed ? 'below-collapsed' : 'none'}
                belowGrid={revealed ? <GradeTable grade={answered.grade} colors={colors} /> : null}
              />
              {answer.error === null || answer.error === undefined ? null : (
                <p className={`mt-2 text-sm ${TEXT_ERROR}`} data-testid="answer-error">{`${answer.error.code}: ${answer.error.message}`}</p>
              )}
            </div>

            <AnswerBar
              actions={spot.actions}
              colors={colors}
              grade={revealed ? answered.grade : null}
              pending={answer.isPending}
              onAnswer={submit}
              onNext={goNext}
              nextLabel="다음 →"
              hint="액션을 고르면 전략과 EV 가 공개됩니다. 빈도가 아니라 EV 손실로 채점합니다."
            />
          </div>
        </>
      )}
    </div>
  );
}
