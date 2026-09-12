import type { FormEvent } from 'react';
import { useUiStore } from '../store/ui';

export interface RangeInputProps {
  pending: boolean;
  onSubmit: (text: string) => void;
}

/**
 * 입력 텍스트의 소유자는 zustand store 다 (P1.md 4.4). 컴포넌트 로컬 useState 를 두면
 * store 의 `rangeText` 가 아무도 읽지 않는 죽은 상태가 된다 (R1 MINOR 4).
 */
export function RangeInput(props: RangeInputProps): React.JSX.Element {
  const text = useUiStore((s) => s.rangeText);
  const setText = useUiStore((s) => s.setRangeText);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    props.onSubmit(text);
  };

  return (
    <form className="flex gap-2" onSubmit={submit}>
      <input
        aria-label="range text"
        className="w-[32rem] rounded border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-sm text-slate-100 outline-none focus:border-emerald-500"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <button
        type="submit"
        className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        disabled={props.pending}
      >
        Parse
      </button>
    </form>
  );
}
