/**
 * 포스트플랍 탐색기 (P5.md 3.2). **한 컴포넌트 트리, 배치만 CSS** (P3M 원칙).
 *
 * 한 열 (< 768): 헤더 → 라인 바 → OOP|IP → 격자|히트맵 → 어그리게이트 → 하단 고정 바.
 * 2열 (768~1279): 왼쪽 격자 + 오른쪽 열(토글·어그리게이트·액션). 3열 (≥ 1280): 좌 트리 추가.
 *
 * 노드 종류는 **서버 코드**로만 안다 (D27): `useSolveNode` 가 `chance`/`terminal` 을
 * 데이터로 돌려주고, chance 일 때만 `runouts` 를 묻는다.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { HandClassIndex } from '@ggto/core';
import { useSolveNode, useSolveRunouts } from '../../api/queries';
import type { SolveNodeView } from '../../api/solve';
import { ChartNodeView } from '../ChartNodeView';
import { actionColors } from '../../lib/chartGrid';
import { childLine, parentLine, rootStreetOf, type StreetName } from '../../lib/solveLine';
import { actionFrequencies, displayReach, toChartNode } from '../../lib/solveGrid';
import type { SolveNotation } from '../../lib/solveNotation';
import { useMediaQuery } from '../../lib/layout';
import {
  BTN_ACTIVE,
  BTN_NEUTRAL,
  SURFACE,
  TEXT_BODY,
  TEXT_DIM,
  TEXT_ERROR,
  TEXT_LINK,
  TOUCH,
} from '../../lib/palette';
import { useUiStore } from '../../store/ui';
import { ActionButtons, type ActionBarState } from './ActionButtons';
import { AggregatePanel } from './AggregatePanel';
import { BoardCards } from './BoardCards';
import { LineBar } from './LineBar';
import { LineTree } from './LineTree';
import { RunoutHeatmap } from './RunoutHeatmap';

export interface SolveExplorerProps {
  hash: string;
  notation: SolveNotation | null;
  /** 목록 행의 요약 (딥링크로 들어오면 없을 수 있다) */
  summary: { exploitability: number; customSizings: boolean } | null;
  onBack: () => void;
  /** 저장된 표기가 이 솔브의 것이 아니다 → 지우고 정규 모드로 다시 연다 */
  onNotationMismatch: () => void;
  /** `정규 표기` 칩 탭 = 표기 입력 시트 */
  onEditNotation: () => void;
}

export function SolveExplorer(props: SolveExplorerProps): React.JSX.Element {
  const line = useUiStore((s) => s.solveLine);
  const setLine = useUiStore((s) => s.setSolveLine);
  const player = useUiStore((s) => s.solvePlayer);
  const setPlayer = useUiStore((s) => s.setSolvePlayer);
  const runoutPick = useUiStore((s) => s.runoutPick);
  const setRunoutPick = useUiStore((s) => s.setRunoutPick);
  const selectedClass = useUiStore((s) => s.selectedClass);
  const setSelectedClass = useUiStore((s) => s.setSelectedClass);
  const hoveredClass = useUiStore((s) => s.hoveredClass);
  const setHoveredClass = useUiStore((s) => s.setHoveredClass);

  const isXl = useMediaQuery('(min-width: 1280px)', true);
  const isMd = useMediaQuery('(min-width: 768px)', true);

  const nodeQuery = useSolveNode(props.hash, line, props.notation);
  const result = nodeQuery.data ?? null;
  const runoutsQuery = useSolveRunouts(props.hash, line, props.notation, result?.kind === 'chance');

  // 저장된 표기가 다른 게임이면 **지우고 정규 모드로** 다시 연다 (P5.md 4절).
  const mismatch = nodeQuery.error?.code === 'HashMismatch' && props.notation !== null;
  const onMismatch = props.onNotationMismatch;
  useEffect(() => {
    if (mismatch) onMismatch();
  }, [mismatch, onMismatch]);

  const node: SolveNodeView | null = result !== null && result.kind === 'node' ? result.node : null;
  const colors = useMemo(() => actionColors(node?.actions ?? []), [node?.actions]);
  // 격자에 누구를 그리는가. 기본은 **행동 플레이어** (라인이 바뀌면 store 가 null 로 되돌린다).
  const shown = player ?? node?.player ?? 'oop';
  const isActor = node !== null && shown === node.player;

  const runouts = runoutsQuery.data ?? null;

  /**
   * 마지막으로 **본** 보드와 스트리트. 터미널 노드(폴드·쇼다운)는 `node` 도 `runouts` 도
   * 없어서 헤더의 보드와 라인 바의 스트리트 라벨이 통째로 사라진다 — 실제로 `Flop`으로
   * 되돌아가는 것을 스크린샷에서 봤다. 터미널은 **카드를 더 깔지 않으므로** 직전 노드의
   * 보드가 곧 그 터미널의 보드다. 해시가 바뀌면 기억을 버린다 (다른 게임이다).
   */
  const lastSeen = useRef<{ hash: string; board: string; street: StreetName } | null>(null);
  if (node !== null) lastSeen.current = { hash: props.hash, board: node.board, street: node.street };
  else if (runouts !== null) {
    lastSeen.current = { hash: props.hash, board: runouts.board, street: streetOfBoard(runouts.board) };
  }
  const remembered = lastSeen.current?.hash === props.hash ? lastSeen.current : null;

  const board = node?.board ?? runouts?.board ?? remembered?.board ?? '';
  // 라인 바의 스트리트 라벨은 **솔브의 시작 스트리트**에서 나온다 (턴 솔브면 첫 칩이 `Turn`).
  // chance 노드에서는 `node` 가 없으므로 `runouts` 가 준 보드의 **장수**로 지금 스트리트를
  // 정한다 (3장=플랍 … ). 이것은 정규 보드 계산이 아니라 응답이 준 카드를 세는 것이다.
  const currentStreet =
    node?.street ?? (runouts !== null ? streetOfBoard(runouts.board) : (remembered?.street ?? 'flop'));
  const rootStreet = rootStreetOf(currentStreet, line);
  // `정규 표기` 칩은 **쿼리를 붙이지 않았을 때만** 그린다 (P5.md 1.2): 표기 모드인데
  // 순열이 우연히 항등인 경우가 있어 `perm` 만 보고 판정하면 거짓말이 된다.
  const canonicalChip = props.notation === null;

  const barState: ActionBarState =
    result === null
      ? { kind: 'loading' }
      : result.kind === 'chance'
        ? { kind: 'chance' }
        : result.kind === 'terminal'
          ? { kind: 'terminal' }
          : {
              kind: 'actions',
              actions: result.node.actions,
              freqs: actionFrequencies(result.node.aggregate, result.node.player),
              colors,
            };

  const go = (next: string): void => {
    setLine(next);
    setSelectedClass(null);
  };

  const header = (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="explorer-header">
      <button
        type="button"
        data-testid="explorer-back"
        aria-label="목록으로"
        className={`flex items-center justify-center rounded px-2 text-sm ${TOUCH} ${TEXT_LINK}`}
        onClick={props.onBack}
      >
        ←<span className="ml-1 hidden md:inline">목록</span>
      </button>
      {board === '' ? null : <BoardCards board={board} />}
      {node === null ? null : (
        <span className={`font-mono text-xs ${TEXT_DIM}`} data-testid="explorer-meta">
          {`pot ${(node.potChips / 100).toFixed(0)} · eff ${(Math.min(...node.stacksChips) / 100).toFixed(0)}`}
          {props.summary === null ? '' : ` · expl ${props.summary.exploitability.toFixed(2)}%`}
        </span>
      )}
      {canonicalChip ? (
        <button
          type="button"
          data-testid="notation-chip"
          className={`min-h-11 rounded px-2 text-xs ${BTN_NEUTRAL}`}
          onClick={props.onEditNotation}
        >
          {props.summary?.customSizings === true ? '정규 표기 · 커스텀 사이징' : '정규 표기'}
        </button>
      ) : null}
    </div>
  );

  const toggle = (
    <div className="flex items-center gap-2" data-testid="player-toggle">
      {(['oop', 'ip'] as const).map((p) => (
        <button
          key={p}
          type="button"
          data-testid={`player-${p}`}
          aria-pressed={shown === p}
          className={`min-h-11 rounded px-4 text-sm font-semibold ${shown === p ? BTN_ACTIVE : BTN_NEUTRAL}`}
          style={{ touchAction: 'manipulation' }}
          onClick={() => {
            setPlayer(p);
            setSelectedClass(null);
          }}
        >
          {p.toUpperCase()}
          {node !== null && node.player === p ? ' •' : ''}
        </button>
      ))}
      <span className={`hidden text-xs md:inline ${TEXT_DIM}`}>(• = 이 노드에서 행동하는 쪽)</span>
    </div>
  );

  const grid =
    result !== null && result.kind === 'chance' ? (
      runouts === null ? (
        <p className={`text-sm ${TEXT_DIM}`} data-testid="runouts-loading">
          런아웃을 부르는 중…
        </p>
      ) : (
        <RunoutHeatmap
          cards={runouts.cards}
          player={shown}
          picked={runoutPick}
          wide={isMd}
          onPick={setRunoutPick}
          onGo={(card) => {
            go(childLine(line, card));
          }}
        />
      )
    ) : (
      <ChartNodeView
        node={node === null ? null : toChartNode(node)}
        masked={false}
        highlightClass={null}
        // 행동 플레이어 쪽은 전략 레이어, 상대 쪽은 도달 레이어다 — 상대의 콤보별 EV 는
        // 응답에 없으므로 EV 열도 없다 (P5.md 1.5: 있다고 꾸미지 않는다).
        // 노드를 아직 못 받았으면 전략 모드로 둔다 — 로딩 한 프레임 동안 reach 패널이
        // 번쩍이는 것을 막는다.
        viewMode={isActor || node === null ? 'strategy' : 'reach'}
        colors={colors}
        resolution="1326"
        reachWeights={node === null ? null : displayReach(node.reach[shown === 'oop' ? 0 : 1] as Float32Array)}
        reachPos={shown.toUpperCase()}
        // 상대 쪽에는 콤보 패널이 없다 (상대의 콤보별 EV 가 응답에 없다) — `none` 이면
        // P2 의 reach 사이드 패널도 뜨지 않는다. 그 패널의 `mass %` 는 프리플랍 0..1
        // 가중치를 전제해 포스트플랍 정규화 가중치에서는 0% 로 읽힌다 (실측).
        // 도달 레인지의 크기는 어그리게이트 패널이 콤보 수로 말한다.
        panel={isActor ? 'below-collapsed' : 'none'}
        positionReach={[]}
        selectedClass={selectedClass}
        hoveredClass={hoveredClass}
        onSelectClass={(h: HandClassIndex) => {
          setSelectedClass(h);
        }}
        onHoverClass={setHoveredClass}
        placeholder={
          result !== null && result.kind === 'terminal'
            ? '종료 노드입니다 — 이전 노드로 돌아가세요.'
            : nodeQuery.isPending
              ? 'loading…'
              : '노드를 그릴 수 없습니다'
        }
      />
    );

  const aggregate = node === null ? null : <AggregatePanel node={node} colors={colors} />;
  const bar = (
    <ActionButtons
      state={barState}
      canBack={line !== ''}
      onBack={() => {
        go(parentLine(line));
      }}
      onPick={(a) => {
        go(childLine(line, a));
      }}
    />
  );

  const error = nodeQuery.error;
  return (
    <div className="flex min-h-dvh flex-col gap-3" data-testid="solve-explorer">
      {/*
        `>= md` 에서는 헤더와 라인 바가 **한 줄**이다. 두 줄이면 1280x720 에서 격자 상단이
        221px 로 밀려 520 격자의 아래 21px 이 화면 밖으로 나간다 (실측) — 데스크톱 회귀
        기준은 "격자·어그리게이트·액션이 세로 스크롤 없이 보인다" 이다 (P5.md 5절).
      */}
      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:gap-4">
        {header}
        <div className="min-w-0 md:flex-1">
          <LineBar line={line} rootStreet={rootStreet} onGo={go} />
        </div>
      </div>
      {error === null || error === undefined || mismatch ? null : (
        <p className={`text-sm ${TEXT_ERROR}`} data-testid="explorer-error">{`${error.code}: ${error.message}`}</p>
      )}

      <div className="flex min-w-0 gap-4 xl:gap-6">
        {isXl ? (
          <aside className={`w-48 shrink-0 rounded p-2 ${SURFACE}`}>
            <LineTree hash={props.hash} notation={props.notation} line={line} rootStreet={rootStreet} onGo={go} />
          </aside>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {isMd ? null : toggle}
          {grid}
          {isMd ? null : aggregate}
        </div>

        {isMd ? (
          <aside className="flex w-72 shrink-0 flex-col gap-3 xl:w-96" data-testid="explorer-aside">
            {toggle}
            {aggregate}
            {bar}
          </aside>
        ) : null}
      </div>

      {isMd ? null : bar}
      <p className={`text-xs ${TEXT_BODY}`} data-testid="explorer-hint">
        {result !== null && result.kind === 'chance'
          ? '스트리트가 닫혔습니다 — 런아웃 카드를 고르세요.'
          : '액션 버튼을 누르면 그 노드로 갑니다.'}
      </p>
    </div>
  );
}

/** 응답이 준 보드 문자열의 장수 → 스트리트. 5장 이상은 리버다 (더 깔릴 카드가 없다). */
function streetOfBoard(board: string): StreetName {
  const cards = board.length / 2;
  return cards >= 5 ? 'river' : cards === 4 ? 'turn' : 'flop';
}
