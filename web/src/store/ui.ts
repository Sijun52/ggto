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
}

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
}));
