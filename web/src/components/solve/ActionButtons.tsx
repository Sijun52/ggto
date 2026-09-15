/**
 * 다음 액션 버튼 (P5.md 3.2-6).
 *
 * `< md` 에서는 **하단 고정 바**다 — 한 손 엄지가 닿는 곳은 375×812 의 아래 1/4 뿐이고
 * (P3M 4절), **이 바가 곧 P6 트레이너의 답 버튼 자리**다: P6 는 같은 자리를 마스킹해
 * 출제한다. `≥ md` 에서는 우측 열의 같은 DOM 이다 (배치만 CSS — `AnswerBar` 와 같은 규칙).
 *
 * 채점 상태가 없으므로 `AnswerBar` 와 컴포넌트를 합치지 않는다 (P5.md 6절).
 */

import { bestTextOn, BTN_DISABLED, BTN_NEUTRAL, TEXT_DIM } from '../../lib/palette';

export type ActionBarState =
  | { kind: 'actions'; actions: readonly string[]; freqs: readonly number[]; colors: Record<string, string> }
  | { kind: 'chance' }
  | { kind: 'terminal' }
  | { kind: 'loading' };

export interface ActionButtonsProps {
  state: ActionBarState;
  /** 루트면 false — 되돌아갈 곳이 없다 */
  canBack: boolean;
  onBack: () => void;
  onPick: (action: string) => void;
}

/** 버튼 라벨의 빈도는 정수 % 다 — 375px 에서 소수 한 자리는 버튼을 두 줄로 밀어낸다. */
function pct(x: number): string {
  return `${String(Math.round(x * 100))}%`;
}

export function ActionButtons(props: ActionButtonsProps): React.JSX.Element {
  const { state } = props;
  return (
    <div
      data-testid="action-bar"
      className="sticky bottom-0 z-20 -mx-4 -mb-4 mt-auto flex min-h-16 flex-wrap items-center gap-2 border-t border-[#334155] bg-[#020617] px-4 pt-2 md:static md:z-auto md:mx-0 md:mb-0 md:mt-0 md:w-full md:border-0 md:px-0 md:pt-0"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)' }}
    >
      <button
        type="button"
        data-testid="line-back"
        aria-label="이전 노드로"
        disabled={!props.canBack}
        className={`h-11 w-11 shrink-0 rounded text-lg ${props.canBack ? BTN_NEUTRAL : BTN_DISABLED}`}
        style={{ touchAction: 'manipulation' }}
        onClick={props.onBack}
      >
        ←
      </button>

      {state.kind === 'actions' ? (
        // 액션이 5개를 넘으면 (프리셋 최대 6) 두 줄로 넘어간다 — 각 줄이 44px 이상이다.
        state.actions.map((a, i) => {
          const color = state.colors[a] ?? '#a855f7';
          return (
            <button
              key={a}
              type="button"
              data-testid={`solve-action-${a}`}
              className="min-h-12 min-w-24 flex-1 rounded px-2 text-base font-bold"
              style={{ backgroundColor: color, color: bestTextOn(color), touchAction: 'manipulation' }}
              onClick={() => {
                props.onPick(a);
              }}
            >
              {a}
              <span className="ml-1 font-mono text-sm font-normal">{pct(state.freqs[i] ?? 0)}</span>
            </button>
          );
        })
      ) : state.kind === 'chance' ? (
        <span className={`min-h-12 flex-1 self-center text-sm ${TEXT_DIM}`} data-testid="action-bar-chance">
          카드를 고르세요 ↑
        </span>
      ) : state.kind === 'terminal' ? (
        <span className={`min-h-12 flex-1 self-center text-sm ${TEXT_DIM}`} data-testid="action-bar-terminal">
          종료 노드 — 이전으로
        </span>
      ) : (
        <span className={`min-h-12 flex-1 self-center text-sm ${TEXT_DIM}`} data-testid="action-bar-loading">
          불러오는 중…
        </span>
      )}
    </div>
  );
}
