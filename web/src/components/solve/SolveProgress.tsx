/**
 * 솔브 진행 화면 (P5.md 3.1, P4.md 7절 SSE).
 *
 * 연결이 끊기면 3초 뒤 다시 붙는다 — 서버가 붙는 즉시 **현재 상태를 한 번** 보내므로
 * 끊긴 동안 끝난 잡의 `done` 도 받는다. 그래서 "진행률 42% 에서 영원히 멈춤" 이 없다.
 */

import { useEffect, useState } from 'react';
import { cancelSolveJob } from '../../api/solve';
import { BTN_NEUTRAL, SURFACE, TEXT_BODY, TEXT_DIM, TEXT_ERROR, TEXT_STRONG } from '../../lib/palette';

interface JobEventData {
  jobId: string;
  hash: string;
  status: string;
  progress?: { iter: number; exploitabilityPct: number; pct: number };
  error?: { code: string; message: string };
}

export interface SolveProgressProps {
  jobId: string;
  onDone: () => void;
  onCancelled: () => void;
}

export function SolveProgress(props: SolveProgressProps): React.JSX.Element {
  const [status, setStatus] = useState('queued');
  const [progress, setProgress] = useState<NonNullable<JobEventData['progress']> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { jobId, onDone, onCancelled } = props;

  useEffect(() => {
    if (typeof EventSource !== 'function') {
      setError('이 브라우저는 SSE(EventSource) 를 지원하지 않습니다');
      return;
    }
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const handle = (e: MessageEvent<string>): void => {
      const data = JSON.parse(e.data) as JobEventData;
      setStatus(data.status);
      if (data.progress !== undefined) setProgress(data.progress);
      if (data.status === 'done') {
        closed = true;
        source?.close();
        onDone();
      }
      if (data.status === 'failed') {
        setError(`${data.error?.code ?? 'Failed'}: ${data.error?.message ?? '솔브가 실패했습니다'}`);
        closed = true;
        source?.close();
      }
      if (data.status === 'cancelled') {
        closed = true;
        source?.close();
        onCancelled();
      }
    };

    const connect = (): void => {
      source = new EventSource(`/api/solve/${jobId}/events`);
      for (const name of ['progress', 'done', 'failed', 'cancelled']) {
        source.addEventListener(name, handle as EventListener);
      }
      source.onerror = (): void => {
        source?.close();
        if (closed) return;
        // 끊김은 정상이다 (프록시·절전). 3초 뒤 다시 붙으면 서버가 현재 상태를 먼저 준다.
        retry = setTimeout(connect, 3000);
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry !== null) clearTimeout(retry);
      source?.close();
    };
  }, [jobId, onDone, onCancelled]);

  const pct = progress === null ? 0 : Math.max(0, Math.min(1, progress.pct));
  return (
    <div className={`flex flex-col gap-3 rounded p-3 ${SURFACE}`} data-testid="solve-progress">
      <p className={`text-sm ${TEXT_STRONG}`}>{`솔브 중 — ${status}`}</p>
      <div className="h-3 w-full rounded-sm bg-[#1e293b]">
        <div className="h-3 rounded-sm bg-[#34d399]" style={{ width: `${String(pct * 100)}%` }} data-testid="progress-bar" />
      </div>
      <p className={`font-mono text-xs ${TEXT_BODY}`} data-testid="progress-line">
        {progress === null
          ? '대기 중…'
          : `iter ${String(progress.iter)} · expl ${progress.exploitabilityPct.toFixed(2)}% · ${String(
              Math.round(pct * 100),
            )}%`}
      </p>
      {error === null ? null : (
        <p className={`text-sm ${TEXT_ERROR}`} data-testid="progress-error">
          {error}
        </p>
      )}
      <button
        type="button"
        data-testid="progress-cancel"
        className={`min-h-12 w-full rounded text-sm font-semibold ${BTN_NEUTRAL}`}
        style={{ touchAction: 'manipulation' }}
        onClick={() => {
          // 취소는 서버가 확인해 준다 — 여기서 화면만 바꾸지 않는다 (잡은 계속 돌 수 있다).
          void cancelSolveJob(jobId).catch((e: unknown) => {
            setError(`취소 실패: ${e instanceof Error ? e.message : String(e)}`);
          });
        }}
      >
        취소
      </button>
      <p className={`text-xs ${TEXT_DIM}`}>진행 중에도 다른 화면으로 갈 수 있습니다 — 잡은 서버에서 계속 돕니다.</p>
    </div>
  );
}
