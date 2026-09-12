/**
 * @ggto/preflop — 프리플랍 차트 저장소·파일 포맷·도달 레인지. P2.md 4~6.
 *
 * HTTP/React 를 모른다. 액션 문법·상태 기계·콤보 인덱스는 `@ggto/core` 가 정본이다.
 */

export {
  ChartValidationError,
  GGTO_JSON_FORMAT,
  GGTO_JSON_VERSION,
  MissingNodeError,
  UnknownPositionError,
  type ChartIssue,
  type ChartRepository,
  type ChartSetMeta,
  type ChartSource,
  type EvBasis,
  type GameType,
  type GgtoJson,
  type GgtoJsonNode,
  type ImportResult,
  type NodeData,
  type NodeMeta,
  type Rake,
  type Resolution,
  type SourceKind,
} from './types.js';

export { parseGgtoJson } from './jsonShape.js';
export { contentHash, expandTo1326, formatGgtoJson, sha256Hex, toGgtoJson } from './codec.js';
export { childSeq, validateChart, type ValidatedChart, type ValidatedNode } from './validate.js';
export { decodeRows, encodeRows } from './blob.js';
export { SCHEMA_SQL, SCHEMA_VERSION, SchemaVersionError, migrate } from './schema.js';
export { openRepository } from './repository.js';
export { CLASS_KEYS, COMBO_KEYS, keysFor } from './keys.js';
