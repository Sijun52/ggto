/**
 * 차트셋 별칭 파일 `aliases.json` (P7.md 7.1, D35).
 *
 * 생성기가 옛 `content_hash` → 새 `content_hash` 대응을 적고, 임포터가 옛 셋을 은퇴시키고,
 * `trainer:migrate` 가 사용자 기록을 옮긴다. **세 도구가 같은 파서를 쓴다** — 포맷이
 * 갈라지면 기록이 엉뚱한 차트로 옮겨가고 되돌릴 수 없다.
 *
 * 여기(`@ggto/preflop`)에 두는 이유: `content_hash` 는 이 패키지가 정의하는 영구 식별자다
 * (P2 4.3). 임포터·마이그레이터가 생성기(`tools/chart-gen`)에 의존하지 않게 된다.
 */

export const ALIAS_FORMAT = 'ggto-aliases';
export const ALIAS_VERSION = 1;
export const ALIAS_FILE_NAME = 'aliases.json';

export interface ChartAlias {
  /** 은퇴하는 옛 `content_hash` */
  from: string;
  /** 대체하는 새 `content_hash` */
  to: string;
  reason: string;
}

export interface AliasFile {
  format: typeof ALIAS_FORMAT;
  version: typeof ALIAS_VERSION;
  aliases: ChartAlias[];
}

const HASH_RE = /^[0-9a-f]{64}$/;

export class AliasFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AliasFileError';
  }
}

export function isContentHash(v: unknown): v is string {
  return typeof v === 'string' && HASH_RE.test(v);
}

/** 파일 내용 검증. 어긋나면 throw — 반쯤 읽은 별칭으로 기록을 옮기지 않는다. */
export function parseAliasFile(text: string, label: string): AliasFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new AliasFileError(`${label}: not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AliasFileError(`${label}: top level must be an object`);
  }
  const doc = raw as Partial<AliasFile>;
  if (doc.format !== ALIAS_FORMAT) throw new AliasFileError(`${label}: format must be ${JSON.stringify(ALIAS_FORMAT)}`);
  if (doc.version !== ALIAS_VERSION) throw new AliasFileError(`${label}: version must be ${String(ALIAS_VERSION)}`);
  if (!Array.isArray(doc.aliases)) throw new AliasFileError(`${label}: aliases must be an array`);
  const seen = new Set<string>();
  for (const [i, entry] of doc.aliases.entries()) {
    const at = `${label}: aliases[${String(i)}]`;
    if (typeof entry !== 'object' || entry === null) throw new AliasFileError(`${at} must be an object`);
    const alias = entry as Partial<ChartAlias>;
    if (!isContentHash(alias.from)) throw new AliasFileError(`${at}.from must be 64 lowercase hex characters`);
    if (!isContentHash(alias.to)) throw new AliasFileError(`${at}.to must be 64 lowercase hex characters`);
    if (alias.from === alias.to) throw new AliasFileError(`${at} maps a hash onto itself`);
    if (typeof alias.reason !== 'string' || alias.reason.length === 0) {
      throw new AliasFileError(`${at}.reason must be a non-empty string`);
    }
    // 같은 from 이 두 번 나오면 어느 쪽이 이기는지가 파일 순서에 달린다 — 거부한다.
    if (seen.has(alias.from)) throw new AliasFileError(`${at}.from appears twice: ${alias.from}`);
    seen.add(alias.from);
  }
  // 연쇄(a→b, b→c)는 적용 순서에 따라 결과가 달라진다. 지금은 만들지 않으므로 거부한다.
  for (const alias of doc.aliases) {
    if (seen.has(alias.to)) throw new AliasFileError(`${label}: alias target ${alias.to.slice(0, 8)} is itself retired (chains are not supported)`);
  }
  return doc as AliasFile;
}
