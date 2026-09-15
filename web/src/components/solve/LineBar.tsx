/**
 * 라인 브레드크럼 (P5.md 3.2-2).
 *
 * 세그먼트 칩을 **가로**로만 스크롤한다 (`overflow-x-auto`): 세로로 늘리면 375px 에서
 * 격자가 밀려 내려가 하단 바와 함께 볼 수 없다. 칩 탭 = 그 접두 라인으로 이동.
 *
 * 프리플랍의 `breadcrumbSeqs` 를 쓰지 않는다 — 그쪽은 카드 세그먼트를 모른다 (1.3).
 */

import { useEffect, useRef } from 'react';
import { crumbs, STREET_LABEL, type StreetName } from '../../lib/solveLine';
import { BTN_ACTIVE, BTN_NEUTRAL, TEXT_DIM } from '../../lib/palette';

export interface LineBarProps {
  line: string;
  /** 솔브가 시작한 스트리트 (턴 솔브면 'turn') */
  rootStreet: StreetName;
  onGo: (line: string) => void;
}

export function LineBar(props: LineBarProps): React.JSX.Element {
  const items = crumbs(props.line, props.rootStreet);
  const strip = useRef<HTMLDivElement | null>(null);

  // 라인이 길어지면 **지금 노드**가 화면 밖으로 밀린다. 깊이 들어갈수록 사용자가 매번
  // 가로로 밀어야 하므로, 라인이 바뀔 때마다 끝으로 스크롤한다 (뒤로 가면 다시 앞이 보인다).
  useEffect(() => {
    const el = strip.current;
    if (el !== null) el.scrollLeft = el.scrollWidth;
  }, [props.line]);

  return (
    <div
      ref={strip}
      data-testid="line-bar"
      className="flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap py-1"
    >
      <button
        type="button"
        data-testid="crumb-root"
        className={`min-h-11 min-w-11 shrink-0 rounded px-3 text-sm ${props.line === '' ? BTN_ACTIVE : BTN_NEUTRAL}`}
        style={{ touchAction: 'manipulation' }}
        onClick={() => {
          props.onGo('');
        }}
      >
        {STREET_LABEL[props.rootStreet]}
      </button>
      {items.map((c) => (
        <span key={c.line} className="flex shrink-0 items-center gap-1">
          <span className={`text-xs ${TEXT_DIM}`}>{c.card ? '·' : '›'}</span>
          <button
            type="button"
            data-testid={`crumb-${c.line}`}
            aria-current={c.line === props.line ? 'true' : undefined}
            className={`min-h-11 min-w-11 shrink-0 rounded px-3 font-mono text-sm ${
              c.line === props.line ? BTN_ACTIVE : BTN_NEUTRAL
            } ${c.card ? 'ring-1 ring-[#94a3b8]' : ''}`}
            style={{ touchAction: 'manipulation' }}
            onClick={() => {
              props.onGo(c.line);
            }}
          >
            {c.label}
            {c.card ? <span className={`ml-1 text-xs ${TEXT_DIM}`}>{STREET_LABEL[c.street]}</span> : null}
          </button>
        </span>
      ))}
    </div>
  );
}
