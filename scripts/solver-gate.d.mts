/**
 * `solver-gate.mjs` 의 타입 선언. 스크립트 자체는 plain JS 로 둔다 (빌드 없이 `node` 로
 * 바로 돌아야 한다 — `build:solver` 가 TS 빌드에 의존하면 순환이다). 테스트가 `classify`
 * 를 표 테스트로 부르므로 그 경계만 선언한다.
 */

export declare const VERDICT: {
  readonly ABSENT: 'absent';
  readonly PRESENT: 'present';
  readonly UNDECIDED: 'undecided';
};

export type GateVerdict = (typeof VERDICT)[keyof typeof VERDICT];

export declare function classify(r: { status: number | null; stderr?: string | undefined }): {
  verdict: GateVerdict;
  reason: string;
};

export declare function cargoBin(): string;

export declare function runGate(): {
  verdict: GateVerdict;
  reason: string;
  stdout: string;
  stderr: string;
  status: number | null;
};

export declare const REPO_ROOT: string;
export declare const CRATE_DIR: string;
