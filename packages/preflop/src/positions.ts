/**
 * 테이블 사이즈 → 액션 순서 (P7.md 2.1, DECISIONS D37).
 *
 * `+` 를 쓰지 않는다 (`UTG1`·`UTG2`, `UTG+1` 금지): 포지션 이름은 `?pos=` 쿼리 문자열에
 * 들어가고 `+` 는 폼 인코딩에서 공백으로 디코딩돼 D13 의 사고를 냈던 문자다.
 * core 의 상태 기계는 포지션 이름을 불투명 문자열로만 쓰므로 core 와 무관하다.
 *
 * 순서 규약: 맨 앞은 (n >= 5 에서) 항상 UTG 이고 뒤에서부터 BB, SB, BTN, CO, HJ, LJ, UTG1, UTG2 가 붙는다.
 * 6-max 는 `UTG HJ CO BTN SB BB` 로 P2.md 4절의 예시와 같다.
 */

export const MIN_TABLE_SIZE = 2;
export const MAX_TABLE_SIZE = 9;

/**
 * **P7.md 2.1 의 표를 그대로 적는다.** 한 줄 규칙("9-max 를 앞에서 자른다")으로 만들면
 * 실전 표기와 어긋난다: 5-max 의 첫 자리는 HJ 가 아니라 **UTG** 이고, 8-max 는 `UTG2` 가
 * 아니라 `UTG1` 을 남긴다. 즉 사이즈가 줄 때 사라지는 자리가 앞에서 순서대로가 아니다
 * (UTG 라는 이름은 항상 남고 그 다음 자리부터 지워진다).
 *
 * 그래서 8줄짜리 표가 정본이다 — 규칙을 우겨 넣으면 조용히 틀린 이름이 `?pos=` 로 나간다.
 */
const TABLES: readonly (readonly string[])[] = [
  [],
  [],
  ['SB', 'BB'],
  ['BTN', 'SB', 'BB'],
  ['CO', 'BTN', 'SB', 'BB'],
  ['UTG', 'CO', 'BTN', 'SB', 'BB'],
  ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  ['UTG', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
].map((t) => Object.freeze(t));

/** 액션 순서. 2: [SB,BB] … 9: [UTG,UTG1,UTG2,LJ,HJ,CO,BTN,SB,BB]. n ∉ 2..9 → RangeError */
export function tablePositions(n: number): readonly string[] {
  if (!Number.isInteger(n) || n < MIN_TABLE_SIZE || n > MAX_TABLE_SIZE) {
    throw new RangeError(`table size must be an integer in ${String(MIN_TABLE_SIZE)}..${String(MAX_TABLE_SIZE)}: ${String(n)}`);
  }
  return TABLES[n] as readonly string[];
}
