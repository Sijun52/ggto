import { comboCount, parseRange, totalWeight } from '@ggto/core';
import type { ErrorEnvelope, ParseRangeResponse } from '@ggto/protocol';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const app = createApp();

async function post(path: string, body: string, headers: Record<string, string> = {}) {
  return await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

const postJson = async (path: string, body: unknown) => await post(path, JSON.stringify(body));

async function parseOk(text: string): Promise<ParseRangeResponse> {
  const res = await postJson('/api/range/parse', { text });
  expect(res.status, `unexpected status for ${JSON.stringify(text)}`).toBe(200);
  return (await res.json()) as ParseRangeResponse;
}

async function parseErr(body: unknown): Promise<{ status: number; envelope: ErrorEnvelope }> {
  const res = await postJson('/api/range/parse', body);
  return { status: res.status, envelope: (await res.json()) as ErrorEnvelope };
}

describe('3.4 POST /api/range/parse', () => {
  it('3.4 parse "22+,A2s+,KTo+" → 162 콤보 / 1326 가중치 / 정규형 에코', async () => {
    const body = await parseOk('22+,A2s+,KTo+');
    expect(body.weights.length).toBe(1326);
    // 78(pairs 13x6) + 48(A2s..AKs 12x4) + 36(KTo..KQo 3x12) = 162, P0.md 4.3
    expect(body.comboCount).toBe(162);
    expect(body.totalWeight).toBe(162);
    expect(body.text).toBe('22+,A2s+,KTo+');
  });

  it('3.4 weights 를 Float32Array.from 하면 parseRange 와 원소 단위로 완전히 같다', async () => {
    const body = await parseOk('22+,A2s+,KTo+');
    const wire = Float32Array.from(body.weights);
    const local = parseRange('22+,A2s+,KTo+');
    expect(wire.length).toBe(local.length);
    for (let i = 0; i < local.length; i++) {
      expect(wire[i], `combo ${String(i)}`).toBe(local[i]);
    }
  });

  it('3.4 가중치 텍스트 "QQ:0.5" → 6개 원소가 0.5', async () => {
    const body = await parseOk('QQ:0.5');
    expect(body.text).toBe('QQ:0.5');
    const half = body.weights.filter((w) => w === 0.5);
    expect(half.length).toBe(6);
    expect(body.comboCount).toBe(6);
    expect(body.totalWeight).toBeCloseTo(3, 6);
    // f32 왕복 항등: 0.5 는 정확하지만 0.3 같은 값도 문자열 왕복 후 같은 f32 여야 한다
    const third = await parseOk('QQ:0.3');
    const local = parseRange('QQ:0.3');
    expect(Float32Array.from(third.weights)).toEqual(local);
  });

  it('3.4 빈 문자열 → 200, comboCount 0, text ""', async () => {
    const body = await parseOk('');
    expect(body.comboCount).toBe(0);
    expect(body.totalWeight).toBe(0);
    expect(body.text).toBe('');
    expect(body.weights.length).toBe(1326);
    expect(body.weights.every((w) => w === 0)).toBe(true);
  });

  it('3.4 무작위 텍스트 50개에서 서버 응답 = 로컬 parseRange (서버가 인자를 바꾸지 않는다)', async () => {
    const ranks = 'AKQJT98765432';
    const texts: string[] = [];
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    while (texts.length < 50) {
      const items: string[] = [];
      for (let k = 0; k <= rnd(3); k++) {
        const a = rnd(13);
        const b = rnd(13);
        const hi = Math.min(a, b);
        const lo = Math.max(a, b);
        const r1 = ranks[hi] as string;
        const r2 = ranks[lo] as string;
        // 커넥터 "+" 는 P0 에서 거부되므로 갭 2 이상일 때만 "+" 를 붙인다
        const sfx = hi === lo ? '' : ((rnd(2) === 0 ? 's' : 'o') as string);
        const plus = hi !== lo && lo - hi >= 2 && rnd(2) === 0 ? '+' : '';
        const w = rnd(4) === 0 ? `:0.${String(1 + rnd(9))}` : '';
        items.push(`${r1}${r2}${sfx}${plus}${w}`);
      }
      texts.push(items.join(','));
    }
    for (const t of texts) {
      const local = parseRange(t);
      const body = await parseOk(t);
      expect(Float32Array.from(body.weights), t).toEqual(local);
      expect(body.comboCount, t).toBe(comboCount(local));
      expect(body.totalWeight, t).toBeCloseTo(totalWeight(local), 5);
    }
  });

  it('3.4 "T9s+" → 400 RangeSyntaxError, 메시지에 connector', async () => {
    const { status, envelope } = await parseErr({ text: 'T9s+' });
    expect(status).toBe(400);
    expect(envelope.error.code).toBe('RangeSyntaxError');
    expect(envelope.error.message).toContain('connector');
  });

  it('3.4 "AKx" → 400 RangeSyntaxError', async () => {
    const { status, envelope } = await parseErr({ text: 'AKx' });
    expect(status).toBe(400);
    expect(envelope.error.code).toBe('RangeSyntaxError');
  });

  it('3.4 형식 오류 → 400 BadRequest', async () => {
    expect(await parseErr({})).toMatchObject({ status: 400, envelope: { error: { code: 'BadRequest' } } });
    expect(await parseErr({ text: 5 })).toMatchObject({ status: 400, envelope: { error: { code: 'BadRequest' } } });
    expect(await parseErr(['AA'])).toMatchObject({ status: 400, envelope: { error: { code: 'BadRequest' } } });

    const notJson = await post('/api/range/parse', 'this is not json');
    expect(notJson.status).toBe(400);
    expect(((await notJson.json()) as ErrorEnvelope).error.code).toBe('BadRequest');

    const tooLong = await parseErr({ text: 'AA,'.repeat(1334) }); // 4002 chars
    expect(tooLong.status).toBe(400);
    expect(tooLong.envelope.error.code).toBe('BadRequest');
  });

  it('3.4 4,000자는 통과하고 4,001자는 400 BadRequest', async () => {
    const ok = `AA:0.55${',AA'.repeat(1331)}`;
    expect(ok.length).toBe(4000);
    const okRes = await postJson('/api/range/parse', { text: ok });
    expect(okRes.status).toBe(200);

    const tooLong = `${ok}x`;
    expect(tooLong.length).toBe(4001);
    const res = await parseErr({ text: tooLong });
    expect(res.status).toBe(400);
    expect(res.envelope.error.code).toBe('BadRequest');
  });

  it('3.4 70KB 본문 → 413 PayloadTooLarge', async () => {
    const body = JSON.stringify({ text: 'A'.repeat(70 * 1024) });
    expect(body.length).toBeGreaterThan(65536);
    const res = await post('/api/range/parse', body);
    expect(res.status).toBe(413);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe('PayloadTooLarge');
  });

  it('3.4 content-length 헤더가 거짓말이어도 실제 바이트로 413', async () => {
    const body = JSON.stringify({ text: 'A'.repeat(70 * 1024) });
    const res = await post('/api/range/parse', body, { 'content-length': '10' });
    expect(res.status).toBe(413);
  });
});
