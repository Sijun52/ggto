/**
 * 어댑터 경계. P2.md 6.3.
 *
 * `Adapter = (bytes, opts) => GgtoJson`. P2 에는 `ggto-json` 어댑터 하나뿐이고 그것은
 * 항등 + 파싱이다. **샘플 파일이 레포에 들어오기 전에는 다른 포맷 어댑터를 쓰지 않는다** —
 * 검증할 수 없는 변환기는 조용히 틀린 차트를 만들어 낸다.
 */

import { parseGgtoJson, type GgtoJson } from '@ggto/preflop';

export interface AdapterOptions {
  /** 진단 메시지용 파일 경로 */
  file: string;
}

export type Adapter = (bytes: Uint8Array, opts: AdapterOptions) => GgtoJson;

const ggtoJsonAdapter: Adapter = (bytes) => parseGgtoJson(new TextDecoder().decode(bytes));

export const ADAPTERS: Readonly<Record<string, Adapter>> = { 'ggto-json': ggtoJsonAdapter };

export const DEFAULT_FORMAT = 'ggto-json';

export function adapterFor(format: string): Adapter | null {
  return ADAPTERS[format] ?? null;
}
