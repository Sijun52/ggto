/**
 * P4.md 8.1 — stdio JSON-lines 클라이언트. Rust 없이 `npm run ci` 에서 돈다.
 *
 * 검사 대상은 **프레이밍과 실패 처리**다: 줄이 쪼개져 와도, 여러 줄이 한 청크에 와도,
 * 데몬이 죽어도, 조용해도 클라이언트가 옳게 굴어야 한다. 이 경로가 깨지면 잡이 영원히
 * 매달린다 (사용자에게는 "진행률 12% 에서 멈춤" 으로 보인다).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DaemonClient, STALL_MS, STDERR_TAIL_BYTES, type SpawnFn } from '../src/daemon/client.js';
import { PostflopSolverCli } from '../src/daemon/postflopCli.js';
import { buildConfig } from '../src/config.js';
import { SolverError } from '../src/types.js';

const DAEMON = fileURLToPath(new URL('./fake-daemon.mjs', import.meta.url));

const open: DaemonClient[] = [];

function client(scenario: string, onStderr?: (l: string) => void): DaemonClient {
  const spawnFn: SpawnFn = () =>
    spawn(process.execPath, [DAEMON, '--serve', '--scenario', scenario], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
  const c = new DaemonClient({
    bin: process.execPath,
    mode: '--serve',
    spawnFn,
    onStderr: onStderr ?? ((): void => undefined),
  });
  open.push(c);
  return c;
}

afterEach(async () => {
  vi.useRealTimers();
  // 잔여 프로세스를 남기지 않는다 (P3M R2 MINOR 6 의 교훈).
  for (const c of open.splice(0)) await c.close(200);
});

describe('P4 5.3 데몬 클라이언트 — 프레이밍', () => {
  it('P4 5.3 한 줄이 세 청크로 쪼개져 와도 하나의 응답으로 읽는다', async () => {
    const c = client('split');
    const hello = await c.hello();
    expect(hello.protocol).toBe(1);
    const r = (await c.request('stats', {})) as { echoed: string };
    expect(r.echoed).toBe('stats');
  });

  it('P4 5.3 한 청크에 두 프레임이 붙어 와도 둘 다 처리한다', async () => {
    const c = client('batched');
    await c.hello();
    const r = (await c.request('stats', {})) as { echoed: string };
    expect(r.echoed).toBe('stats');
  });

  it('P4 5.3 파싱 불가 줄은 로그로 남기고 그 다음 응답을 정상 처리한다', async () => {
    const logs: string[] = [];
    const c = client('junk-line', (l) => logs.push(l));
    const r = (await c.request('stats', {})) as { echoed: string };
    expect(r.echoed).toBe('stats');
    expect(logs.some((l) => l.includes('unparseable line'))).toBe(true);
  });

  it('P4 5.3 에러 프레임은 code 를 보존한 SolverError 가 된다', async () => {
    const c = client('normal');
    await expect(c.request('boom', {})).rejects.toMatchObject({ code: 'NoSuchLine' });
  });
});

describe('P4 5.3 데몬 클라이언트 — 실패 모드', () => {
  it('P4 5.3 protocol 2 는 ProtocolMismatch 로 즉시 끊는다', async () => {
    const c = client('protocol2');
    await expect(c.hello()).rejects.toMatchObject({ code: 'ProtocolMismatch' });
  });

  it('P4 5.3 데몬이 죽으면 대기 중 Promise 가 전부 DaemonExited + stderr 꼬리다', async () => {
    const c = client('crash');
    const a = c.request('stats', {});
    const b = c.request('stats', {});
    const results = await Promise.allSettled([a, b]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    for (const r of results) {
      const e = (r as PromiseRejectedResult).reason as SolverError;
      expect(e.code).toBe('DaemonExited');
      expect(String(e.detail.stderrTail)).toContain('fake daemon is going down');
    }
    expect(c.alive).toBe(false);
  });

  it('P4 5.3 stderr 꼬리는 8KB 로 절단된다', async () => {
    const c = client('noisy-stderr');
    await c.request('stats', {}).catch(() => undefined);
    // 40KB 를 뱉었지만 다음 실패의 detail 은 8KB 를 넘지 않아야 한다.
    c.kill();
    await new Promise((r) => setTimeout(r, 200));
    const e = (await c.request('stats', {}).catch((x: unknown) => x)) as SolverError;
    expect(e.code).toBe('DaemonExited');
    expect(String(e.detail.stderrTail).length).toBeLessThanOrEqual(STDERR_TAIL_BYTES);
  });

  it('P4 5.3 진행률 침묵이 창을 넘기면 Stalled 로 끊고 kill 한다', async () => {
    // 창을 주입해서 잰다 (`stallMs`). `vi.useFakeTimers` 로는 이 경로를 못 잡는다:
    // 침묵 타이머는 **첫 progress 가 실제로 도착한 뒤** 무장되므로, 그 I/O 를 기다리는
    // 동안 가짜 타이머로 바꿔도 이미 잡힌 real timer 가 앞당겨지지 않는다. 기본값이
    // 120s 라는 사실은 `STALL_MS` 단언으로 따로 고정한다.
    expect(STALL_MS).toBe(120_000);
    let killed = 0;
    const spawnFn: SpawnFn = () => {
      const child = spawn(process.execPath, [DAEMON, '--serve', '--scenario', 'silent'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      }) as ChildProcessWithoutNullStreams;
      const realKill = child.kill.bind(child);
      child.kill = ((...a: unknown[]) => {
        killed += 1;
        return realKill(...(a as []));
      }) as typeof child.kill;
      return child;
    };
    const c = new DaemonClient({ bin: process.execPath, mode: '--solve', spawnFn, stallMs: 300 });
    open.push(c);
    const seen: unknown[] = [];
    const started = Date.now();
    const p = c.requestWithProgress('solve', {}, (x) => seen.push(x));
    await expect(p).rejects.toMatchObject({ code: 'Stalled' });
    // progress 는 실제로 한 번 왔다 — 타이머가 무장되지도 않았는데 끊긴 것이 아니다.
    expect(seen.length).toBe(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(killed).toBeGreaterThan(0);
  });

  it('P4 5.1 close 는 stdin 을 닫고 유예가 지나면 kill 을 부른다', async () => {
    let killed = 0;
    // 절대 끝나지 않는 자식: stdin 을 닫아도 살아 있다 → 유예 뒤 kill 경로를 탄다.
    const spawnFn: SpawnFn = () => {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      }) as ChildProcessWithoutNullStreams;
      const realKill = child.kill.bind(child);
      child.kill = ((...a: unknown[]) => {
        killed += 1;
        return realKill(...(a as []));
      }) as typeof child.kill;
      return child;
    };
    const c = new DaemonClient({ bin: process.execPath, mode: '--solve', spawnFn });
    open.push(c);
    await c.close(150);
    expect(killed).toBe(1);
  });
});

// --- P5 12절 (P4 R1 MINOR 5): 취소가 500ms 안에 끝난다 -------------------------

describe('P4 5.1 취소 — 협조가 늦으면 kill', () => {
  it('P5 12 R1-5 cancel 에 응답이 없어도 500ms 뒤 프로세스를 죽여 solve 가 끝난다', async () => {
    const spawnFn: SpawnFn = () =>
      spawn(process.execPath, [DAEMON, '--solve', '--scenario', 'stubborn-cancel'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      }) as ChildProcessWithoutNullStreams;
    const solver = new PostflopSolverCli({ bin: process.execPath, spawnFn, onLog: () => undefined });
    const cfg = buildConfig({
      oop: '22+',
      ip: 'TT-22',
      board: 'Ks7h2h',
      potBb: 20,
      stackBb: 80,
      sizings: 'simple',
    });
    const ac = new AbortController();
    const progress: number[] = [];
    const solving = solver.solve(
      cfg,
      { targetExploitabilityPct: 0.5, maxIterations: 100, outPath: join(tmpdir(), 'ggto-cancel-test.part') },
      (p) => progress.push(p.iter),
      ac.signal,
    );
    // 첫 진행률이 올 때까지 기다린다 (데몬이 실제로 돌기 시작한 시점).
    for (let i = 0; i < 40 && progress.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
    expect(progress.length).toBeGreaterThan(0);

    const t0 = Date.now();
    ac.abort();
    // 협조적 취소가 영영 오지 않으므로 kill 로 끝나야 한다. 고치기 전에는 진행률이 계속
    // 살아 있어 Stalled(120s) 까지 매달렸다 — 사용자에게는 "취소가 안 먹는다" 였다.
    await expect(solving).rejects.toMatchObject({ code: 'DaemonExited' });
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});
