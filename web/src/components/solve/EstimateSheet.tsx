/**
 * 사전 확인 시트 (P5.md 3.1, P4.md 5.2).
 *
 * 솔브는 GB 와 분 단위를 먹는다 — **누르기 전에** 얼마인지 보여주고 사용자가 결정한다.
 * `cached` 면 연산이 없으므로 시트 대신 바로 열린다 (호출부가 그렇게 쓴다).
 */

import type { SolvePostResponse } from '@ggto/protocol';
import { BTN_NEUTRAL, BTN_PRIMARY, SURFACE, TEXT_BODY, TEXT_DIM, TEXT_STRONG } from '../../lib/palette';

export interface EstimateSheetProps {
  estimate: SolvePostResponse;
  pending: boolean;
  onRun: () => void;
  onCancel: () => void;
}

function gb(bytes: number): string {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)}GB`
    : `${(bytes / 1024 ** 2).toFixed(0)}MB`;
}

function seconds(s: number): string {
  return s >= 90 ? `약 ${String(Math.round(s / 60))}분` : `약 ${String(Math.max(1, Math.round(s)))}초`;
}

export function EstimateSheet(props: EstimateSheetProps): React.JSX.Element {
  const { estimate } = props;
  return (
    <div
      data-testid="estimate-sheet"
      className={`sticky bottom-0 z-20 -mx-4 -mb-4 flex flex-col gap-3 border-t border-[#334155] px-4 pt-3 md:static md:mx-0 md:mb-0 md:rounded md:border ${SURFACE}`}
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
    >
      <p className={`text-sm ${TEXT_STRONG}`}>이 솔브를 실행할까요?</p>
      <p className={`font-mono text-sm ${TEXT_BODY}`} data-testid="estimate-line">
        {`예상 메모리 ${gb(estimate.estMemoryBytes)} · ${seconds(estimate.estSeconds)} · ${
          estimate.cached ? '캐시됨' : '캐시 없음'
        }`}
      </p>
      <p className={`font-mono text-xs ${TEXT_DIM}`} data-testid="estimate-board">{`board ${estimate.board}`}</p>
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="estimate-cancel"
          className={`min-h-12 flex-1 rounded text-sm font-semibold ${BTN_NEUTRAL}`}
          style={{ touchAction: 'manipulation' }}
          onClick={props.onCancel}
        >
          취소
        </button>
        <button
          type="button"
          data-testid="estimate-run"
          disabled={props.pending}
          className={`min-h-12 flex-1 rounded text-base font-bold ${props.pending ? BTN_NEUTRAL : BTN_PRIMARY}`}
          style={{ touchAction: 'manipulation' }}
          onClick={props.onRun}
        >
          실행
        </button>
      </div>
    </div>
  );
}
