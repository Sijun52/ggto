/**
 * P5.md 2절 / 8.1 — 계층 경계 grep 게이트.
 *
 * `web/src` 는 `@ggto/solver` 를 import 하지 않는다 (`node:sqlite`·`child_process` 의존).
 * 크레이트 이름(`postflop`) 도 프론트에 나오면 안 된다 — 프론트가 솔버 내부를 알기
 * 시작하면 "프론트는 응답만 본다" 는 계약이 조용히 깨진다.
 *
 * 문자열 검사인 이유: 타입만 import 해도 (`import type`) 번들러 설정에 따라 실제 모듈이
 * 딸려 들어오고, 그때는 **빌드가 아니라 런타임에** 깨진다.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '../src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const SOURCES = files(SRC).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));

/**
 * 주석을 뺀 코드. 경계를 **설명하는** 주석("`@ggto/solver` 는 웹에 못 들어온다") 은
 * 지우면 안 되는 문서이지 위반이 아니다 — 게이트가 코드만 보게 한다.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('P5 2 계층 경계', () => {
  it('P5 2 web/src 가 @ggto/solver 를 import 하지 않는다', () => {
    const offenders = SOURCES.filter((f) => /@ggto\/solver/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it('P5 2 web/src 코드에 postflop 크레이트 이름이 없다 (데몬 어댑터에만)', () => {
    const offenders = SOURCES.filter((f) => /postflop/i.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it('P5 2 게이트는 실제 import 를 잡는다 (주석만 지우고 끝나지 않는다)', () => {
    const sample = ["import { x } from '@ggto/solver';", '// @ggto/solver 는 웹에 못 들어온다'].join(String.fromCharCode(10));
    const stripped = sample.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(/@ggto\/solver/.test(stripped)).toBe(true);
    expect(/@ggto\/solver/.test('// @ggto/solver 는 웹에 못 들어온다'.replace(/\/\/.*$/gm, ''))).toBe(false);
  });

  it('P5 2 게이트가 실제로 파일을 읽고 있다 (0건 비교 방지)', () => {
    expect(SOURCES.length).toBeGreaterThan(20);
    expect(SOURCES.some((f) => f.endsWith('SolveExplorer.tsx'))).toBe(true);
  });

  it('D14 169 격자는 하드코딩되지 않는다 — 셀 이름 목록이 소스에 없다', () => {
    // 하드코딩의 흔적은 "AKs" 류 라벨 배열이다. core 의 handClassName 이 유일한 출처다.
    const offenders = SOURCES.filter((f) => /'AKs'|"AKs"|'AKo'|"AKo"/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
