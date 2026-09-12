/**
 * 액션 시퀀스 문자열. P0.md 4.7. **이것이 캐시 키다.**
 *
 * sequence := street ( '/' street )*        (후행 '/' 금지, 빈 세그먼트 금지)
 * street   := action ( '-' action )*
 * action   := 'F' | 'X' | 'C' | 'A' | 'B' amount | 'R' amount
 * amount   := 정규 소수. 정수부는 '0' 또는 [1-9]\d*, 소수부는 있으면 후행 0 없이.
 *
 * 구분자를 '.' 대신 '-' 로 쓰는 이유: '.' 는 소수점과 충돌해 "R2.5" 를 쪼갠다
 * (docs/reviews/phase-minus1-design-round1.md CRITICAL 1).
 *
 * 정규형만 받는다. 파싱↔포매팅은 항등이어야 하고, 서로 다른 두 상태가
 * 같은 문자열을 만들면 안 된다.
 */

export type Action =
  | { kind: 'fold' }
  | { kind: 'check' }
  | { kind: 'call' }
  | { kind: 'bet'; amount: number }
  | { kind: 'raise'; amount: number }
  | { kind: 'allin' };

export type Street = Action[];
export type ActionSequence = Street[];

export class ActionSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionSyntaxError';
  }
}

/** 정수부 '0' 또는 [1-9]\d*, 소수부가 있으면 마지막 자리는 0이 아니어야 한다. */
const AMOUNT_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/;

function parseAmount(text: string, token: string): number {
  if (!AMOUNT_RE.test(text)) {
    throw new ActionSyntaxError(
      `bad amount ${JSON.stringify(text)} in token ${JSON.stringify(token)} ` +
        '(canonical decimal only: no leading zeros, no trailing zeros, no sign, no exponent)',
    );
  }
  const v = Number(text);
  if (!Number.isFinite(v)) {
    throw new ActionSyntaxError(`amount is not finite: ${JSON.stringify(text)}`);
  }
  // 파서가 읽은 값을 다시 포맷하면 동일 문자열이어야 한다 → 2자리 초과 소수는 정규형이 아니다.
  if (formatAmount(v) !== text) {
    throw new ActionSyntaxError(
      `amount ${JSON.stringify(text)} is not in canonical form (max 2 decimal places, got ${formatAmount(v)})`,
    );
  }
  return v;
}

/**
 * 금액 상한 (P0.md 4.7). 기술적 경계가 아니라 여유 있게 고른 실용 상한이다.
 *
 * 진짜 경계는 2자리 반올림 `Math.round(x * 100) / 100` 이 정확한 조건 `x * 100 < 2^53`
 * (x < 약 9.007e13) 이고, `String(x)` 의 지수 표기는 1e21 부터 시작한다.
 * 1e9 는 그 둘보다 훨씬 아래에서 bb/chips 어느 단위로도 충분히 큰 값을 고른 것이다
 * (P0 R2 MINOR 3: 이전 주석의 "1e9 위로 가면 지수 표기" 는 사실이 아니었다).
 */
export const MAX_AMOUNT = 1e9;

/** bb 해상도 0.01. 소수부 최대 2자리로 반올림한 정규 표기. */
export function formatAmount(amount: number): string {
  if (!Number.isFinite(amount)) {
    throw new ActionSyntaxError(`amount must be finite: ${String(amount)}`);
  }
  if (amount < 0) throw new ActionSyntaxError(`amount must not be negative: ${String(amount)}`);
  if (amount > MAX_AMOUNT) {
    throw new ActionSyntaxError(`amount exceeds the maximum ${String(MAX_AMOUNT)}: ${String(amount)}`);
  }
  const rounded = Math.round(amount * 100) / 100;
  return String(rounded);
}

function parseAction(token: string): Action {
  if (token.length === 0) throw new ActionSyntaxError('empty action token');
  const head = token[0] as string;
  const rest = token.slice(1);
  switch (head) {
    case 'F':
      if (rest.length > 0) throw new ActionSyntaxError(`"F" takes no amount: ${JSON.stringify(token)}`);
      return { kind: 'fold' };
    case 'X':
      if (rest.length > 0) throw new ActionSyntaxError(`"X" takes no amount: ${JSON.stringify(token)}`);
      return { kind: 'check' };
    case 'C':
      if (rest.length > 0) throw new ActionSyntaxError(`"C" takes no amount: ${JSON.stringify(token)}`);
      return { kind: 'call' };
    case 'A':
      if (rest.length > 0) throw new ActionSyntaxError(`"A" takes no amount: ${JSON.stringify(token)}`);
      return { kind: 'allin' };
    case 'B':
      if (rest.length === 0) throw new ActionSyntaxError(`"B" needs an amount: ${JSON.stringify(token)}`);
      return { kind: 'bet', amount: parseAmount(rest, token) };
    case 'R':
      if (rest.length === 0) throw new ActionSyntaxError(`"R" needs an amount: ${JSON.stringify(token)}`);
      return { kind: 'raise', amount: parseAmount(rest, token) };
    default:
      throw new ActionSyntaxError(
        `unknown action token ${JSON.stringify(token)} (expected F/X/C/A/B<amt>/R<amt>, case sensitive)`,
      );
  }
}

export function formatAction(a: Action): string {
  switch (a.kind) {
    case 'fold':
      return 'F';
    case 'check':
      return 'X';
    case 'call':
      return 'C';
    case 'allin':
      return 'A';
    case 'bet':
      return `B${formatAmount(a.amount)}`;
    case 'raise':
      return `R${formatAmount(a.amount)}`;
    default: {
      const never: never = a;
      throw new ActionSyntaxError(`unknown action: ${JSON.stringify(never)}`);
    }
  }
}

export function formatStreet(street: Street): string {
  return street.map(formatAction).join('-');
}

export function formatActionSequence(seq: ActionSequence): string {
  if (seq.length === 0) return '';
  for (let i = 0; i < seq.length; i++) {
    if ((seq[i] as Street).length === 0) {
      // 빈 스트리트는 문자열로 표현할 수 없다 (후행/연속 '/' 가 되어 왕복이 깨진다).
      throw new ActionSyntaxError(
        `street ${String(i)} is empty; an ActionSequence must not contain empty streets`,
      );
    }
  }
  return seq.map(formatStreet).join('/');
}

export function parseActionSequence(s: string): ActionSequence {
  if (typeof s !== 'string') throw new ActionSyntaxError('parseActionSequence expects a string');
  if (s.length === 0) return [];
  if (/\s/.test(s)) throw new ActionSyntaxError(`whitespace is not allowed: ${JSON.stringify(s)}`);
  const segments = s.split('/');
  const out: ActionSequence = [];
  for (const seg of segments) {
    if (seg.length === 0) {
      throw new ActionSyntaxError(`empty street segment in ${JSON.stringify(s)} (no leading/trailing/double "/")`);
    }
    const tokens = seg.split('-');
    const street: Street = [];
    for (const t of tokens) {
      if (t.length === 0) {
        throw new ActionSyntaxError(`empty action token in ${JSON.stringify(s)} (no leading/trailing/double "-")`);
      }
      street.push(parseAction(t));
    }
    out.push(street);
  }
  return out;
}
