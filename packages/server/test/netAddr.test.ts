/**
 * P3M 7절 R1 — 바인드 주소 대역 분류 표 테스트.
 *
 * 기댓값은 구현이 아니라 **RFC 표**에서 온다: RFC1918 (10/8, 172.16/12, 192.168/16),
 * RFC6598 CGNAT (100.64/10), RFC3927 링크로컬 (169.254/16), RFC4193 ULA (fc00::/7),
 * RFC4291 링크로컬 (fe80::/10) · 루프백 (::1) · unspecified (::).
 */

import { describe, expect, it } from 'vitest';
import {
  chooseLanHost,
  classifyHost,
  classifyIpv4,
  classifyIpv6,
  decideBind,
  describe as describeAddrs,
  lanCandidates,
  publicAddrs,
  type AddrKind,
  type InterfaceAddr,
} from '../src/netAddr.js';

const IPV4_TABLE: [string, AddrKind][] = [
  // 경계를 양쪽에서 친다 — 한 칸 어긋나면 공인이 사설로 넘어간다.
  ['0.0.0.0', 'unspecified'],
  ['127.0.0.1', 'loopback'],
  ['127.255.255.254', 'loopback'],
  ['9.255.255.255', 'public'],
  ['10.0.0.0', 'private'],
  ['10.0.0.1', 'private'],
  ['10.255.255.255', 'private'],
  ['11.0.0.0', 'public'],
  ['172.15.255.255', 'public'],
  ['172.16.0.0', 'private'],
  ['172.31.255.255', 'private'],
  ['172.32.0.0', 'public'],
  ['192.167.255.255', 'public'],
  ['192.168.0.1', 'private'],
  ['192.168.255.255', 'private'],
  ['192.169.0.0', 'public'],
  ['100.63.255.255', 'public'],
  ['100.64.0.1', 'overlay'],
  ['100.100.1.1', 'overlay'],
  ['100.127.255.255', 'overlay'],
  ['100.128.0.0', 'public'],
  ['169.253.255.255', 'public'],
  ['169.254.1.1', 'link-local'],
  ['169.255.0.0', 'public'],
  // 리뷰 PC 의 실제 주소 (P3M R1 MAJOR 1 의 입력)
  ['61.82.129.232', 'public'],
  ['8.8.8.8', 'public'],
  ['1.2.3.4', 'public'],
  // 형식이 아닌 것
  ['10.0.0', 'unknown'],
  ['10.0.0.256', 'unknown'],
  ['010.0.0.1', 'unknown'],
  ['10.0.0.1 ', 'unknown'],
  ['', 'unknown'],
];

const IPV6_TABLE: [string, AddrKind][] = [
  ['::', 'unspecified'],
  ['::1', 'loopback'],
  ['fc00::1', 'private'],
  ['fd12:3456:789a::1', 'private'],
  ['FD00::1', 'private'],
  ['fe80::1', 'link-local'],
  ['fe80::a1b2:c3d4:e5f6:1%eth0', 'link-local'],
  ['febf::1', 'link-local'],
  ['fec0::1', 'public'], // 폐지된 site-local — 사설로 인정하지 않는다
  ['2001:db8::1', 'public'],
  ['2400:cb00::1', 'public'],
  ['fb00::1', 'public'],
  // 짧은 첫 그룹 — 압축 표기는 **앞** 0 을 생략하므로 `fc::1` = `00fc::1` = `::/8` 예약이다.
  // 공인도 사설도 아니지만 우리 분류는 fail-closed 로 `public` (= 안내에 쓰지 않는다). P3M R2 MINOR 1.
  ['fc::1', 'public'],
  ['fd::1', 'public'],
  ['fe8::1', 'public'],
  ['2::1', 'public'],
  ['f::1', 'public'],
  // 대조: 네 자리로 적힌 진짜 ULA/링크로컬은 그대로여야 한다
  ['00fc::1', 'public'],
  ['0fe8::1', 'public'],
  ['fc00::1', 'private'],
  ['fe80::1', 'link-local'],
  ['nonsense', 'unknown'],
];

describe('P3M 7 netAddr — IPv4 대역 분류', () => {
  it.each(IPV4_TABLE)('P3M 7 classifyIpv4(%s) = %s', (addr, kind) => {
    expect(classifyIpv4(addr)).toBe(kind);
  });
});

describe('P3M 7 netAddr — IPv6 대역 분류', () => {
  it.each(IPV6_TABLE)('P3M 7 classifyIpv6(%s) = %s', (addr, kind) => {
    expect(classifyIpv6(addr)).toBe(kind);
  });
});

describe('P3M 7 netAddr — classifyHost', () => {
  it('P3M 7 localhost 만 이름으로 루프백이다', () => {
    expect(classifyHost('localhost')).toBe('loopback');
    expect(classifyHost('ggto.local')).toBe('unknown');
    expect(classifyHost('example.com')).toBe('unknown');
  });
  it('P3M 7 대괄호 IPv6 도 분류한다', () => {
    expect(classifyHost('[::1]')).toBe('loopback');
    expect(classifyHost('[fd00::1]')).toBe('private');
  });
});

// --- 인터페이스 조합 --------------------------------------------------------

const PUBLIC_ONLY: InterfaceAddr[] = [
  { address: '127.0.0.1', family: 'IPv4', internal: true },
  { address: '::1', family: 'IPv6', internal: true },
  { address: '61.82.129.232', family: 'IPv4', internal: false },
  { address: 'fe80::1234', family: 'IPv6', internal: false },
];

const HOME_ROUTER: InterfaceAddr[] = [
  { address: '127.0.0.1', family: 'IPv4', internal: true },
  { address: '192.168.0.17', family: 'IPv4', internal: false },
  { address: 'fe80::abcd', family: 'IPv6', internal: false },
];

const TAILSCALE_ONLY: InterfaceAddr[] = [
  { address: '127.0.0.1', family: 'IPv4', internal: true },
  { address: '100.100.1.1', family: 'IPv4', internal: false },
];

/** Windows 에서 흔한 열거 순서: Tailscale 어댑터가 이더넷보다 **먼저** 나온다 (P3M R2 MINOR 2) */
const TAILSCALE_FIRST: InterfaceAddr[] = [
  { address: '127.0.0.1', family: 'IPv4', internal: true },
  { address: '100.100.1.1', family: 'IPv4', internal: false },
  { address: 'fd7a:115c:a1e0::1', family: 'IPv6', internal: false },
  { address: '192.168.0.17', family: 'IPv4', internal: false },
];

/** ISP 가 글로벌 IPv6 를 주는 가정집: 사설 IPv4 + 공인 IPv6 (P3M R2 MINOR 3) */
const HOME_ROUTER_V6: InterfaceAddr[] = [
  { address: '127.0.0.1', family: 'IPv4', internal: true },
  { address: '192.168.0.17', family: 'IPv4', internal: false },
  { address: '2001:db8::abcd', family: 'IPv6', internal: false },
];

describe('P3M 7 netAddr — lanCandidates / publicAddrs', () => {
  it('P3M 7 공인만 있는 PC 는 안내할 LAN 주소가 없다', () => {
    expect(lanCandidates(PUBLIC_ONLY)).toEqual([]);
    expect(publicAddrs(PUBLIC_ONLY).map((a) => a.address)).toEqual(['61.82.129.232']);
  });
  it('P3M 7 공유기 뒤 PC 는 사설 IPv4 하나를 안내한다 (링크로컬 제외)', () => {
    expect(lanCandidates(HOME_ROUTER).map((a) => a.address)).toEqual(['192.168.0.17']);
    expect(publicAddrs(HOME_ROUTER)).toEqual([]);
  });
  it('P3M 7 오버레이(100.64/10) 도 후보다', () => {
    expect(lanCandidates(TAILSCALE_ONLY).map((a) => [a.address, a.kind])).toEqual([['100.100.1.1', 'overlay']]);
  });
  it('P4 12 (P3M R2 MINOR 2) Tailscale 이 먼저 열거돼도 사설 IPv4 가 첫 후보다', () => {
    // family 만 보는 정렬이면 100.100.1.1 이 첫 후보가 되어 같은 Wi-Fi 의 휴대폰이 못 닿는다.
    expect(lanCandidates(TAILSCALE_FIRST).map((a) => a.address)).toEqual([
      '192.168.0.17',
      'fd7a:115c:a1e0::1',
      '100.100.1.1',
    ]);
    expect(chooseLanHost(TAILSCALE_FIRST, undefined)).toMatchObject({ ok: true, host: '192.168.0.17' });
  });
  it('P3M 7 describe 는 대역 라벨을 붙여 전부 나열한다 (internal 제외)', () => {
    expect(describeAddrs(PUBLIC_ONLY)).toEqual([
      '61.82.129.232 (IPv4, public)',
      'fe80::1234 (IPv6, link-local)',
    ]);
  });
});

// --- decideBind (main.ts 의 기동 게이트) ------------------------------------

describe('P3M 7 netAddr — decideBind', () => {
  it('P3M 7 기본 루프백은 어디서나 허용된다', () => {
    const d = decideBind({ host: '127.0.0.1', addrs: PUBLIC_ONLY, allowPublic: false });
    expect(d.ok).toBe(true);
  });
  it('P3M 7 공인 IP 직접 바인드는 거부된다', () => {
    const d = decideBind({ host: '61.82.129.232', addrs: PUBLIC_ONLY, allowPublic: false });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain('공인 IP');
  });
  it('P3M 7 0.0.0.0 은 공인 IP 가 붙어 있으면 거부된다', () => {
    const d = decideBind({ host: '0.0.0.0', addrs: PUBLIC_ONLY, allowPublic: false });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.detail).toEqual(['61.82.129.232 (IPv4)']);
  });
  it('P3M 7 0.0.0.0 도 공인 IP 가 없으면 허용된다', () => {
    const d = decideBind({ host: '0.0.0.0', addrs: HOME_ROUTER, allowPublic: false });
    expect(d.ok).toBe(true);
  });
  it('P3M 7 :: 도 같은 규칙이다', () => {
    expect(decideBind({ host: '::', addrs: PUBLIC_ONLY, allowPublic: false }).ok).toBe(false);
    expect(decideBind({ host: '::', addrs: HOME_ROUTER, allowPublic: false }).ok).toBe(true);
  });
  it('P3M 7 사설 주소 바인드는 허용된다', () => {
    expect(decideBind({ host: '192.168.0.17', addrs: HOME_ROUTER, allowPublic: false }).ok).toBe(true);
    expect(decideBind({ host: 'fd00::1', addrs: HOME_ROUTER, allowPublic: false }).ok).toBe(true);
  });
  it('P4 12 (P3M R2 MINOR 3) 0.0.0.0 은 공인 IPv6 를 열지 않으므로 허용된다', () => {
    const d = decideBind({ host: '0.0.0.0', addrs: HOME_ROUTER_V6, allowPublic: false });
    expect(d.ok).toBe(true);
    // 경고용 노출 목록에는 그대로 남는다 (기동은 막지 않는다)
    if (d.ok) expect(d.exposedPublic).toEqual(['2001:db8::abcd (IPv6)']);
  });
  it('P4 12 (P3M R2 MINOR 3) :: 는 IPv6 공인까지 세므로 거부된다', () => {
    const d = decideBind({ host: '::', addrs: HOME_ROUTER_V6, allowPublic: false });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.detail).toEqual(['2001:db8::abcd (IPv6)']);
  });
  it('P4 12 (P3M R2 MINOR 3) 0.0.0.0 은 공인 IPv4 가 있으면 여전히 거부된다', () => {
    const mixed: InterfaceAddr[] = [...HOME_ROUTER_V6, { address: '61.82.129.232', family: 'IPv4', internal: false }];
    const d = decideBind({ host: '0.0.0.0', addrs: mixed, allowPublic: false });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.detail).toEqual(['61.82.129.232 (IPv4)']);
  });
  it('P3M 7 대역을 증명할 수 없는 호스트명은 거부된다', () => {
    const d = decideBind({ host: 'my-pc.lan', addrs: HOME_ROUTER, allowPublic: false });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain('판정할 수 없다');
  });
  it('P3M 7 GGTO_ALLOW_PUBLIC=1 이면 공인도 허용하되 노출 목록을 남긴다', () => {
    const d = decideBind({ host: '0.0.0.0', addrs: PUBLIC_ONLY, allowPublic: true });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.exposedPublic).toEqual(['61.82.129.232 (IPv4)']);
  });
});

// --- chooseLanHost (start:lan) ---------------------------------------------

describe('P3M 7 netAddr — chooseLanHost', () => {
  it('P3M 7 공인만 있는 PC 에서는 start:lan 이 거부된다 (R1 MAJOR 1)', () => {
    const c = chooseLanHost(PUBLIC_ONLY, undefined);
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.reason).toContain('사설 LAN 주소');
      expect(c.detail).toContain('61.82.129.232 (IPv4, public)');
    }
  });
  it('P3M 7 사설 주소가 있으면 0.0.0.0 이 아니라 그 주소에 바인드한다', () => {
    const c = chooseLanHost(HOME_ROUTER, undefined);
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.host).toBe('192.168.0.17');
      expect(c.host).not.toBe('0.0.0.0');
    }
  });
  it('P3M 7 GGTO_HOST 가 공인이면 start:lan 이 거부된다', () => {
    const c = chooseLanHost(HOME_ROUTER, '61.82.129.232');
    expect(c.ok).toBe(false);
  });
  it('P3M 7 GGTO_HOST 가 와일드카드여도 start:lan 은 거부한다 (사설 하나만 연다)', () => {
    const c = chooseLanHost(HOME_ROUTER, '0.0.0.0');
    expect(c.ok).toBe(false);
  });
  it('P3M 7 GGTO_HOST 로 사설 주소를 고를 수 있다', () => {
    const c = chooseLanHost(HOME_ROUTER, '192.168.0.17');
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.host).toBe('192.168.0.17');
  });
});
