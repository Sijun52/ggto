/**
 * 히어로의 두 장. `combo` 는 1326 키 문자열('As7d')이고 core 의 `parseCards` 로 읽는다 —
 * 화면이 카드 문법을 따로 알면 서버와 갈라진다.
 */

import { cardRank, cardSuit, parseCards, RANKS, SUITS } from '@ggto/core';

/** 슈트 기호와 색. 클럽/스페이드는 밝은 회색, 하트/다이아는 붉은 계열 (표준 4색이 아니다). */
const SUIT_GLYPH: Record<string, { glyph: string; className: string }> = {
  c: { glyph: '♣', className: 'text-emerald-400' },
  d: { glyph: '♦', className: 'text-sky-400' },
  h: { glyph: '♥', className: 'text-red-400' },
  s: { glyph: '♠', className: 'text-slate-100' },
};

export function HeroCards(props: { combo: string }): React.JSX.Element {
  const cards = parseCards(props.combo);
  return (
    <span className="flex items-center gap-1" data-testid="hero-cards">
      {cards.map((card, i) => {
        const rank = RANKS[cardRank(card)] as string;
        const suit = SUITS[cardSuit(card)] as string;
        const style = SUIT_GLYPH[suit] ?? { glyph: suit, className: 'text-slate-100' };
        return (
          <span
            key={`${String(i)}-${rank}${suit}`}
            data-testid={`hero-card-${rank}${suit}`}
            className={`inline-flex h-10 w-8 items-center justify-center rounded border border-slate-700 bg-slate-900 font-mono text-lg ${style.className}`}
          >
            {rank}
            {style.glyph}
          </span>
        );
      })}
    </span>
  );
}
