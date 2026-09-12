/**
 * @ggto/core — 순수 도메인 라이브러리. 런타임 의존성 0.
 * UI / DB / HTTP / 파일 I/O / 솔버 호출 없음.
 *
 * 사전 계산 테이블과 마스크 평가기(`evaluateMasks`)는 런타임에 변형 가능해서
 * 공개 API 에서 뺐다. 필요하면 `@ggto/core/internal` 에서 가져온다 (P0 R1 MINOR 5).
 */

export {
  CARD_COUNT,
  CardSyntaxError,
  RANKS,
  RANK_COUNT,
  SUITS,
  SUIT_COUNT,
  assertCard,
  cardRank,
  cardSuit,
  formatCard,
  formatCards,
  isCard,
  makeCard,
  parseCard,
  parseCards,
  rankFromChar,
  suitFromChar,
  type Card,
} from './card.js';

export {
  COMBO_COUNT,
  assertComboIndex,
  comboCards,
  comboContainsAny,
  comboHi,
  comboIndex,
  comboLo,
  isComboIndex,
  type ComboIndex,
} from './combo.js';

export {
  HAND_CLASS_COUNT,
  HandClassKind,
  assertHandClassIndex,
  handClassCombos,
  handClassFromRanks,
  handClassKind,
  handClassName,
  handClassOf,
  handClassRanks,
  parseHandClass,
  type HandClassIndex,
} from './handClass.js';

export {
  EmptyRangeError,
  cloneRange,
  comboCount,
  emptyRange,
  fullRange,
  intersect,
  normalize,
  permuteRangeSuits,
  rangeFromCombos,
  removeBoard,
  scale,
  toHandClassView,
  totalWeight,
  type HandClassView,
  type Range,
} from './range/range.js';

export { RangeSyntaxError, parseRange } from './range/parse.js';
export { formatRange } from './range/format.js';

export {
  ALL_SUIT_PERMS,
  IDENTITY_PERM,
  applyPermToCard,
  composePerm,
  invertPerm,
  isSuitPerm,
  permEquals,
  type SuitPerm,
} from './suitPerm.js';

export {
  HAND_CATEGORY_COUNT,
  HandCategory,
  evaluate5,
  evaluate7,
  handCategory,
  handCategoryName,
  type HandValue,
} from './evaluator.js';

export {
  UnsupportedError,
  equityHandVsHand,
  equityRangeVsRange,
  type EquityResult,
  type RangeEquityOptions,
  type RangeEquityResult,
} from './equity.js';

export { canonicalBoard, canonicalize, suitStabilizer } from './isomorphism.js';

export {
  ActionSyntaxError,
  MAX_AMOUNT,
  formatAction,
  formatActionSequence,
  formatAmount,
  formatStreet,
  parseActionSequence,
  type Action,
  type ActionSequence,
  type Street,
} from './action.js';

export {
  IllegalActionError,
  PreflopConfigError,
  legalActions,
  preflopState,
  type PreflopConfig,
  type PreflopState,
} from './preflopState.js';

export { createRng, type Rng } from './rng.js';
