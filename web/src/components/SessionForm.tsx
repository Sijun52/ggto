/**
 * 세션 시작 폼 (P3.md 8.2). 카테고리는 **풀에 실제로 있는 것만** 보여준다 —
 * 고를 수 있는데 항상 `EmptyPool` 400 이 나는 선택지를 두지 않는다.
 */

import { useState } from 'react';
import type { Category, ChartSetDto } from '@ggto/protocol';
import { CATEGORY_LABEL } from '../api/trainer';

export interface SessionFormProps {
  sets: readonly ChartSetDto[];
  categories: readonly Category[];
  pending: boolean;
  error: string | null;
  onStart: (req: { count: number; sets: number[]; categories: Category[] }) => void;
}

const DEFAULT_COUNT = 20;

export function SessionForm(props: SessionFormProps): React.JSX.Element {
  const [count, setCount] = useState(DEFAULT_COUNT);
  // 기본은 전부 선택. 사용자가 체크를 풀면 그 목록이 필터가 된다.
  const [excludedSets, setExcludedSets] = useState<Set<number>>(new Set());
  const [excludedCats, setExcludedCats] = useState<Set<Category>>(new Set());

  const chosenSets = props.sets.filter((s) => !excludedSets.has(s.id)).map((s) => s.id);
  const chosenCats = props.categories.filter((c) => !excludedCats.has(c));

  return (
    <div data-testid="session-form" className="max-w-2xl text-sm">
      <h2 className="mb-2 font-semibold text-slate-200">세션 시작</h2>

      <label className="mb-3 flex items-center gap-2">
        <span className="text-slate-400">문제 수</span>
        <input
          data-testid="session-count"
          type="number"
          min={1}
          max={500}
          value={count}
          onChange={(e) => {
            setCount(Number(e.target.value));
          }}
          className="w-20 rounded bg-slate-800 px-2 py-1 font-mono"
        />
      </label>

      <fieldset className="mb-3">
        <legend className="mb-1 text-slate-400">차트셋</legend>
        {props.sets.length === 0 ? (
          <p className="text-amber-300" data-testid="session-no-sets">
            차트가 없습니다. <code className="font-mono">npm run seed</code> 로 시드 차트를 만드세요.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {props.sets.map((s) => (
              <label key={s.id} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  data-testid={`session-set-${String(s.id)}`}
                  checked={!excludedSets.has(s.id)}
                  onChange={() => {
                    setExcludedSets(toggle(excludedSets, s.id));
                  }}
                />
                {s.name}
                {s.hasEv ? '' : ' (빈도 채점)'}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="mb-3">
        <legend className="mb-1 text-slate-400">카테고리</legend>
        <div className="flex flex-wrap gap-3">
          {props.categories.map((c) => (
            <label key={c} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                data-testid={`session-cat-${c}`}
                checked={!excludedCats.has(c)}
                onChange={() => {
                  setExcludedCats(toggle(excludedCats, c));
                }}
              />
              {CATEGORY_LABEL[c]}
            </label>
          ))}
        </div>
      </fieldset>

      {props.error === null ? null : (
        <p className="mb-2 text-red-400" data-testid="session-error">
          {props.error}
        </p>
      )}

      <button
        type="button"
        data-testid="session-start"
        disabled={props.pending || chosenSets.length === 0 || chosenCats.length === 0}
        className="rounded bg-emerald-600 px-3 py-1 font-semibold text-emerald-50 disabled:bg-slate-700 disabled:text-slate-400"
        onClick={() => {
          props.onStart({ count, sets: chosenSets, categories: chosenCats });
        }}
      >
        {props.pending ? '시작하는 중…' : '세션 시작'}
      </button>
    </div>
  );
}

function toggle<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
