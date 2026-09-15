import type { FormEvent } from 'react';
import { useUiStore } from '../store/ui';
import { BTN_PRIMARY, SURFACE, TEXT_STRONG } from '../lib/palette';

export interface RangeInputProps {
  pending: boolean;
  onSubmit: (text: string) => void;
  /**
   * 제어 모드. 솔브 폼처럼 **한 화면에 레인지 입력이 둘** 이면 store 의 단일 `rangeText`
   * 를 쓸 수 없다 (OOP 와 IP 가 같은 값을 공유하게 된다). 주면 이 값이 정본이다.
   */
  value?: string;
  onChange?: (text: string) => void;
  /** 스크린 리더 라벨 (기본 `range text`) */
  label?: string;
  /** 제출 버튼을 숨긴다 — 바깥 폼이 통째로 제출할 때 (P5 솔브 폼) */
  hideSubmit?: boolean;
}

/**
 * 입력 텍스트의 소유자는 기본적으로 zustand store 다 (P1.md 4.4). 컴포넌트 로컬 useState 를
 * 두면 store 의 `rangeText` 가 아무도 읽지 않는 죽은 상태가 된다 (R1 MINOR 4).
 *
 * 폭은 `w-full` 이다 — 고정 `w-[32rem]` 은 375px 뷰포트를 넘어 layout viewport 를
 * 넓히고 페이지 전체를 축소시킨다 (P3M 3절).
 */
export function RangeInput(props: RangeInputProps): React.JSX.Element {
  const storeText = useUiStore((s) => s.rangeText);
  const setStoreText = useUiStore((s) => s.setRangeText);
  const controlled = props.value !== undefined;
  const text = controlled ? (props.value as string) : storeText;

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    props.onSubmit(text);
  };

  const input = (
    <input
      aria-label={props.label ?? 'range text'}
      className={`min-h-11 w-full min-w-0 rounded border border-[#334155] px-3 font-mono text-sm ${
        props.hideSubmit === true ? '' : 'md:w-[32rem]'
      } ${SURFACE} ${TEXT_STRONG}`}
      value={text}
      spellCheck={false}
      autoCapitalize="none"
      autoCorrect="off"
      onChange={(e) => {
        if (controlled) props.onChange?.(e.target.value);
        else setStoreText(e.target.value);
      }}
    />
  );

  // 바깥에 이미 `form` 이 있는 경우 (솔브 폼) 중첩 form 은 HTML 이 금지한다.
  if (props.hideSubmit === true) return <div className="flex w-full min-w-0 gap-2">{input}</div>;

  return (
    <form className="flex w-full min-w-0 gap-2" onSubmit={submit}>
      {input}
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
