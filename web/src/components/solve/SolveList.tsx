/**
 * 저장된 솔브 목록 (P5.md 3.1).
 *
 * `< md` 는 **카드**, `≥ md` 는 표다 (P3M 6.4 규칙). 375px 에서 8열 표는 열이 겹친다.
 * 카드를 탭하면 탐색기가 **정규 표기**로 열린다 (표기를 모르기 때문이다 — D26).
 */

import { useState } from 'react';
import type { SolveListItemDto, SolveListResponse } from '@ggto/protocol';
import { BoardCards } from './BoardCards';
import { presetNameOf } from '../../lib/sizingPresets';
import { BTN_NEUTRAL, BTN_PRIMARY, SURFACE, TEXT_BODY, TEXT_DIM, TEXT_STRONG } from '../../lib/palette';

export interface SolveListProps {
  data: SolveListResponse;
  onOpen: (row: SolveListItemDto) => void;
  onDelete: (hash: string) => void;
  onNew: () => void;
  deleting: boolean;
}

function mb(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)}GB` : `${(bytes / 1024 ** 2).toFixed(1)}MB`;
}

export function ago(now: number, then: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return `${String(s)}초 전`;
  if (s < 3600) return `${String(Math.round(s / 60))}분 전`;
  if (s < 86_400) return `${String(Math.round(s / 3600))}시간 전`;
  return `${String(Math.round(s / 86_400))}일 전`;
}

export function sizingsLabel(sizings: string): string {
  return presetNameOf(sizings) ?? '커스텀';
}

export function SolveList(props: SolveListProps): React.JSX.Element {
  const [confirm, setConfirm] = useState<string | null>(null);
  const rows = [...props.data.solves].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  const now = Date.now();

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="solve-list">
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="new-solve"
          className={`min-h-12 flex-1 rounded text-sm font-bold ${BTN_PRIMARY}`}
          style={{ touchAction: 'manipulation' }}
          onClick={props.onNew}
        >
          + 새 솔브
        </button>
      </div>
      <p className={`font-mono text-xs ${TEXT_DIM}`} data-testid="solve-total">
        {`${mb(props.data.totalBytes)} / ${mb(props.data.capBytes)} · ${String(rows.length)}개`}
      </p>

      {rows.length === 0 ? (
        <p className={`text-sm ${TEXT_BODY}`} data-testid="solve-empty">
          저장된 솔브가 없습니다. <b>+ 새 솔브</b> 로 하나 만드세요.
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.hash} className={`flex flex-col gap-2 rounded p-3 ${SURFACE}`} data-testid={`solve-row-${row.hash}`}>
            <button
              type="button"
              data-testid={`solve-open-${row.hash}`}
              className="flex min-h-11 min-w-0 flex-wrap items-center gap-2 text-left"
              style={{ touchAction: 'manipulation' }}
              onClick={() => {
                props.onOpen(row);
              }}
            >
              <BoardCards board={row.boardCanonical} />
              <span className={`font-mono text-xs ${TEXT_STRONG}`}>
                {`${row.street} · pot ${row.potBb.toFixed(0)} / eff ${row.stackBb.toFixed(0)}`}
              </span>
              <span className={`font-mono text-xs ${TEXT_DIM}`}>
                {`${sizingsLabel(row.sizings)} · expl ${row.exploitability.toFixed(2)}% · ${mb(row.bytes)} · ${ago(
                  now,
                  row.lastUsedAt,
                )}`}
              </span>
            </button>
            <div className="flex items-center gap-2">
              {confirm === row.hash ? (
                <>
                  <span className={`min-w-0 flex-1 text-xs ${TEXT_BODY}`}>이 솔브를 지울까요? (되돌릴 수 없습니다)</span>
                  <button
                    type="button"
                    data-testid={`solve-delete-cancel-${row.hash}`}
                    className={`min-h-11 rounded px-3 text-xs ${BTN_NEUTRAL}`}
                    onClick={() => {
                      setConfirm(null);
                    }}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    data-testid={`solve-delete-confirm-${row.hash}`}
                    disabled={props.deleting}
                    className="min-h-11 rounded bg-[#f87171] px-3 text-xs font-bold text-[#450a0a]"
                    onClick={() => {
                      props.onDelete(row.hash);
                      setConfirm(null);
                    }}
                  >
                    삭제
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  data-testid={`solve-delete-${row.hash}`}
                  className={`min-h-11 rounded px-3 text-xs ${BTN_NEUTRAL}`}
                  style={{ touchAction: 'manipulation' }}
                  onClick={() => {
                    setConfirm(row.hash);
                  }}
                >
                  삭제
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
