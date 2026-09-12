/**
 * 답 버튼 / verdict 바 (P3M 4절).
 *
 * 모바일에서는 **하단 고정 바**다: 375×812 세로에서 한 손 엄지가 닿는 곳은 아래 1/4
 * (y ≥ 609) 뿐이고, 20문제를 한 손으로 돌려면 답 버튼과 "다음" 이 거기 있어야 한다.
 * 격자는 보기만 하므로 위에 있어도 된다. `md` 이상에서는 같은 컴포넌트가 우측 열
 * 상단에 그냥 놓인다 (`position` 만 CSS 로 갈린다 — DOM 은 하나다).
 *
 * **오탭 방지**: 답한 자리에 곧바로 "다음" 이 나타나면 두 번 탭한 손가락이 verdict 를
 * 못 보고 넘긴다. 공개 후 `NEXT_ARM_MS` 동안 "다음" 을 비활성으로 둔다.
 */

import { useEffect, useState } from 'react';
import type { GradeDto } from '@ggto/protocol';
import { GradeVerdict } from './GradeBox';
import { bestTextOn, BTN_DISABLED, BTN_NEXT, TEXT_DIM } from '../lib/palette';

/** 공개 직후 "다음" 이 잠겨 있는 시간 */
export const NEXT_ARM_MS = 500;

export interface AnswerBarProps {
  actions: readonly string[];
  colors: Record<string, string>;
  /** null 이면 출제 중 */
  grade: GradeDto | null;
  /** 답 제출 중 (버튼 잠금) */
  pending: boolean;
  onAnswer: (action: string) => void;
  onNext: () => void;
  nextLabel: string;
  /** 출제 중 안내 문구 (답 후에는 verdict 가 대신한다) */
  hint?: string;
}

export function AnswerBar(props: AnswerBarProps): React.JSX.Element {
  const { actions, colors, grade, pending } = props;
  const revealed = grade !== null;
  const armed = useArmedAfter(grade, NEXT_ARM_MS);

  return (
    <div
      data-testid="action-bar"
      className="sticky bottom-0 z-20 -mx-4 mt-auto flex flex-col gap-2 border-t border-[#334155] bg-[#020617] px-4 pt-2 md:static md:z-auto md:mx-0 md:mt-0 md:w-80 md:shrink-0 md:border-0 md:px-0 md:pt-0"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)' }}
    >
      <div className="flex gap-2" data-testid="answer-buttons">
        {actions.map((a, i) => {
          const color = colors[a] ?? '#a855f7';
          const chosen = grade?.chosenAction === a;
          const live = !revealed;
          return (
            <button
              key={a}
              type="button"
              data-testid={`answer-${a}`}
              disabled={revealed || pending}
              // 답 후에는 고른 것만 색을 남긴다. `opacity` 로 흐리지 않는다 — 대비가 같이 떨어진다.
              className={`min-h-12 flex-1 rounded text-base font-bold ${live || chosen ? '' : BTN_DISABLED} ${
                chosen ? 'ring-2 ring-[#f1f5f9]' : ''
              }`}
              style={
                live || chosen
                  ? { backgroundColor: color, color: bestTextOn(color), touchAction: 'manipulation' }
                  : { touchAction: 'manipulation' }
              }
              onClick={() => {
                props.onAnswer(a);
              }}
            >
              {a}
              <span className="hidden md:inline">{` (${String(i + 1)})`}</span>
            </button>
          );
        })}
      </div>

      {grade === null ? (
        props.hint === undefined ? null : (
          <p className={`text-xs ${TEXT_DIM}`} data-testid="answer-hint">
            {props.hint}
          </p>
        )
      ) : (
        <div data-testid="grade-box" className="flex flex-col gap-2">
          <GradeVerdict grade={grade} />
          <button
            type="button"
            data-testid="next-spot"
            disabled={!armed}
            className={`min-h-12 w-full rounded text-base font-bold ${armed ? BTN_NEXT : BTN_DISABLED}`}
            style={{ touchAction: 'manipulation' }}
            onClick={props.onNext}
          >
            {props.nextLabel}
          </button>
        </div>
      )}
    </div>
  );
}

/** `value` 가 null 이 아니게 된 순간부터 `ms` 뒤에 true. 다시 null 이 되면 false 로 돌아간다. */
function useArmedAfter(value: unknown, ms: number): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (value === null) {
      setArmed(false);
      return;
    }
    setArmed(false);
    const t = setTimeout(() => {
      setArmed(true);
    }, ms);
    return () => {
      clearTimeout(t);
    };
  }, [value, ms]);
  return armed;
}
