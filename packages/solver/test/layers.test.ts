/**
 * P4.md 2절 — 계층 경계 grep 게이트.
 *
 * 문서로 적은 경계는 지켜지지 않는다. 여기서 소스를 실제로 읽어 확인한다:
 * `child_process` 는 `daemon/` 안에서만, 크레이트 이름은 `postflopCli.ts` 한 파일에만,
 * EV 컨테이너는 `Float32Array` 만 (D7).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'target') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

function sources(sub: string, exts = ['.ts', '.tsx']): { path: string; text: string }[] {
  return walk(join(REPO, sub), exts).map((p) => ({
    path: relative(REPO, p).split(sep).join('/'),
    text: readFileSync(p, 'utf8'),
  }));
}

describe('P4 2 계층 경계', () => {
  it('P4 2 child_process 를 import 하는 곳은 packages/solver/src/daemon/* 뿐이다', () => {
    const offenders = sources('packages')
      .filter((f) => /from '(node:)?child_process'/.test(f.text))
      .map((f) => f.path)
      .filter((p) => !p.startsWith('packages/solver/src/daemon/'))
      // 테스트는 가짜 데몬을 띄워야 하므로 예외다 (프로덕션 경로가 아니다).
      .filter((p) => !p.includes('/test/'));
    expect(offenders).toEqual([]);
  });

  it('P4 2 크레이트 이름(postflop-solver / postflop_solver) 은 solver 패키지 밖에 없다', () => {
    // 스펙 2절의 문구는 "`postflop` 문자열" 이지만 게이트는 **크레이트 이름**으로 좁힌다:
    // 영어 단어 "postflop" 은 도메인 어휘라 `trainer/spotKey.ts` 의 `ps:` 접두 예약 설명
    // ("postflop spot keys are reserved for P6") 처럼 정당한 등장이 이미 있다. 막아야 하는
    // 것은 "특정 솔버 구현이 도메인 패키지로 샜는가" 이고 그것을 특정하는 것은 크레이트 이름이다.
    const forbidden = ['web/src', 'packages/core/src', 'packages/preflop/src', 'packages/trainer/src', 'packages/protocol/src'];
    const offenders: string[] = [];
    for (const sub of forbidden) {
      for (const f of sources(sub)) {
        if (/postflop[-_]solver/i.test(f.text)) offenders.push(f.path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('P4 2 solver 패키지 안에서도 크레이트 이름은 postflopCli.ts 에만 있다', () => {
    const offenders = sources('packages/solver/src')
      .filter((f) => /postflop-solver/.test(f.text))
      .map((f) => f.path)
      .filter((p) => p !== 'packages/solver/src/daemon/postflopCli.ts');
    expect(offenders).toEqual([]);
  });

  it('P4 2 EV 컨테이너는 Float32Array 뿐이다 (D7 — f16/Float64Array 금지)', () => {
    const offenders: string[] = [];
    for (const f of sources('packages/solver/src')) {
      if (/Float64Array/.test(f.text)) offenders.push(`${f.path}: Float64Array`);
      if (/\bf16\b/.test(f.text)) offenders.push(`${f.path}: f16`);
    }
    expect(offenders).toEqual([]);
  });

  it('P4 1 @ggto/solver 의 런타임 의존성은 @ggto/core 뿐이다', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'packages/solver/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(['@ggto/core']);
  });

  it('P4 1 solver 패키지는 HTTP/React 를 import 하지 않는다', () => {
    const offenders = sources('packages/solver/src')
      .filter((f) => /from '(hono|react|express)/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe('P4 1 Rust 크레이트', () => {
  it('P4 1 Cargo.lock 이 커밋돼 있고 bincode 가 rc.3 로 핀돼 있다', () => {
    const lock = readFileSync(join(REPO, 'solver/ggto-solver-cli/Cargo.lock'), 'utf8');
    // 상류에 lock 이 없어 caret 요구가 stable 2.0.1 을 고른다 (스파이크 2.1).
    // 이 두 줄이 P4 빌드가 서는 유일한 이유다.
    expect(lock).toMatch(/name = "bincode"\nversion = "2\.0\.0-rc\.3"/);
    expect(lock).toMatch(/name = "bincode_derive"\nversion = "2\.0\.0-rc\.3"/);
    expect(lock).not.toMatch(/name = "windows-sys"/);
  });

  it('P4 1 린트 우회는 환경변수가 아니라 .cargo/config.toml 에 있다', () => {
    const cfg = readFileSync(join(REPO, 'solver/ggto-solver-cli/.cargo/config.toml'), 'utf8');
    expect(cfg).toContain('dangerous_implicit_autorefs');
  });

  it('P4 1 툴체인과 상류 커밋이 고정돼 있다', () => {
    const toolchain = readFileSync(join(REPO, 'solver/ggto-solver-cli/rust-toolchain.toml'), 'utf8');
    expect(toolchain).toContain('1.98.1');
    const manifest = readFileSync(join(REPO, 'solver/ggto-solver-cli/Cargo.toml'), 'utf8');
    expect(manifest).toContain('9d1509fe5077d019825f833eed04b16d342dfda1');
    expect(manifest).toContain('AGPL-3.0-or-later');
    // clap/tokio 는 windows-sys 를 끌어와 GNU 호스트 빌드를 깨뜨린다 (스파이크 3절).
    expect(manifest).not.toMatch(/^clap\s*=/m);
    expect(manifest).not.toMatch(/^tokio\s*=/m);
  });

  it('P4 2 AGPL 경계 표시가 파일로 있다 (D2)', () => {
    const license = readFileSync(join(REPO, 'solver/ggto-solver-cli/LICENSE'), 'utf8');
    expect(license).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
  });
});
