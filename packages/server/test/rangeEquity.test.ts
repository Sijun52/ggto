import { equityRangeVsRange, parseCards, parseRange, removeBoard } from '@ggto/core';
import type { EquityRequest, EquityResponse, ErrorEnvelope } from '@ggto/protocol';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const app = createApp();

async function equity(body: unknown): Promise<{ status: number; raw: string }> {
  const res = await app.request('/api/range/equity', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, raw: await res.text() };
}

async function equityOk(body: EquityRequest): Promise<EquityResponse> {
  const { status, raw } = await equity(body);
  expect(status, raw.slice(0, 300)).toBe(200);
  return JSON.parse(raw) as EquityResponse;
}

async function equityErr(body: unknown): Promise<{ status: number; code: string }> {
  const { status, raw } = await equity(body);
  return { status, code: (JSON.parse(raw) as ErrorEnvelope).error.code };
}

describe('3.4 POST /api/range/equity', () => {
  it('3.4 AA vs KK 프리플랍 MC → hero ≈ 0.81946 (P0.md 4.5), 합 = 1', async () => {
    const body = await equityOk({
      hero: 'AA',
      villain: 'KK',
      board: '',
      mode: 'monte-carlo',
      samples: 200000,
      seed: 1,
    });
    // 포커 이론상 알려진 값: AA vs KK 프리플랍 에퀴티 81.9%
    expect(body.hero).toBeGreaterThan(0.81446);
    expect(body.hero).toBeLessThan(0.82446);
    expect(body.hero + body.villain).toBeCloseTo(1, 6);
    expect(body.heroWin + body.villainWin + body.tie).toBeCloseTo(1, 6);
    expect(body.seed).toBe(1);
    expect(body.samples).toBe(200000);
    expect(body.mode).toBe('monte-carlo');
    expect(body.board).toBe('');
  });

  it('3.4 같은 시드의 같은 요청 두 번 → 바이트 동일 응답', async () => {
    const req: EquityRequest = {
      hero: 'AA',
      villain: 'KK',
      board: '',
      mode: 'monte-carlo',
      samples: 50000,
      seed: 1,
    };
    const a = await equity(req);
    const b = await equity(req);
    expect(a.raw).toBe(b.raw);
  });

  it('3.4 시드를 생략하면 서버가 정한 시드를 응답에 돌려주고 그 시드로 재현된다', async () => {
    const req: EquityRequest = {
      hero: 'AA',
      villain: 'KK',
      board: '',
      mode: 'monte-carlo',
      samples: 20000,
    };
    const first = await equityOk(req);
    expect(first.seed).not.toBeNull();
    const replay = await equityOk({ ...req, seed: first.seed as number });
    expect(replay.hero).toBe(first.hero);
    expect(replay.villain).toBe(first.villain);
  });

  it('3.4 exact 플랍 → core 직접 호출과 1e-9 이내 (서버가 인자를 바꾸지 않았다)', async () => {
    const req: EquityRequest = { hero: 'AA', villain: 'KK', board: 'Kh7c2d', mode: 'exact' };
    const body = await equityOk(req);

    const board = parseCards('Kh7c2d');
    const hero = removeBoard(parseRange('AA'), board);
    const villain = removeBoard(parseRange('KK'), board);
    const direct = equityRangeVsRange(hero, villain, board, { mode: 'exact' });

    expect(Math.abs(body.hero - direct.hero)).toBeLessThan(1e-9);
    expect(Math.abs(body.villain - direct.villain)).toBeLessThan(1e-9);
    expect(body.matchups).toBe(direct.matchups);
    expect(body.samples).toBeNull();
    expect(body.seed).toBeNull();
    expect(body.board).toBe('Kh7c2d');
    // K 가 보드에 하나 빠졌으므로 KK 는 3콤보만 남는다 (빌런이 셋을 맞은 상태)
    expect(body.matchups).toBe(6 * 3);
  });

  it('3.4 perCombo 는 레인지 밖이면 null, 안이면 number', async () => {
    const body = await equityOk({ hero: 'AA', villain: 'KK', board: 'Kh7c2d', mode: 'exact' });
    expect(body.heroPerCombo.length).toBe(1326);
    expect(body.villainPerCombo.length).toBe(1326);

    const board = parseCards('Kh7c2d');
    const hero = removeBoard(parseRange('AA'), board);
    const direct = equityRangeVsRange(hero, removeBoard(parseRange('KK'), board), board, {
      mode: 'exact',
    });
    let inRange = 0;
    for (let i = 0; i < 1326; i++) {
      const expected = direct.heroPerCombo[i] as number;
      if (Number.isNaN(expected)) {
        expect(body.heroPerCombo[i], `combo ${String(i)}`).toBeNull();
      } else {
        inRange++;
        expect(Math.abs((body.heroPerCombo[i] as number) - expected), `combo ${String(i)}`).toBeLessThan(1e-9);
      }
    }
    expect(inRange).toBe(6); // AA 6콤보
  });

  it('3.4 exact + 보드 1장 → 400 UnsupportedError', async () => {
    expect(await equityErr({ hero: 'AA', villain: 'KK', board: 'Kh', mode: 'exact' })).toEqual({
      status: 400,
      code: 'UnsupportedError',
    });
    expect(await equityErr({ hero: 'AA', villain: 'KK', board: '', mode: 'exact' })).toEqual({
      status: 400,
      code: 'UnsupportedError',
    });
  });

  it('3.4 보드 카드 중복 → 400 CardSyntaxError', async () => {
    expect(await equityErr({ hero: 'AA', villain: 'KK', board: 'KhKh', mode: 'exact' })).toEqual({
      status: 400,
      code: 'CardSyntaxError',
    });
  });

  it('3.4 보드가 히어로 레인지를 전부 지우면 400 EmptyRangeError', async () => {
    expect(
      await equityErr({ hero: 'AsKs', villain: 'KK', board: 'As7c2d', mode: 'exact' }),
    ).toEqual({ status: 400, code: 'EmptyRangeError' });
  });

  it('3.4 samples 상한 초과 / 잘못된 mode / 필드 누락 → 400 BadRequest', async () => {
    expect(
      await equityErr({ hero: 'AA', villain: 'KK', board: '', mode: 'monte-carlo', samples: 2000000 }),
    ).toEqual({ status: 400, code: 'BadRequest' });
    expect(
      await equityErr({ hero: 'AA', villain: 'KK', board: '', mode: 'monte-carlo', samples: 0 }),
    ).toEqual({ status: 400, code: 'BadRequest' });
    expect(
      await equityErr({ hero: 'AA', villain: 'KK', board: '', mode: 'monte-carlo', samples: 1.5 }),
    ).toEqual({ status: 400, code: 'BadRequest' });
    expect(await equityErr({ hero: 'AA', villain: 'KK', board: '', mode: 'bogus' })).toEqual({
      status: 400,
      code: 'BadRequest',
    });
    expect(await equityErr({ hero: 'AA', board: '', mode: 'exact' })).toEqual({
      status: 400,
      code: 'BadRequest',
    });
    // 상한 그 자체(1,000,000)는 형식 검증을 통과해야 한다 (거부는 상한 "초과" 부터)
    expect(
      await equityErr({ hero: 'AA', villain: 'KK', board: '', mode: 'monte-carlo', samples: 1000001 }),
    ).toEqual({ status: 400, code: 'BadRequest' });
  });

  it('3.4 히어로 레인지 문법 오류 → 400 RangeSyntaxError', async () => {
    expect(await equityErr({ hero: 'T9s+', villain: 'KK', board: '', mode: 'monte-carlo' })).toEqual({
      status: 400,
      code: 'RangeSyntaxError',
    });
  });
});
