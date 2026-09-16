/**
 * `aliases.json` 파서 (P7.md 7.1). 임포터·마이그레이터가 같은 함수를 쓴다 — 여기가 갈라지면
 * 사용자 기록이 엉뚱한 차트로 옮겨간다.
 */

import { describe, expect, it } from 'vitest';
import { ALIAS_FILE_NAME, ALIAS_FORMAT, ALIAS_VERSION, AliasFileError, isContentHash, parseAliasFile } from '../src/aliases.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

function doc(aliases: unknown): string {
  return JSON.stringify({ format: ALIAS_FORMAT, version: ALIAS_VERSION, aliases });
}

describe('7.1 aliases.json', () => {
  it('7.1 정상 파일을 읽는다', () => {
    const parsed = parseAliasFile(doc([{ from: A, to: B, reason: 'P7' }]), 'test');
    expect(parsed.aliases).toEqual([{ from: A, to: B, reason: 'P7' }]);
    expect(ALIAS_FILE_NAME).toBe('aliases.json');
  });

  it('7.1 빈 목록도 정상이다 (은퇴할 것이 없는 경우)', () => {
    expect(parseAliasFile(doc([]), 'test').aliases).toEqual([]);
  });

  it('7.1 형식·버전이 다르면 throw', () => {
    expect(() => parseAliasFile(JSON.stringify({ format: 'x', version: 1, aliases: [] }), 't')).toThrow(AliasFileError);
    expect(() => parseAliasFile(JSON.stringify({ format: ALIAS_FORMAT, version: 2, aliases: [] }), 't')).toThrow(AliasFileError);
    expect(() => parseAliasFile('not json', 't')).toThrow(AliasFileError);
    expect(() => parseAliasFile(JSON.stringify([]), 't')).toThrow(AliasFileError);
  });

  it('7.1 해시가 64자 소문자 hex 가 아니면 throw', () => {
    expect(() => parseAliasFile(doc([{ from: 'short', to: B, reason: 'r' }]), 't')).toThrow(/from must be 64/);
    expect(() => parseAliasFile(doc([{ from: A, to: B.toUpperCase(), reason: 'r' }]), 't')).toThrow(/to must be 64/);
    expect(isContentHash(A)).toBe(true);
    expect(isContentHash('zz')).toBe(false);
  });

  it('7.1 자기 자신으로의 별칭·중복 from·연쇄는 거부한다', () => {
    expect(() => parseAliasFile(doc([{ from: A, to: A, reason: 'r' }]), 't')).toThrow(/onto itself/);
    expect(() =>
      parseAliasFile(doc([{ from: A, to: B, reason: 'r' }, { from: A, to: C, reason: 'r' }]), 't'),
    ).toThrow(/appears twice/);
    // a -> b, b -> c 는 적용 순서에 따라 결과가 달라진다 (연쇄 금지)
    expect(() =>
      parseAliasFile(doc([{ from: A, to: B, reason: 'r' }, { from: B, to: C, reason: 'r' }]), 't'),
    ).toThrow(/chains are not supported/);
  });

  it('7.1 reason 은 비어 있으면 안 된다 (왜 사라졌는지가 남아야 한다)', () => {
    expect(() => parseAliasFile(doc([{ from: A, to: B, reason: '' }]), 't')).toThrow(/reason/);
    expect(() => parseAliasFile(doc([{ from: A, to: B }]), 't')).toThrow(/reason/);
  });
});
