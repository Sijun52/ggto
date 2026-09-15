/**
 * `/solve` — 목록 · 새 솔브 · 진행 · 탐색기 (P5.md 3.1).
 *
 * 한 페이지가 네 단계를 가진다 (`solvePhase`). 라우터 라이브러리는 여전히 없다 (P2.md 1절):
 * URL 은 `?hash=&line=` 뿐이고 `replaceState` 로 맞춘다. **표기는 URL 에 넣지 않는다**
 * (D26: 레인지 텍스트 8KB + 남의 브라우저에서 400 이 된다).
 *
 * 솔버가 없는 PC 는 `/api/solves` 가 503 이다 — 배너 한 줄을 띄우고 폼을 잠근다.
 * **가짜 솔버로 떨어지지 않는다** (D24).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SolveListItemDto, SolvePostResponse } from '@ggto/protocol';
import { useSolveMutation, useSolves } from '../api/queries';
import { deleteSolve } from '../api/solve';
import { ApiError } from '../api/client';
import { EstimateSheet } from '../components/solve/EstimateSheet';
import { SolveExplorer } from '../components/solve/SolveExplorer';
import { SolveForm, type SolveFormValues } from '../components/solve/SolveForm';
import { SolveList } from '../components/solve/SolveList';
import { SolveProgress } from '../components/solve/SolveProgress';
import { presetNameOf } from '../lib/sizingPresets';
import { urlParam } from '../lib/defaults';
import {
  clearNotation,
  loadNotation,
  saveNotation,
  type SolveNotation,
} from '../lib/solveNotation';
import { PAGE, TEXT_DIM, TEXT_ERROR, TEXT_LINK, TEXT_STRONG, TEXT_WARN, TOUCH } from '../lib/palette';
import { usePageTitle } from '../lib/title';
import { useUiStore } from '../store/ui';

/** 폼의 첫 값. 레인지 텍스트 리터럴은 `defaults.ts` 규칙에 따라 여기 한 곳에만 둔다. */
const FORM_DEFAULTS: SolveFormValues = {
  board: '',
  oop: '',
  ip: '',
  potBb: 20,
  stackBb: 80,
  sizings: 'simple',
  compressed: false,
  rake: { mode: 'none' },
  targetExploitabilityPct: 0.5,
};

function readUrl(): { hash: string | null; line: string } {
  if (typeof window === 'undefined') return { hash: null, line: '' };
  const hash = urlParam(window.location.search, 'hash');
  return { hash: hash === null || hash === '' ? null : hash, line: urlParam(window.location.search, 'line') ?? '' };
}

export function SolvePage(): React.JSX.Element {
  const initial = useMemo(readUrl, []);
  const qc = useQueryClient();

  const phase = useUiStore((s) => s.solvePhase);
  const setPhase = useUiStore((s) => s.setSolvePhase);
  const hash = useUiStore((s) => s.solveHash);
  const line = useUiStore((s) => s.solveLine);
  const openSolve = useUiStore((s) => s.openSolve);
  const jobId = useUiStore((s) => s.solveJobId);
  const setJob = useUiStore((s) => s.setSolveJob);

  const [notation, setNotation] = useState<SolveNotation | null>(null);
  const [pendingNotation, setPendingNotation] = useState<SolveNotation | null>(null);
  const [sheet, setSheet] = useState<SolvePostResponse | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingNotation, setEditingNotation] = useState(false);

  usePageTitle('GGTO — Solve');

  const solves = useSolves();
  const unavailable = solves.error?.code === 'SolverUnavailable';
  const mutation = useSolveMutation();

  // URL 이 해시를 지정했으면 그 솔브를 연다 (딥링크). 표기는 localStorage 에서 찾는다.
  useEffect(() => {
    if (initial.hash === null) return;
    setNotation(loadNotation(initial.hash));
    openSolve(initial.hash, initial.line);
  }, [initial.hash, initial.line, openSolve]);

  // URL 동기화 — 뒤로가기 히스토리를 더럽히지 않게 replaceState (ChartsPage 와 같은 규칙).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const qs =
      phase === 'explore' && hash !== null
        ? `?hash=${encodeURIComponent(hash)}${line === '' ? '' : `&line=${encodeURIComponent(line)}`}`
        : '';
    window.history.replaceState(null, '', `/solve${qs}`);
  }, [phase, hash, line]);

  const openRow = (row: SolveListItemDto): void => {
    // 목록에서 여는 것은 **정규 표기**다 — 서버 행은 정규 hex 뿐이라 사용자의 표기를
    // 되살릴 수 없다 (D26). 같은 세션에서 폼으로 만든 것이면 localStorage 에 있다.
    setNotation(loadNotation(row.hash));
    openSolve(row.hash, '');
  };

  const submitForm = (values: SolveFormValues): void => {
    setFormError(null);
    const next: SolveNotation = {
      board: values.board,
      oop: values.oop,
      ip: values.ip,
      potBb: values.potBb,
      stackBb: values.stackBb,
      sizings: values.sizings,
      compressed: false,
      rake: { mode: 'none' },
    };
    setPendingNotation(next);
    mutation.mutate(
      {
        board: values.board,
        oop: values.oop,
        ip: values.ip,
        potBb: values.potBb,
        stackBb: values.stackBb,
        sizings: values.sizings,
        targetExploitabilityPct: values.targetExploitabilityPct,
      },
      {
        onSuccess: (res) => {
          // 표기는 `POST` 가 해시를 알려 주는 **이 순간** 저장한다 (캐시 히트든 새 잡이든).
          saveNotation(res.hash, next);
          if (res.cached) {
            setNotation(next);
            openSolve(res.hash, '');
            return;
          }
          setSheet(res);
        },
        onError: (e: ApiError) => {
          setFormError(
            e.code === 'TooLarge' ? `${e.message} (사이징을 줄이세요)` : `${e.code}: ${e.message}`,
          );
        },
      },
    );
  };

  const run = (): void => {
    const est = sheet;
    const next = pendingNotation;
    if (est === null || next === null) return;
    mutation.mutate(
      {
        board: next.board,
        oop: next.oop,
        ip: next.ip,
        potBb: next.potBb,
        stackBb: next.stackBb,
        sizings: next.sizings,
        confirm: true,
      },
      {
        onSuccess: (res) => {
          saveNotation(res.hash, next);
          setSheet(null);
          if (res.cached || res.jobId === null) {
            setNotation(next);
            openSolve(res.hash, '');
            return;
          }
          setJob(res.jobId);
          useUiStore.setState({ solveHash: res.hash });
          setPhase('running');
        },
        onError: (e: ApiError) => {
          setSheet(null);
          setFormError(e.code === 'TooLarge' ? `${e.message} (사이징을 줄이세요)` : `${e.code}: ${e.message}`);
          setPhase('form');
        },
      },
    );
  };

  const onJobDone = useCallback((): void => {
    const h = useUiStore.getState().solveHash;
    setJob(null);
    void qc.invalidateQueries({ queryKey: ['solves'] });
    if (h !== null) {
      // 같은 세션의 재솔브(REPLACE)는 같은 해시로 **새 파일**이다 — 노드 캐시를 버린다
      // (P4 R1 MAJOR 3 의 프론트 판).
      void qc.invalidateQueries({ queryKey: ['solve-node', h] });
      void qc.invalidateQueries({ queryKey: ['solve-runouts', h] });
      setNotation(pendingNotation);
      openSolve(h, '');
    }
  }, [qc, setJob, openSolve, pendingNotation]);

  const onJobCancelled = useCallback((): void => {
    setJob(null);
    setPhase('list');
  }, [setJob, setPhase]);

  const summary = useMemo(() => {
    const row = solves.data?.solves.find((s) => s.hash === hash);
    if (row === undefined) return null;
    return { exploitability: row.exploitability, customSizings: presetNameOf(row.sizings) === null };
  }, [solves.data, hash]);

  const header = (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <h1 className={`text-base font-semibold md:text-xl ${TEXT_STRONG}`}>Solve</h1>
      <a className={`flex items-center justify-center rounded px-2 text-sm ${TOUCH} ${TEXT_LINK}`} href="/">
        Range
      </a>
      <a className={`flex items-center justify-center rounded px-2 text-sm ${TOUCH} ${TEXT_LINK}`} href="/charts">
        Charts
      </a>
      <a className={`flex items-center justify-center rounded px-2 text-sm ${TOUCH} ${TEXT_LINK}`} href="/trainer">
        Trainer
      </a>
    </div>
  );

  return (
    <div className={`flex min-h-dvh flex-col p-4 md:p-6 ${PAGE}`} data-testid="solve-page">
      {header}
      {unavailable ? (
        <p className={`mb-2 text-sm ${TEXT_WARN}`} data-testid="solver-unavailable">
          이 PC 에는 솔버가 없습니다 (<code className="font-mono">npm run build:solver</code>)
        </p>
      ) : null}
      {solves.error !== null && solves.error !== undefined && !unavailable ? (
        <p className={`mb-2 text-sm ${TEXT_ERROR}`} data-testid="solves-error">
          {`${solves.error.code}: ${solves.error.message}`}
        </p>
      ) : null}
      {toast === null ? null : (
        <p className={`mb-2 text-sm ${TEXT_DIM}`} data-testid="solve-toast">
          {toast}
        </p>
      )}

      {phase === 'explore' && hash !== null ? (
        <>
          <SolveExplorer
            hash={hash}
            notation={notation}
            summary={summary}
            onBack={() => {
              setPhase('list');
            }}
            onNotationMismatch={() => {
              clearNotation(hash);
              setNotation(null);
              setToast('저장된 표기가 이 솔브와 맞지 않아 정규 표기로 엽니다');
            }}
            onEditNotation={() => {
              setEditingNotation(true);
            }}
          />
          {editingNotation ? (
            <SolveForm
              mode="notation"
              initial={{ ...FORM_DEFAULTS, ...(notation ?? {}) }}
              pending={false}
              error={formError}
              onCancel={() => {
                setEditingNotation(false);
                setFormError(null);
              }}
              onSubmit={(values) => {
                // 해시는 클라이언트가 계산하지 않는다 — **서버가** 이 표기가 이 솔브의
                // 것인지 판정한다 (1.2). 200 이면 저장, `HashMismatch` 면 시트 안 오류.
                const next: SolveNotation = {
                  board: values.board,
                  oop: values.oop,
                  ip: values.ip,
                  potBb: values.potBb,
                  stackBb: values.stackBb,
                  sizings: values.sizings,
                  compressed: false,
                  rake: { mode: 'none' },
                };
                void verifyNotation(hash, next).then(
                  () => {
                    saveNotation(hash, next);
                    setNotation(next);
                    setEditingNotation(false);
                    setFormError(null);
                  },
                  (e: unknown) => {
                    setFormError(
                      e instanceof ApiError && e.code === 'HashMismatch'
                        ? '이 솔브의 게임이 아닙니다'
                        : `${e instanceof Error ? e.message : String(e)}`,
                    );
                  },
                );
              }}
            />
          ) : null}
        </>
      ) : phase === 'running' && jobId !== null ? (
        <SolveProgress jobId={jobId} onDone={onJobDone} onCancelled={onJobCancelled} />
      ) : phase === 'form' ? (
        <>
          <SolveForm
            mode="new"
            initial={FORM_DEFAULTS}
            pending={mutation.isPending || unavailable}
            error={formError}
            onCancel={() => {
              setPhase('list');
              setFormError(null);
            }}
            onSubmit={submitForm}
          />
          {sheet === null ? null : (
            <EstimateSheet
              estimate={sheet}
              pending={mutation.isPending}
              onRun={run}
              onCancel={() => {
                setSheet(null);
              }}
            />
          )}
        </>
      ) : solves.data === undefined ? (
        <p className={`text-sm ${TEXT_DIM}`} data-testid="solves-loading">
          {unavailable ? '' : '불러오는 중…'}
        </p>
      ) : (
        <SolveList
          data={solves.data}
          deleting={deleting}
          onOpen={openRow}
          onNew={() => {
            setFormError(null);
            setPhase('form');
          }}
          onDelete={(h) => {
            setDeleting(true);
            void deleteSolve(h)
              .then(() => {
                clearNotation(h);
                void qc.invalidateQueries({ queryKey: ['solves'] });
              })
              .catch((e: unknown) => {
                setToast(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
              })
              .finally(() => {
                setDeleting(false);
              });
          }}
        />
      )}
    </div>
  );
}

/** 표기 검증: 루트 노드를 **표기 모드로 한 번** 부른다. 200 이면 이 솔브의 표기다. */
async function verifyNotation(hash: string, notation: SolveNotation): Promise<void> {
  const { fetchSolveNode } = await import('../api/solve');
  await fetchSolveNode(hash, '', notation);
}
