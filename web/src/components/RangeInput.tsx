import type { FormEvent } from 'react';
import { useUiStore } from '../store/ui';
import { BTN_PRIMARY, SURFACE, TEXT_STRONG } from '../lib/palette';

export interface RangeInputProps {
  pending: boolean;
  onSubmit: (text: string) => void;
}

/**
 * 입력 텍스트의 소유자는 zustand store 다 (P1.md 4.4). 컴포넌트 로컬 useState 를 두면
 * store 의 `rangeText` 가 아무도 읽지 않는 죽은 상태가 된다 (R1 MINOR 4).
 *
 * 폭은 `w-full` 이다 — 고정 `w-[32rem]` 은 375px 뷰포트를 넘어 layout viewport 를
 * 넓히고 페이지 전체를 축소시킨다 (P3M 3절).
 */
export function RangeInput(props: RangeInputProps): React.JSX.Element {
  const text = useUiStore((s) => s.rangeText);
  const setText = useUiStore((s) => s.setRangeText);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    props.onSubmit(text);
  };

  return (
    <form className="flex w-full min-w-0 gap-2" onSubmit={submit}>
      <input
        aria-label="range text"
        className={`min-h-11 w-full min-w-0 rounded border border-[#334155] px-3 font-mono text-sm md:w-[32rem] ${SURFACE} ${TEXT_STRONG}`}
        value={text}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <button
        type="submit"
        className={`min-h-11 shrink-0 rounded px-4 text-sm font-semibold ${BTN_PRIMARY}`}
        style={{ touchAction: 'manipulation' }}
        disabled={props.pending}
      >
        Parse
      </button>
    </form>
  );
}
