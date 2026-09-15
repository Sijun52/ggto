/**
 * 히어로의 두 장. `combo` 는 1326 키 문자열('As7d')이고 core 의 `parseCards` 로 읽는다 —
 * 화면이 카드 문법을 따로 알면 서버와 갈라진다.
 */

import { cardRank, cardSuit, parseCards, RANKS, SUITS } from '@ggto/core';
import { SUIT_STYLE } from '../lib/palette';

export function HeroCards(props: { combo: string }): React.JSX.Element {
  const cards = parseCards(props.combo);
  return (
    <span className="flex items-center gap-1" data-testid="hero-cards">
      {cards.map((card, i) => {
        const rank = RANKS[cardRank(card)] as string;
        const suit = SUITS[cardSuit(card)] as string;
        const style = SUIT_STYLE[suit] ?? { glyph: suit, className: 'text-[#f1f5f9]' };
        return (
          <span
            key={`${String(i)}-${rank}${suit}`}
            data-testid={`hero-card-${rank}${suit}`}
            className={`inline-flex h-14 w-10 items-center justify-center rounded border border-[#334155] bg-[#0f172a] font-mono text-lg ${style.className}`}
          >
            {rank}
            {style.glyph}
          </span>
        );
      })}
    </span>
  );
}
