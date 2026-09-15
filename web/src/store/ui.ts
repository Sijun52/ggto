import { create } from 'zustand';
import type { HandClassIndex } from '@ggto/core';

/** 격자가 무엇을 그리는가. P2.md 9 */
export type ChartViewMode = 'strategy' | 'reach';

/** 서버 데이터는 여기 두지 않는다 — TanStack Query 캐시가 정본이다 (P1.md 4.4). */
export interface UiState {
  rangeText: string;
  setRangeText: (text: string) => void;
  selectedClass: HandClassIndex | null;
  setSelectedClass: (h: HandClassIndex | null) => void;
  hoveredClass: HandClassIndex | null;
  setHoveredClass: (h: HandClassIndex | null) => void;

  // --- P2 차트 뷰어 ---
  chartSetId: number | null;
  setChartSetId: (id: number | null) => void;
  /** 현재 노드의 정규 액션 문자열. 루트는 '' */
  seq: string;
  setSeq: (seq: string) => void;
  viewMode: ChartViewMode;
  setViewMode: (mode: ChartViewMode) => void;
  /** reach 모드에서 어느 포지션의 도달 레인지를 볼 것인가 (탭). null = 노드의 히어로 */
  selectedPos: string | null;
  setSelectedPos: (pos: string | null) => void;

  // --- P3 트레이너 (P3.md 8.2) ---
  /** 서버 데이터(스팟/채점/리포트)는 TanStack 캐시가 정본이다. 여기는 화면 상태뿐이다. */
  sessionId: number | null;
  /** 세션 안에서 몇 번째 문제인가 (next 질의 키) */
  spotIndex: number;
  phase: TrainerPhase;
  /** 스팟이 렌더된 시각 (msTaken 의 기준). performance.now 가 아니라 Date.now — 서버가 ms 만 본다 */
  spotShownAt: number;
  trainerTab: TrainerTab;
  setTrainerTab: (tab: TrainerTab) => void;
  startSession: (sessionId: number) => void;
  showSpot: (at: number) => void;
  revealSpot: () => void;
  advanceSpot: () => void;
  finishSession: () => void;
  resetSession: () => void;

  // --- P5 솔브 탐색기 (P5.md 4절). 화면 상태만 — 노드 데이터는 TanStack 캐시가 정본이다 ---
  solveHash: string | null;
  solveLine: string;
  /** 격자에 누구의 레인지를 그리는가. null = 행동 플레이어 (라인이 바뀌면 여기로 돌아온다) */
  solvePlayer: 'oop' | 'ip' | null;
  solvePhase: SolvePhase;
  /** 진행 중인 잡 (SSE 구독 대상) */
  solveJobId: string | null;
  /** 히트맵에서 상태줄에 올린 카드 (2단계 탭의 1단계) */
  runoutPick: string | null;
  openSolve: (hash: string, line: string) => void;
  setSolveLine: (line: string) => void;
  setSolvePlayer: (p: 'oop' | 'ip' | null) => void;
  setSolvePhase: (phase: SolvePhase) => void;
  setSolveJob: (jobId: string | null) => void;
  setRunoutPick: (card: string | null) => void;
}

/** `/solve` 한 페이지의 단계 (P5.md 3.1) */
export type SolvePhase = 'list' | 'form' | 'running' | 'explore';

/** 출제 화면(asking) → 해설 화면(revealed) 은 **같은 화면의 마스크 해제**다 (DESIGN 6.5). */
export type TrainerPhase = 'idle' | 'asking' | 'revealed' | 'done';
export type TrainerTab = 'session' | 'report';

export const useUiStore = create<UiState>()((set) => ({
  rangeText: '',
  setRangeText: (rangeText) => {
    set({ rangeText });
  },
  selectedClass: null,
  setSelectedClass: (selectedClass) => {
    set({ selectedClass });
  },
  hoveredClass: null,
  setHoveredClass: (hoveredClass) => {
    set({ hoveredClass });
  },
  chartSetId: null,
  setChartSetId: (chartSetId) => {
    // 차트셋을 바꾸면 이전 차트의 노드/선택은 의미가 없다.
    set({ chartSetId, seq: '', selectedClass: null, selectedPos: null });
  },
  seq: '',
  setSeq: (seq) => {
    set({ seq });
  },
  viewMode: 'strategy',
  setViewMode: (viewMode) => {
    set({ viewMode });
  },
  selectedPos: null,
  setSelectedPos: (selectedPos) => {
    set({ selectedPos });
  },

  sessionId: null,
  spotIndex: 0,
  phase: 'idle',
  spotShownAt: 0,
  trainerTab: 'session',
  setTrainerTab: (trainerTab) => {
    set({ trainerTab });
  },
  startSession: (sessionId) => {
    set({ sessionId, spotIndex: 0, phase: 'asking', spotShownAt: 0, trainerTab: 'session' });
  },
  showSpot: (spotShownAt) => {
    set({ spotShownAt });
  },
  revealSpot: () => {
    set({ phase: 'revealed' });
  },
  advanceSpot: () => {
    set((s) => ({ spotIndex: s.spotIndex + 1, phase: 'asking', spotShownAt: 0 }));
  },
  finishSession: () => {
    set({ phase: 'done' });
  },
  resetSession: () => {
    set({ sessionId: null, spotIndex: 0, phase: 'idle', spotShownAt: 0 });
  },

  solveHash: null,
  solveLine: '',
  solvePlayer: null,
  solvePhase: 'list',
  solveJobId: null,
  runoutPick: null,
  openSolve: (solveHash, solveLine) => {
    set({ solveHash, solveLine, solvePhase: 'explore', solvePlayer: null, runoutPick: null, selectedClass: null });
  },
  setSolveLine: (solveLine) => {
    // 라인이 바뀌면 행동 플레이어로 돌아간다 (P5.md 3.2-3) — 새 노드에서 "상대" 가 누구인지
    // 사용자가 다시 생각하게 두지 않는다. 히트맵의 1단계 탭도 무효다.
    set({ solveLine, solvePlayer: null, runoutPick: null });
  },
  setSolvePlayer: (solvePlayer) => {
    set({ solvePlayer });
  },
  setSolvePhase: (solvePhase) => {
    set({ solvePhase });
  },
  setSolveJob: (solveJobId) => {
    set({ solveJobId });
  },
  setRunoutPick: (runoutPick) => {
    set({ runoutPick });
  },
}));
