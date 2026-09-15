/**
 * 런아웃 히트맵 (P5.md 3.3).
 *
 * 13열(랭크 A→2) × 4행(♠♥♦♣) = 52칸. 보드에 이미 있는 카드는 빈 칸이다 — 서버가 준
 * `cards` 에 없는 카드가 그것이다 (클라이언트가 보드를 파싱해 빼지 않는다).
 *
 * **2단계 탭**: 375px 에서 칸은 25px 이라 오탭이 난다. 첫 탭은 상태줄에 카드를 올리고,
 * 같은 칸을 다시 탭하거나 상태줄의 44px 버튼을 눌러야 노드가 바뀐다 (P3M 4절의 격자 셀
 * 예외를 그대로 쓰되, 결과가 "노드 이동" 이라 되돌리기가 비싸므로 한 단계를 더 둔다).
 */

import { RANKS, SUITS } from '@ggto/core';
import type { SolveRunoutCardView } from '../../api/solve';
import { deviations, heatColor, heatTextColor, symmetricScale } from '../../lib/runoutScale';
import { formatPct } from '../../lib/chartGrid';
import { BTN_NEXT, SURFACE, TEXT_BODY, TEXT_DIM } from '../../lib/palette';
import { SUIT_STYLE } from '../../lib/palette';

/** 표시 순서: 랭크는 A→2, 슈트는 ♠♥♦♣ (core 의 인덱스 순서가 아니다 — 표시 규약이다) */
const RANK_ORDER = [...RANKS].reverse();
const SUIT_ORDER = ['s', 'h', 'd', 'c'];

export interface RunoutHeatmapProps {
  cards: readonly SolveRunoutCardView[];
  /** 어느 쪽 EV 로 색을 칠하는가 */
  player: 'oop' | 'ip';
  /** 상태줄에 올라간 카드 (2단계 탭의 1단계) */
  picked: string | null;
  onPick: (card: string) => void;
  onGo: (card: string) => void;
  /** `≥ md` 에서 셀 아래 미니 전략 막대를 그린다 (375 에서는 상태줄에 숫자로) */
  wide: boolean;
}

/**
 * `strategyRoot` 막대의 색.
 *
 * **액션 이름을 모른다**: 이름은 그 카드를 딜한 뒤의 노드 응답에만 있고, 히트맵은 노드를
 * 49번 열지 않는다 (P5.md 1.4). 그래서 의미 색(`actionColors`)을 쓰지 않고 **순서 색**을
 * 쓴다 — 액션 순서는 그 자식 노드의 `actions` 와 같다는 것만이 계약이다.
 */
const INDEX_COLORS = ['#38bdf8', '#f59e0b', '#ef4444', '#a855f7', '#10b981', '#64748b'];

const bb = (x: number | null): string => (x === null ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}`);

function glyph(card: string): string {
  const suit = card[1] ?? '';
  return `${card[0] ?? ''}${SUIT_STYLE[suit]?.glyph ?? suit}`;
}

export function RunoutHeatmap(props: RunoutHeatmapProps): React.JSX.Element {
  const byCard = new Map(props.cards.map((c) => [c.card, c]));
  const values = props.cards.map((c) => (props.player === 'oop' ? c.evOop : c.evIp));
  const devs = deviations(values);
  const scale = symmetricScale(devs.filter((d): d is number => d !== null));
  const devByCard = new Map(props.cards.map((c, i) => [c.card, devs[i] ?? null]));

  const finite = props.cards.filter((_c, i) => values[i] !== null);
  const mean =
    finite.length === 0
      ? null
      : (values.filter((v): v is number => v !== null).reduce((a, b) => a + b, 0) / finite.length);
  let best: SolveRunoutCardView | null = null;
  let worst: SolveRunoutCardView | null = null;
  for (const c of props.cards) {
    const d = devByCard.get(c.card) ?? null;
    if (d === null) continue;
    if (best === null || d > (devByCard.get(best.card) as number)) best = c;
    if (worst === null || d < (devByCard.get(worst.card) as number)) worst = c;
  }

  const pickedCard = props.picked === null ? null : (byCard.get(props.picked) ?? null);

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="runouts">
      <p className={`font-mono text-xs ${TEXT_BODY}`} data-testid="runout-summary">
        {`${String(props.cards.length)}장 · ${props.player.toUpperCase()} 평균 ${
          mean === null ? '—' : mean.toFixed(2)
        }bb · 최고 ${best === null ? '—' : `${glyph(best.card)} ${bb(devByCard.get(best.card) ?? null)}`} · 최저 ${
          worst === null ? '—' : `${glyph(worst.card)} ${bb(devByCard.get(worst.card) ?? null)}`
        }`}
      </p>

      <div className="min-w-0">
        {SUIT_ORDER.map((suit) => (
          <div
            key={suit}
            className="grid gap-0.5 py-0.5"
            style={{ gridTemplateColumns: `18px repeat(13, minmax(0, 1fr))` }}
          >
            <span className={`self-center text-center text-xs ${SUIT_STYLE[suit]?.className ?? ''}`}>
              {SUIT_STYLE[suit]?.glyph ?? suit}
            </span>
            {RANK_ORDER.map((rank) => {
              const name = `${rank}${suit}`;
              const card = byCard.get(name);
              if (card === undefined) {
                return (
                  <span
                    key={name}
                    className={`rounded-sm bg-[#0b1220] ${props.wide ? 'h-8' : 'h-6'}`}
                    data-testid={`runout-empty-${name}`}
                  />
                );
              }
              const dev = devByCard.get(name) ?? null;
              const bg = heatColor(dev === null ? null : scale.normalize(dev));
              const selected = props.picked === name;
              return (
                <button
                  key={name}
                  type="button"
                  data-testid={`runout-${name}`}
                  // 격자 셀과 같은 예외다 (P5.md 5절): 25px 칸이지만 **2단계 탭**이라
                  // 오탭이 노드를 바꾸지 않는다. `check:mobile` 의 44px 게이트가 이 표지를 본다.
                  data-tap="cell"
                  aria-pressed={selected}
                  className={`flex flex-col items-center justify-center rounded-sm px-0.5 text-center font-mono text-[11px] ${
                    props.wide ? 'h-8' : 'h-6'
                  } ${selected ? 'ring-2 ring-[#f1f5f9]' : ''}`}
                  style={{ backgroundColor: bg, color: heatTextColor(bg), touchAction: 'manipulation' }}
                  onClick={() => {
                    // 1단계: 상태줄에 올린다. 2단계(같은 칸 재탭): 그 카드를 딜한 노드로.
                    if (selected) props.onGo(name);
                    else props.onPick(name);
                  }}
                >
                  {rank}
                  {props.wide && card.strategyRoot.length > 0 ? (
                    <span className="mt-0.5 flex h-1 w-full overflow-hidden rounded-sm">
                      {card.strategyRoot.map((f, i) => (
                        <span
                          key={`${name}-${String(i)}`}
                          style={{
                            width: `${String(Math.max(0, Math.min(1, f)) * 100)}%`,
                            backgroundColor: INDEX_COLORS[i % INDEX_COLORS.length],
                          }}
                        />
                      ))}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <p className={`text-xs ${TEXT_DIM}`} data-testid="runout-legend">
        초록 = {props.player.toUpperCase()} 에 유리 · 회색 = 평균 · 칸을 두 번 탭하면 그 카드로 갑니다
        {props.wide ? ' · 칸 아래 막대 = 그 카드 뒤 첫 액션들의 평균 전략 (그 노드의 액션 순서)' : ''}
      </p>

      <div className={`flex min-h-11 flex-wrap items-center gap-2 rounded px-2 py-1 ${SURFACE}`}>
        <span className={`min-w-0 flex-1 truncate font-mono text-sm ${TEXT_BODY}`} data-testid="runout-readout">
          {pickedCard === null
            ? '선택: —'
            : `선택: ${glyph(pickedCard.card)} · OOP ${bb(pickedCard.evOop)}bb · IP ${bb(
                pickedCard.evIp,
              )}bb · 에퀴티 ${pickedCard.equityOop === null ? '—' : formatPct(pickedCard.equityOop)}${
                pickedCard.strategyRoot.length === 0
                  ? ''
                  : ` · 카드 뒤 전략 ${pickedCard.strategyRoot.map((f) => formatPct(f)).join(' / ')}`
              }`}
        </span>
        {pickedCard === null ? null : (
          <button
            type="button"
            data-testid="runout-go"
            className={`min-h-11 shrink-0 rounded px-3 text-sm font-semibold ${BTN_NEXT}`}
            style={{ touchAction: 'manipulation' }}
            onClick={() => {
              props.onGo(pickedCard.card);
            }}
          >
            이 카드로 →
          </button>
        )}
      </div>
    </div>
  );
}
