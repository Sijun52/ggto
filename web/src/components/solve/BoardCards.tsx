/**
 * 보드 카드 (24×32). 문자열은 **응답의 `board`** 를 그대로 받는다 — 폼의 보드에
 * 딜된 카드를 클라이언트가 이어 붙이지 않는다 (P5.md 1.5 / P4 R1 MAJOR 1).
 */

import { cardRank, cardSuit, parseCards, RANKS, SUITS } from '@ggto/core';
import { SUIT_STYLE } from '../../lib/palette';

export function BoardCards(props: { board: string; dealtFrom?: number }): React.JSX.Element {
  let cards: number[];
  try {
    cards = parseCards(props.board);
  } catch {
    // 서버가 보낸 보드가 카드가 아니면 그릴 것이 없다 — 문자열을 그대로 보여준다.
    return (
      <span className="font-mono text-xs text-[#f87171]" data-testid="board-cards">
        {props.board}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5" data-testid="board-cards">
      {cards.map((card, i) => {
        const rank = RANKS[cardRank(card)] as string;
        const suit = SUITS[cardSuit(card)] as string;
        const style = SUIT_STYLE[suit] ?? { glyph: suit, className: 'text-[#f1f5f9]' };
        // 라인에서 딜된 카드는 테두리를 밝게 — "이 카드는 내가 고른 런아웃이다".
        const dealt = props.dealtFrom !== undefined && i >= props.dealtFrom;
        return (
          <span
            key={`${String(i)}-${rank}${suit}`}
            data-testid={`board-card-${rank}${suit}`}
            className={`inline-flex h-8 w-6 items-center justify-center rounded border bg-[#0f172a] font-mono text-xs ${
              dealt ? 'border-[#94a3b8]' : 'border-[#334155]'
            } ${style.className}`}
          >
            {rank}
            {style.glyph}
          </span>
        );
      })}
    </span>
  );
}
