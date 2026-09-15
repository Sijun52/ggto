/**
 * 새 솔브 폼 / 표기 입력 시트 (P5.md 3.1 · 1.2). **같은 컴포넌트**다 — 두 화면이 요구하는
 * 것이 정확히 같다 (보드·레인지 둘·팟·스택·프리셋). `mode` 는 제출 버튼 문구와
 * "목표 정확도" 줄의 유무만 가른다.
 *
 * 레인지 콤보 수는 **`@ggto/core` 로 브라우저에서** 센다. 서버 `/api/range/parse` 를
 * 타이핑마다 부르는 대신 같은 파서를 그대로 쓰는 것이다 (로직이 둘이 되는 것이 아니다 —
 * 서버도 이 파서를 쓴다). 제출 뒤 정답은 여전히 서버가 판정한다 (`HashMismatch`).
 *
 * `compressed` 토글은 **만들지 않는다** (P4.md 3.4-R / D28: 압축 솔브는 채점에 쓰지 않는다).
 */

import { useState } from 'react';
import { comboCount, parseCards, parseRange } from '@ggto/core';
import type { SizingPresetName } from '@ggto/protocol';
import { RangeInput } from '../RangeInput';
import { PRESET_NAMES, presetLabel } from '../../lib/sizingPresets';
import type { SolveNotation } from '../../lib/solveNotation';
import { BTN_NEUTRAL, BTN_PRIMARY, SURFACE, TEXT_DIM, TEXT_ERROR, TEXT_STRONG } from '../../lib/palette';

export interface SolveFormValues extends SolveNotation {
  targetExploitabilityPct: number;
}

export interface SolveFormProps {
  mode: 'new' | 'notation';
  initial: SolveFormValues;
  pending: boolean;
  /** 시트 안에 보여줄 서버 오류 (표기 모드의 `HashMismatch` 등) */
  error?: string | null;
  onSubmit: (values: SolveFormValues) => void;
  onCancel: () => void;
}

const TARGETS = [0.5, 0.3, 0.1];

/**
 * 빈 칸은 **오류가 아니다** (아직 안 친 것이다) — 빨간 글씨는 사용자가 뭔가 잘못했다는
 * 뜻이어야 한다. 빈 칸은 회색 안내로 두고 제출 버튼만 잠근다.
 */
interface FieldInfo {
  ok: boolean;
  message?: string;
  /** 아직 아무것도 치지 않았다 (오류가 아니다) */
  empty?: true;
  combos?: number;
  cards?: number;
}

function describeRange(text: string): FieldInfo {
  if (text.trim() === '') return { ok: false, message: '예: 22+,A2s+ (아직 비어 있습니다)', empty: true };
  try {
    return { ok: true, combos: comboCount(parseRange(text)) };
  } catch (e) {
    if (e instanceof Error && (e.name === 'RangeSyntaxError' || e.name === 'EmptyRangeError')) {
      return { ok: false, message: e.message };
    }
    throw e;
  }
}

function describeBoard(text: string): FieldInfo {
  if (text.trim() === '') return { ok: false, message: '예: Ks7h2h (3~5장)', empty: true };
  try {
    const cards = parseCards(text);
    if (cards.length < 3 || cards.length > 5) return { ok: false, message: '보드는 3~5장입니다' };
    return { ok: true, cards: cards.length };
  } catch (e) {
    if (e instanceof Error && e.name === 'CardSyntaxError') return { ok: false, message: e.message };
    throw e;
  }
}

export function SolveForm(props: SolveFormProps): React.JSX.Element {
  const [board, setBoard] = useState(props.initial.board);
  const [oop, setOop] = useState(props.initial.oop);
  const [ip, setIp] = useState(props.initial.ip);
  const [potBb, setPotBb] = useState(String(props.initial.potBb));
  const [stackBb, setStackBb] = useState(String(props.initial.stackBb));
  const [sizings, setSizings] = useState<SizingPresetName>(props.initial.sizings);
  const [target, setTarget] = useState(props.initial.targetExploitabilityPct);

  const boardInfo = describeBoard(board);
  const oopInfo = describeRange(oop);
  const ipInfo = describeRange(ip);
  const pot = Number(potBb);
  const stack = Number(stackBb);
  const numbersOk = Number.isFinite(pot) && pot > 0 && Number.isFinite(stack) && stack > 0;
  const valid = boardInfo.ok && oopInfo.ok && ipInfo.ok && numbersOk;

  const submit = (): void => {
    if (!valid) return;
    props.onSubmit({
      board,
      oop,
      ip,
      potBb: pot,
      stackBb: stack,
      sizings,
      compressed: false,
      rake: { mode: 'none' },
      targetExploitabilityPct: target,
    });
  };

  return (
    <form
      className={`flex w-full min-w-0 flex-col gap-3 rounded p-3 ${SURFACE}`}
      data-testid="solve-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="flex min-h-11 flex-col gap-1">
        <span className={`text-sm ${TEXT_STRONG}`}>보드</span>
        <input
          aria-label="board"
          data-testid="form-board"
          inputMode="text"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          className="min-h-11 w-full min-w-0 rounded border border-[#334155] bg-[#020617] px-3 font-mono text-sm"
          value={board}
          onChange={(e) => {
            setBoard(e.target.value);
          }}
        />
      </label>
      <p
        className={`-mt-2 font-mono text-xs ${boardInfo.ok || boardInfo.empty === true ? TEXT_DIM : TEXT_ERROR}`}
        data-testid="form-board-info"
      >
        {boardInfo.ok ? `${String(boardInfo.cards ?? 0)}장` : boardInfo.message}
      </p>

      <div className="flex flex-col gap-1">
        <span className={`text-sm ${TEXT_STRONG}`}>OOP 레인지</span>
        <RangeInput pending={props.pending} onSubmit={() => undefined} value={oop} onChange={setOop} label="oop range" hideSubmit />
        <p
          className={`font-mono text-xs ${oopInfo.ok || oopInfo.empty === true ? TEXT_DIM : TEXT_ERROR}`}
          data-testid="form-oop-info"
        >
          {oopInfo.ok ? `${String(oopInfo.combos ?? 0)} combos` : oopInfo.message}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <span className={`text-sm ${TEXT_STRONG}`}>IP 레인지</span>
        <RangeInput pending={props.pending} onSubmit={() => undefined} value={ip} onChange={setIp} label="ip range" hideSubmit />
        <p
          className={`font-mono text-xs ${ipInfo.ok || ipInfo.empty === true ? TEXT_DIM : TEXT_ERROR}`}
          data-testid="form-ip-info"
        >
          {ipInfo.ok ? `${String(ipInfo.combos ?? 0)} combos` : ipInfo.message}
        </p>
      </div>

      <div className="flex gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={`text-sm ${TEXT_STRONG}`}>팟 (bb)</span>
          <input
            aria-label="pot"
            data-testid="form-pot"
            inputMode="decimal"
            className="min-h-11 w-full min-w-0 rounded border border-[#334155] bg-[#020617] px-3 font-mono text-sm"
            value={potBb}
            onChange={(e) => {
              setPotBb(e.target.value);
            }}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={`text-sm ${TEXT_STRONG}`}>스택 (bb)</span>
          <input
            aria-label="stack"
            data-testid="form-stack"
            inputMode="decimal"
            className="min-h-11 w-full min-w-0 rounded border border-[#334155] bg-[#020617] px-3 font-mono text-sm"
            value={stackBb}
            onChange={(e) => {
              setStackBb(e.target.value);
            }}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className={`text-sm ${TEXT_STRONG}`}>베팅 사이즈 프리셋</span>
        <select
          aria-label="sizings"
          data-testid="form-sizings"
          className={`min-h-11 w-full min-w-0 rounded px-2 text-sm ${BTN_NEUTRAL}`}
          value={sizings}
          onChange={(e) => {
            setSizings(e.target.value as SizingPresetName);
          }}
        >
          {PRESET_NAMES.map((name) => (
            <option key={name} value={name}>
              {presetLabel(name)}
            </option>
          ))}
        </select>
      </label>

      {props.mode === 'new' ? (
        <label className="flex flex-col gap-1">
          <span className={`text-sm ${TEXT_STRONG}`}>목표 정확도 (exploitability)</span>
          <select
            aria-label="target"
            data-testid="form-target"
            className={`min-h-11 w-full min-w-0 rounded px-2 text-sm ${BTN_NEUTRAL}`}
            value={String(target)}
            onChange={(e) => {
              setTarget(Number(e.target.value));
            }}
          >
            {TARGETS.map((t) => (
              <option key={t} value={String(t)}>{`${String(t)}% — ${t === 0.5 ? '빠름' : t === 0.3 ? '보통' : '정확'}`}</option>
            ))}
          </select>
        </label>
      ) : null}

      {props.error === null || props.error === undefined ? null : (
        <p className={`text-sm ${TEXT_ERROR}`} data-testid="form-error">
          {props.error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          data-testid="form-cancel"
          className={`min-h-12 flex-1 rounded text-sm font-semibold ${BTN_NEUTRAL}`}
          style={{ touchAction: 'manipulation' }}
          onClick={props.onCancel}
        >
          취소
        </button>
        <button
          type="submit"
          data-testid="form-submit"
          disabled={!valid || props.pending}
          className={`min-h-12 flex-1 rounded text-sm font-bold ${valid && !props.pending ? BTN_PRIMARY : BTN_NEUTRAL}`}
          style={{ touchAction: 'manipulation' }}
        >
          {props.mode === 'new' ? '솔브' : '이 표기로 열기'}
        </button>
      </div>
    </form>
  );
}
