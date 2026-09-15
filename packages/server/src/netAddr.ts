/**
 * 바인드 주소 분류와 기동 허용 판정 (P3M 7절 R1 / D19).
 *
 * **왜 이 파일이 따로 있나**: "LAN 에서만 쓰라" 를 문서에만 적어 두면 지켜지지 않는다.
 * 리뷰 PC 의 유일한 IPv4 가 공인 `61.82.129.232/26` (Windows 연결 프로필 Public) 이었고,
 * `start:lan` 이 `0.0.0.0` 에 바인드한 뒤 그 공인 주소를 "휴대폰에서:" 로 안내했다 —
 * 인증 없는 트레이너 기록이 인터넷에 열린 것이다 (P3M R1 MAJOR 1). 그래서 **대역을
 * 코드가 판정**하고, 공인 노출은 명시적 opt-in(`GGTO_ALLOW_PUBLIC=1`) 을 요구한다.
 *
 * 순수 함수만 둔다 (`os.networkInterfaces()` 를 부르지 않는다) — 표 테스트를 위해서다.
 */

/**
 * 주소 대역.
 * - `loopback`: 127/8, ::1 — 기본값. 다른 기기가 닿지 못한다
 * - `private`: RFC1918 (10/8, 172.16/12, 192.168/16) + IPv6 ULA fc00::/7
 * - `overlay`: CGNAT 100.64/10 — Tailscale 류. 사설은 아니지만 인터넷에서 라우팅되지 않는다
 * - `link-local`: 169.254/16, fe80::/10 — 안내에 쓰지 않는다 (휴대폰이 못 친다)
 * - `unspecified`: 0.0.0.0, :: — "전부" 바인드. 그 자체로는 대역이 아니다
 * - `public`: 그 밖의 라우팅 가능한 주소
 * - `unknown`: IP 리터럴이 아닌 것 (호스트명 등). 대역을 증명할 수 없다
 */
export type AddrKind =
  | 'loopback'
  | 'private'
  | 'overlay'
  | 'link-local'
  | 'unspecified'
  | 'public'
  | 'unknown';

/** LAN 안내에 쓸 수 있는가 (휴대폰이 칠 수 있고 인터넷에 열리지 않는다) */
export function isReachableLan(kind: AddrKind): boolean {
  return kind === 'private' || kind === 'overlay';
}

function parseIpv4(addr: string): [number, number, number, number] | null {
  const parts = addr.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    // `01` 이나 `+1` 을 Number 가 받아 주면 분류가 흔들린다. 십진 표기만 받는다.
    if (!/^(0|[1-9]\d{0,2})$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return [out[0] as number, out[1] as number, out[2] as number, out[3] as number];
}

export function classifyIpv4(addr: string): AddrKind {
  const oct = parseIpv4(addr);
  if (oct === null) return 'unknown';
  const [a, b] = oct;
  if (a === 0 && oct[1] === 0 && oct[2] === 0 && oct[3] === 0) return 'unspecified';
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  // CGNAT: Tailscale/네트워크 사업자. 인터넷에서 이 주소로 들어오지 못한다.
  if (a === 100 && b >= 64 && b <= 127) return 'overlay';
  if (a === 169 && b === 254) return 'link-local';
  return 'public';
}

/** IPv6 리터럴. 대역폭이 필요한 건 앞 몇 비트뿐이라 전체 파싱은 하지 않는다. */
export function classifyIpv6(addr: string): AddrKind {
  // `fe80::1%eth0` 처럼 존 인덱스가 붙어 온다 (os.networkInterfaces).
  const zoneAt = addr.indexOf('%');
  const bare = (zoneAt === -1 ? addr : addr.slice(0, zoneAt)).toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(bare) || !bare.includes(':')) return 'unknown';
  if (bare === '::') return 'unspecified';
  if (bare === '::1') return 'loopback';
  const head = bare.split(':')[0] ?? '';
  if (head === '') return 'unknown'; // `::ffff:…` 등 — 판정하지 않는다
  const n = Number.parseInt(head.padEnd(4, '0'), 16);
  if (!Number.isFinite(n)) return 'unknown';
  // fe80::/10 — 상위 10비트가 1111111010
  if ((n & 0xffc0) === 0xfe80) return 'link-local';
  // fc00::/7 ULA — 상위 7비트가 1111110
  if ((n & 0xfe00) === 0xfc00) return 'private';
  return 'public';
}

/** 호스트 문자열(IP 리터럴 또는 이름) 분류. `localhost` 만 이름으로 인정한다. */
export function classifyHost(host: string): AddrKind {
  if (host === 'localhost') return 'loopback';
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (bare.includes(':')) return classifyIpv6(bare);
  return classifyIpv4(bare);
}

export interface InterfaceAddr {
  address: string;
  family: 'IPv4' | 'IPv6';
  internal: boolean;
}

export interface ClassifiedAddr extends InterfaceAddr {
  kind: AddrKind;
}

/** `os.networkInterfaces()` 평탄화 결과를 분류한다 (internal 은 제외하지 않는다 — 분류만) */
export function classifyInterfaces(addrs: readonly InterfaceAddr[]): ClassifiedAddr[] {
  return addrs.map((a) => ({ ...a, kind: a.family === 'IPv4' ? classifyIpv4(a.address) : classifyIpv6(a.address) }));
}

/** 휴대폰에 안내할 주소들. 공인·링크로컬·루프백은 뺀다. IPv4 를 IPv6 보다 앞에 둔다. */
export function lanCandidates(addrs: readonly InterfaceAddr[]): ClassifiedAddr[] {
  return classifyInterfaces(addrs)
    .filter((a) => !a.internal && isReachableLan(a.kind))
    .sort((x, y) => (x.family === y.family ? 0 : x.family === 'IPv4' ? -1 : 1));
}

/** 인터페이스에 붙어 있는 공인 주소들 (와일드카드 바인드가 노출하는 것) */
export function publicAddrs(addrs: readonly InterfaceAddr[]): ClassifiedAddr[] {
  return classifyInterfaces(addrs).filter((a) => !a.internal && a.kind === 'public');
}

export type BindDecision =
  | { ok: true; host: string; kind: AddrKind; exposedPublic: readonly string[] }
  | { ok: false; host: string; kind: AddrKind; reason: string; detail: readonly string[] };

export interface BindInput {
  /** `GGTO_HOST` 로 요청된 바인드 주소 */
  host: string;
  addrs: readonly InterfaceAddr[];
  /** `GGTO_ALLOW_PUBLIC=1` */
  allowPublic: boolean;
}

/**
 * 기동을 허용할지 판정한다.
 *
 * 거부는 셋: (a) 공인 IP 를 직접 바인드, (b) 와일드카드인데 인터페이스에 공인 IP 가 있음,
 * (c) 대역을 증명할 수 없는 호스트명. 전부 `GGTO_ALLOW_PUBLIC=1` 로 뚫을 수 있다 —
 * 막는 것이 목적이 아니라 **모르고 여는 것**을 막는 것이 목적이다.
 */
export function decideBind(input: BindInput): BindDecision {
  const kind = classifyHost(input.host);
  const exposed = publicAddrs(input.addrs).map((a) => `${a.address} (${a.family})`);

  if (input.allowPublic) return { ok: true, host: input.host, kind, exposedPublic: exposed };

  if (kind === 'public') {
    return {
      ok: false,
      host: input.host,
      kind,
      reason: `GGTO_HOST=${input.host} 는 공인 IP 다 — 인증이 없는 서버를 인터넷에 여는 바인드다`,
      detail: [`분류: public`],
    };
  }
  if (kind === 'unknown') {
    return {
      ok: false,
      host: input.host,
      kind,
      reason: `GGTO_HOST=${input.host} 의 대역을 판정할 수 없다 — 사설 IP 를 직접 적어라`,
      detail: [`IP 리터럴이 아니다 (localhost 는 예외)`],
    };
  }
  if (kind === 'unspecified' && exposed.length > 0) {
    return {
      ok: false,
      host: input.host,
      kind,
      reason: `GGTO_HOST=${input.host} 는 모든 인터페이스에 바인드하는데 이 PC 에 공인 IP 가 있다`,
      detail: exposed,
    };
  }
  return { ok: true, host: input.host, kind, exposedPublic: exposed };
}

/**
 * `start:lan` 이 쓸 바인드 주소. 와일드카드(`0.0.0.0`) 를 쓰지 않는 이유: 공인 IP 가 붙은
 * 인터페이스까지 같이 열리기 때문이다. **사설 주소 하나에만** 바인드한다.
 */
export type LanBind =
  | { ok: true; host: string; kind: AddrKind; candidates: readonly ClassifiedAddr[] }
  | { ok: false; reason: string; detail: readonly string[] };

export function chooseLanHost(addrs: readonly InterfaceAddr[], requested?: string | undefined): LanBind {
  const candidates = lanCandidates(addrs);
  if (requested !== undefined && requested.length > 0) {
    const kind = classifyHost(requested);
    if (!isReachableLan(kind) && kind !== 'loopback') {
      return {
        ok: false,
        reason: `GGTO_HOST=${requested} 는 ${kind} 다 — start:lan 은 사설/오버레이 주소에만 바인드한다`,
        detail: describe(addrs),
      };
    }
    return { ok: true, host: requested, kind, candidates };
  }
  const first = candidates[0];
  if (first === undefined) {
    return {
      ok: false,
      reason: '이 PC 에 사설 LAN 주소(10/8 · 172.16/12 · 192.168/16 · fc00::/7 · 100.64/10) 가 없다',
      detail: describe(addrs),
    };
  }
  return { ok: true, host: first.address, kind: first.kind, candidates };
}

/** 거부 로그에 찍을 "발견된 주소와 대역" 목록 */
export function describe(addrs: readonly InterfaceAddr[]): string[] {
  return classifyInterfaces(addrs)
    .filter((a) => !a.internal)
    .map((a) => `${a.address} (${a.family}, ${a.kind})`);
}
