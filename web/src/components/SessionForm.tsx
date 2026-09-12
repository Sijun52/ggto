/**
 * 세션 시작 폼 (P3.md 8.2 / P3M 6.5). 카테고리는 **풀에 실제로 있는 것만** 보여준다 —
 * 고를 수 있는데 항상 `EmptyPool` 400 이 나는 선택지를 두지 않는다.
 *
 * 체크박스(13px) 대신 **전폭 토글 행**이다: 손가락으로 13px 사각형을 맞출 수 없다.
 * 행 전체가 `label` 이라 어디를 눌러도 토글된다 (P3M 4절, 44px).
 */

import { useState } from 'react';
import type { Category, ChartSetDto } from '@ggto/protocol';
import { CATEGORY_LABEL } from '../api/trainer';
import { BTN_DISABLED, BTN_PRIMARY, SURFACE, TEXT_BODY, TEXT_DIM, TEXT_ERROR, TEXT_STRONG, TEXT_WARN } from '../lib/palette';

export interface SessionFormProps {
  sets: readonly ChartSetDto[];
  categories: readonly Category[];
  pending: boolean;
  error: string | null;
  onStart: (req: { count: number; sets: number[]; categories: Category[] }) => void;
}

const DEFAULT_COUNT = 20;

function ToggleRow(props: {
  testId: string;
  checked: boolean;
  label: string;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <label
      className={`flex min-h-11 w-full cursor-pointer items-center gap-3 rounded px-3 py-2 text-sm ${SURFACE} ${
        props.checked ? TEXT_STRONG : TEXT_DIM
      }`}
      style={{ touchAction: 'manipulation' }}
    >
      {/* 44×44 히트 영역 (P3M 4절). 13px 네이티브 체크박스는 손가락으로 못 맞춘다. */}
      <input
        type="checkbox"
        data-testid={props.testId}
        checked={props.checked}
        onChange={props.onToggle}
        className="h-11 w-11 shrink-0 appearance-none rounded-lg bg-[#334155] bg-clip-content p-3 checked:bg-[#34d399] md:h-6 md:w-6 md:p-1"
      />
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      <span aria-hidden className="shrink-0">
        {props.checked ? '✓' : ''}
      </span>
    </label>
  );
}

export function SessionForm(props: SessionFormProps): React.JSX.Element {
  const [count, setCount] = useState(DEFAULT_COUNT);
  // 기본은 전부 선택. 사용자가 체크를 풀면 그 목록이 필터가 된다.
  const [excludedSets, setExcludedSets] = useState<Set<number>>(new Set());
  const [excludedCats, setExcludedCats] = useState<Set<Category>>(new Set());

  const chosenSets = props.sets.filter((s) => !excludedSets.has(s.id)).map((s) => s.id);
  const chosenCats = props.categories.filter((c) => !excludedCats.has(c));
  const disabled = props.pending || chosenSets.length === 0 || chosenCats.length === 0;

  return (
    <div data-testid="session-form" className={`w-full max-w-2xl text-sm ${TEXT_BODY}`}>
      <h2 className={`mb-2 font-semibold ${TEXT_STRONG}`}>세션 시작</h2>

      <label className="mb-3 flex min-h-11 items-center gap-3">
        <span className={TEXT_DIM}>문제 수</span>
        <input
          data-testid="session-count"
          type="number"
          inputMode="numeric"
          min={1}
          max={500}
          value={count}
          onChange={(e) => {
            setCount(Number(e.target.value));
          }}
          className={`min-h-11 w-24 rounded px-3 font-mono ${SURFACE} ${TEXT_STRONG}`}
        />
      </label>

      <fieldset className="mb-3">
        <legend className={`mb-1 ${TEXT_DIM}`}>차트셋</legend>
        {props.sets.length === 0 ? (
          <p className={TEXT_WARN} data-testid="session-no-sets">
            차트가 없습니다. <code className="font-mono">npm run seed</code> 로 시드 차트를 만드세요.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {props.sets.map((s) => (
              <ToggleRow
                key={s.id}
                testId={`session-set-${String(s.id)}`}
                checked={!excludedSets.has(s.id)}
                label={`${s.name}${s.hasEv ? '' : ' (빈도 채점)'}`}
                onToggle={() => {
                  setExcludedSets(toggle(excludedSets, s.id));
                }}
              />
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="mb-3">
        <legend className={`mb-1 ${TEXT_DIM}`}>카테고리</legend>
        <div className="flex flex-col gap-2">
          {props.categories.map((c) => (
            <ToggleRow
              key={c}
              testId={`session-cat-${c}`}
              checked={!excludedCats.has(c)}
              label={CATEGORY_LABEL[c]}
              onToggle={() => {
                setExcludedCats(toggle(excludedCats, c));
              }}
            />
          ))}
        </div>
      </fieldset>

      {props.error === null ? null : (
        <p className={`mb-2 ${TEXT_ERROR}`} data-testid="session-error">
          {props.error}
        </p>
      )}

      <button
        type="button"
        data-testid="session-start"
        disabled={disabled}
        className={`min-h-12 w-full rounded px-3 text-base font-semibold ${disabled ? BTN_DISABLED : BTN_PRIMARY}`}
        style={{ touchAction: 'manipulation' }}
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
