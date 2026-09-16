/**
 * 테이블 사이즈 → 액션 순서 (P7.md 2.1, DECISIONS D37).
 *
 * `+` 를 쓰지 않는다 (`UTG1`·`UTG2`, `UTG+1` 금지): 포지션 이름은 `?pos=` 쿼리 문자열에
 * 들어가고 `+` 는 폼 인코딩에서 공백으로 디코딩돼 D13 의 사고를 냈던 문자다.
 * core 의 상태 기계는 포지션 이름을 불투명 문자열로만 쓰므로 core 와 무관하다.
 *
 * 순서 규약: 뒤에서부터 BB, SB, BTN, CO, HJ, LJ, UTG2, UTG1 을 붙이고 맨 앞이 UTG 다.
 * 6-max 는 `UTG HJ CO BTN SB BB` 로 P2.md 4절의 예시와 같다.
 */

export const MIN_TABLE_SIZE = 2;
export const MAX_TABLE_SIZE = 9;

/**
 * 9-max 를 정본으로 두고 앞에서 잘라낸다. n=8 은 `LJ` 를 남기고 `UTG2` 를 뺀다 —
 * 실전 표기(8-max 에 UTG2 가 없다)와 같고, "앞자리부터 사라진다" 는 한 가지 규칙이다.
 */
const NINE_MAX: readonly string[] = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

const TABLES: readonly (readonly string[])[] = Array.from({ length: MAX_TABLE_SIZE + 1 }, (_unused, n) =>
  n < MIN_TABLE_SIZE ? [] : Object.freeze(NINE_MAX.slice(MAX_TABLE_SIZE - n)),
);

/** 액션 순서. 2: [SB,BB] … 9: [UTG,UTG1,UTG2,LJ,HJ,CO,BTN,SB,BB]. n ∉ 2..9 → RangeError */
export function tablePositions(n: number): readonly string[] {
  if (!Number.isInteger(n) || n < MIN_TABLE_SIZE || n > MAX_TABLE_SIZE) {
    throw new RangeError(`table size must be an integer in ${String(MIN_TABLE_SIZE)}..${String(MAX_TABLE_SIZE)}: ${String(n)}`);
  }
  return TABLES[n] as readonly string[];
}
