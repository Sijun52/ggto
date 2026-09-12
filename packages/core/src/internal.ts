/**
 * @ggto/core 내부 진입점 — **공개 API 가 아니다** (`@ggto/core/internal`).
 *
 * 여기 있는 것들은 (a) 성능 경로에서만 쓰는 사전 계산 테이블이거나 (b) 마스크를
 * 직접 받는 저수준 평가 함수다. 타입은 readonly 지만 런타임 TypedArray/배열은
 * 변형 가능하므로, 이걸 건드리면 라이브러리 전체가 조용히 틀린 값을 내기 시작한다.
 * 그래서 `index.ts` 에서 빼고 별도 진입점으로 분리했다 (P0 Round1 MINOR 5).
 *
 * 소비자: 이 패키지의 내부 모듈과 테스트/벤치뿐. 앱 코드에서 import 하지 마라.
 *
 * @internal
 */

/** @internal 콤보 인덱스 → 높은 카드 / 낮은 카드 (1326). */
export { COMBO_HI_TABLE, COMBO_LO_TABLE } from './combo.js';

/** @internal 169 클래스 → 콤보 목록, 콤보 → 169 클래스. */
export { HAND_CLASS_COMBOS_TABLE, HAND_CLASS_OF_COMBO_TABLE } from './handClass.js';

/** @internal 랭크/슈트 마스크를 직접 받는 평가기 핫 경로. 입력 검증 없음. */
export { evaluateMasks } from './evaluator.js';
