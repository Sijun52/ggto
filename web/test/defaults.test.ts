// @vitest-environment node
// (순수 함수 테스트. DOM 이 필요 없다)
import { comboCount, parseRange } from '@ggto/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RANGE_TEXT, rangeTextFromUrl, urlParam } from '../src/lib/defaults';

/** URL 에서 뽑은 텍스트가 "진짜 그 레인지"인지는 core 로 확인한다 (문자열 비교만으로는 부족). */
function combos(text: string): number {
  return comboCount(parseRange(text));
}

describe('4.1 rangeTextFromUrl', () => {
  it('4.1 리터럴 + 를 보존한다 (URLSearchParams 였다면 공백이 되어 조용히 다른 레인지가 된다)', () => {
    const text = rangeTextFromUrl('?range=22+,A2s+,KTo+');
    expect(text).toBe('22+,A2s+,KTo+');
    // P1.md 3.4 의 수치: 22+ 78 + A2s+ 48 + KTo+ 36
    expect(combos(text)).toBe(162);

    // 아래 두 줄은 회귀 가드가 아니라 **전제 확인**이다 (P1 R2 MINOR 2): "폼 규칙이면 + 가
    // 공백이 되고, core 가 후행 공백을 허용해 조용히 22 콤보가 된다" 는 플랫폼/core 사실을
    // 못 박는다. 진짜 가드는 위의 toBe('22+,A2s+,KTo+') 와 combos === 162 다.
    // core 가 후행 공백을 거부하도록 바뀌면 이 블록은 지워야 한다 (구현과 무관하게 깨진다).
    const viaFormRules = new URLSearchParams('?range=22+,A2s+,KTo+').get('range') ?? '';
    expect(viaFormRules).toBe('22 ,A2s ,KTo ');
    expect(combos(viaFormRules)).toBe(22);
  });

  it('4.1 %2B 로 인코딩된 형태도 같은 레인지로 해석된다', () => {
    expect(rangeTextFromUrl('?range=22%2B%2CA2s%2B%2CKTo%2B')).toBe('22+,A2s+,KTo+');
    expect(rangeTextFromUrl('?range=22%2B')).toBe('22+');
    expect(combos(rangeTextFromUrl('?range=22%2B%2CA2s%2B%2CKTo%2B'))).toBe(162);
  });

  it('4.1 퍼센트 디코딩은 정상 동작한다 (가중치 콜론, 공백)', () => {
    expect(rangeTextFromUrl('?range=QQ%3A0.5')).toBe('QQ:0.5');
    expect(rangeTextFromUrl('?range=AA%2C%20KK')).toBe('AA, KK');
    expect(combos(rangeTextFromUrl('?range=QQ%3A0.5'))).toBe(6);
  });

  it('4.1 range 가 없으면 기본값', () => {
    expect(rangeTextFromUrl('')).toBe(DEFAULT_RANGE_TEXT);
    expect(rangeTextFromUrl('?')).toBe(DEFAULT_RANGE_TEXT);
    expect(rangeTextFromUrl('?foo=1')).toBe(DEFAULT_RANGE_TEXT);
    // 접미사가 같은 다른 키에 걸리면 안 된다
    expect(rangeTextFromUrl('?xrange=AA')).toBe(DEFAULT_RANGE_TEXT);
    expect(rangeTextFromUrl('?myrange=AA')).toBe(DEFAULT_RANGE_TEXT);
    // 값 없는 플래그
    expect(rangeTextFromUrl('?range')).toBe(DEFAULT_RANGE_TEXT);
  });

  it('4.1 다른 파라미터와 섞여 있어도 range 만 뽑는다', () => {
    expect(rangeTextFromUrl('?foo=1&range=22%2B&bar=2')).toBe('22+');
    expect(rangeTextFromUrl('?foo=1&range=22+,A2s+')).toBe('22+,A2s+');
    // ? 없이 넘어와도 동작 (location.search 는 항상 ? 로 시작하지만 방어)
    expect(rangeTextFromUrl('range=AA')).toBe('AA');
  });

  it('4.1 빈 값은 빈 레인지 (P0 규약: "" 는 유효한 빈 레인지)', () => {
    expect(rangeTextFromUrl('?range=')).toBe('');
    expect(combos('')).toBe(0);
  });

  it('4.1 (P1 R2 MINOR 1) range 가 여러 번이면 첫 번째가 이긴다 — 스펙 4.1 에 명시된 규칙', () => {
    expect(rangeTextFromUrl('?range=AA&range=KK')).toBe('AA');
    expect(rangeTextFromUrl('?foo=1&range=AA&range=KK&bar=2')).toBe('AA');
    // urlParam 은 차트 뷰어(P2 9절)도 쓰므로 같은 규칙이 set/seq 에도 걸린다
    expect(urlParam('?set=1&set=2', 'set')).toBe('1');
    expect(urlParam('?seq=A&seq=A-C', 'seq')).toBe('A');
  });

  it('4.1 깨진 퍼센트 시퀀스는 URIError 를 삼키지 않고 기본값으로 떨어진다', () => {
    expect(rangeTextFromUrl('?range=%zz')).toBe(DEFAULT_RANGE_TEXT);
    expect(rangeTextFromUrl('?range=%E0%A4%A')).toBe(DEFAULT_RANGE_TEXT);
  });
});
