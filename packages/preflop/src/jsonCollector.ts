/**
 * 구조 검증의 **수집기와 원시 타입 검사**. `jsonShape.ts`(문서 골격)와
 * `jsonFields.ts`(값 파서)가 공유한다.
 *
 * 첫 오류에서 멈추지 않는 것이 이 계층의 계약이다 (P2.md 4.3): 사람이 파일을 한 번 고치고
 * 다시 돌릴 수 있어야 하므로 발견한 결함을 전부 모아 한 번에 던진다.
 */

import type { ChartIssue } from './types.js';

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export class Collector {
  readonly issues: ChartIssue[] = [];
  add(path: string, reason: string): void {
    this.issues.push({ path, reason });
  }
  /** 알 수 없는 필드는 거부한다 — 오타가 조용히 무시되면 차트가 조용히 틀려진다 (5.1) */
  unknownKeys(path: string, obj: Record<string, unknown>, allowed: readonly string[]): void {
    for (const k of Object.keys(obj)) {
      if (!allowed.includes(k)) this.add(`${path}.${k}`, 'unknown field');
    }
  }
  str(path: string, v: unknown, opts: { nonEmpty?: boolean } = {}): string | null {
    if (typeof v !== 'string') {
      this.add(path, `expected string, got ${typeName(v)}`);
      return null;
    }
    if (opts.nonEmpty === true && v.length === 0) {
      this.add(path, 'must not be empty');
      return null;
    }
    return v;
  }
  num(path: string, v: unknown): number | null {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.add(path, `expected a finite number, got ${typeName(v)}`);
      return null;
    }
    return v;
  }
}
