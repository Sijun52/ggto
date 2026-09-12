/**
 * web/src 에서 유일하게 허용되는 레인지 텍스트 리터럴 (P1.md 2절).
 * 격자 라벨과 핸드 이름은 전부 @ggto/core 의 handClassName 에서 나온다.
 */
export const DEFAULT_RANGE_TEXT = '22+,A2s+,KTo+';

/**
 * URL `?range=` 의 값. 없거나 디코드 불가면 DEFAULT_RANGE_TEXT.
 *
 * **URLSearchParams 를 쓰지 않는다** (P1.md 4.1, R1 MAJOR 1). URLSearchParams 는
 * application/x-www-form-urlencoded 규칙이라 리터럴 `+` 를 공백으로 바꾼다.
 * `+` 는 레인지 문법에서 가장 흔한 문자이고 core 파서가 항목 뒤 공백을 허용하므로
 * `?range=22+,A2s+,KTo+` 가 **에러 없이** `22,A2s,KTo` (162 → 22 콤보) 로 그려진다.
 * 퍼센트 디코딩만 하는 decodeURIComponent 는 `+` 를 그대로 둔다 — 그래서
 * `%2B` 형태와 리터럴 `+` 형태가 둘 다 `+` 로 해석된다.
 */
export function rangeTextFromUrl(search: string): string {
  const v = urlParam(search, 'range');
  return v === null ? DEFAULT_RANGE_TEXT : v;
}

/**
 * 쿼리 문자열에서 키 하나를 읽는다 (P2 차트 뷰어도 같은 규칙을 쓴다).
 * 같은 키가 여러 번이면 **첫 번째**가 이긴다 (P1.md 4.1). 값이 없거나 깨진
 * 퍼센트 시퀀스면 null.
 */
export function urlParam(search: string, key: string): string | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    // 값 없는 플래그(`?range`)나 접미사가 같은 다른 키(`?xrange=...`)는 건너뛴다.
    if (eq === -1 || part.slice(0, eq) !== key) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1));
    } catch (e) {
      // 깨진 퍼센트 시퀀스(`?range=%zz`)만 URIError 다. 그 외 예외는 삼키지 않는다.
      if (e instanceof URIError) return null;
      throw e;
    }
  }
  return null;
}
