/**
 * @ggto/trainer — 스팟·채점·샘플러·SRS·리포트·기록 저장소. P3.md 1절.
 *
 * HTTP/React 를 모른다. 채점과 샘플링은 전부 **1326 콤보** 단위이고 169 는 화면이
 * 셀을 강조할 때만 쓴다 (D4).
 */

export {
  CATEGORIES,
  EmptyPoolError,
  MissingChartError,
  SessionNotFoundError,
  SpotKeyError,
  SpotMismatchError,
  TrainerInputError,
  VERDICTS,
  isCategory,
  type Agg,
  type Category,
  type CategoryAgg,
  type Grade,
  type GradeActionRow,
  type GradedBy,
  type Leak,
  type Report,
  type ReportScope,
  type SessionFilter,
  type SessionInfo,
  type SetAgg,
  type Spot,
  type Verdict,
} from './types.js';

export {
  MIX_EPS,
  MINOR_MAX_BB,
  MISTAKE_MAX_BB,
  PERFECT_MAX_BB,
  GradeError,
  grade,
  isMixed,
  isPlayedFreq,
  mixedMassOf,
  verdictForEvLoss,
  type GradeInput,
} from './grade.js';

export { categoryOf, categoryOfState, isTerminalSeq, preflopStateOf } from './category.js';
export { SPOT_KEY_PREFIX, formatCombo, formatSpotKey, parseCombo, parseSpotKey, type ParsedSpotKey } from './spotKey.js';
export {
  DAY_MS,
  INITIAL_EASE,
  LEECH_LAPSES,
  MAX_INTERVAL_DAYS,
  MIN_EASE,
  applyReview,
  dueCapAt,
  initialSrs,
  isLeech,
  qualityOf,
  type SrsState,
} from './srs.js';
export { HASH_ALIAS_SQL, TRAINER_SCHEMA_SQL, TRAINER_SCHEMA_VERSION, SchemaVersionError, migrate } from './schema.js';
export { buildPool, collectPool, findNode, findNodeByKey, sampleCombo, setHashes, spotKeyOf, type Pool, type PoolNode } from './pool.js';
export {
  LEAK_CAP,
  LEAK_SCALE_BB,
  MIXED_WEIGHT,
  difficultyWeight,
  leakWeight,
  nodeWeight,
  pickNode,
} from './sampler.js';
export { DUE_SCAN_LIMIT, LEAK_WINDOW_DAYS, RESAMPLE_TRIES, drawSpotKey, leakMeans } from './draw.js';
export { LEAK_MIN_ATTEMPTS, LEAK_MIN_MEAN_BB, aggregate, byCategory, bySet, leaksOf } from './report.js';
export { TrainerStore, type AliasApplyResult, type AttemptAgg, type AttemptInsert, type SessionRow } from './store.js';
export { applyAliases, type AliasMigrationReport } from './migrate.js';
export {
  MAX_MS_TAKEN,
  MAX_SESSION_COUNT,
  TrainerService,
  openTrainer,
  type AnswerRequest,
  type AnswerResult,
  type CreateSessionRequest,
  type NextResult,
  type OpenTrainerOptions,
  type PoolInfo,
  type SessionStatus,
  type SpotView,
} from './service.js';
