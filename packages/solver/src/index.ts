/**
 * `@ggto/solver` — 솔브 잡 오케스트레이션 (P4.md).
 *
 * 런타임 의존성은 `@ggto/core` 와 node 내장(`child_process`·`fs`·`crypto`·`sqlite`) 뿐이다.
 * HTTP 도 React 도 모른다 (P4.md 1절·2절).
 */

export { aggregateNode, type NodeAggregate } from './aggregate.js';
export {
  CacheSchemaVersionError,
  DEFAULT_CACHE_BYTES,
  SolveCache,
  type EvictReport,
  type RepairReport,
  type SolveRow,
} from './cache.js';
export { MAX_RANGE_TEXT, SIZING_PRESETS, buildConfig, isSizingPreset } from './config.js';
export { DaemonClient, PROTOCOL, STALL_MS, STDERR_TAIL_BYTES, TIMEOUTS, type SpawnFn } from './daemon/client.js';
export {
  PostflopSolverCli,
  SOLVER_ID,
  defaultBinPath,
  resolveBin,
  wireConfig,
  type PostflopSolverCliOptions,
} from './daemon/postflopCli.js';
export { FakeSolver, type FakeSolverOptions } from './fakeSolver.js';
export { canonicalConfigJson, configHash, rangeHex, ticketFor } from './hash.js';
export { assertCanonicalLine, permuteBoardString, permuteLine } from './line.js';
export {
  DEFAULT_CONCURRENCY,
  DEFAULT_MEMORY_BYTES,
  JobQueue,
  type JobEvent,
  type JobHandle,
  type JobStatus,
  type JobQueueOptions,
  type SubmitInput,
} from './queue.js';
export * from './types.js';
export { decodeRows, toNodeResponse, toRunoutsResponse, type NodeResponse, type RunoutsResponse } from './view.js';
