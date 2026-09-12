/**
 * /api/range/*. P1.md 3.2.
 *
 * 핸들러는 검증(형식) → core 호출 → 직렬화만 한다. 도메인 판단은 전부 core 가 하고
 * 던지는 에러는 그대로 흘려보낸다 (app.ts 의 onError 가 봉투로 만든다).
 */

import {
  comboCount,
  equityRangeVsRange,
  formatCards,
  formatRange,
  parseCards,
  parseRange,
  removeBoard,
  totalWeight,
  type RangeEquityOptions,
} from '@ggto/core';
import { API_LIMITS, type EquityResponse, type ParseRangeResponse } from '@ggto/protocol';
import { Hono } from 'hono';
import { badRequest } from '../errors.js';
import { optionalInt, readJsonBody, requireString } from '../http.js';

/** NaN 은 JSON 에 없다 (JSON.stringify(NaN) === "null" 이지만 타입으로 명시한다). */
function perComboToJson(xs: Float32Array): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(xs.length);
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i] as number;
    out[i] = Number.isNaN(v) ? null : v;
  }
  return out;
}

export function rangeRoutes(): Hono {
  const app = new Hono();

  app.post('/range/parse', async (c) => {
    const body = await readJsonBody(c);
    const text = requireString(body, 'text', API_LIMITS.rangeTextChars);
    const range = parseRange(text);
    const res: ParseRangeResponse = {
      text: formatRange(range),
      comboCount: comboCount(range),
      totalWeight: totalWeight(range),
      // Array.from(Float32Array) 는 각 f32 를 정확한 f64 로 넓힌다 → JSON 왕복이 항등.
      weights: Array.from(range),
    };
    return c.json(res);
  });

  app.post('/range/equity', async (c) => {
    const body = await readJsonBody(c);
    const heroText = requireString(body, 'hero', API_LIMITS.rangeTextChars);
    const villainText = requireString(body, 'villain', API_LIMITS.rangeTextChars);
    // 보드 길이 판정은 core 에 맡긴다 (6장 이상은 CardSyntaxError "board must be 0..5 cards").
    // 여기 상한은 파서에 긴 쓰레기를 넘기지 않기 위한 것일 뿐이다.
    const boardText = requireString(body, 'board', 64);
    const mode = body['mode'];
    if (mode !== 'exact' && mode !== 'monte-carlo') {
      throw badRequest('field "mode" must be "exact" or "monte-carlo"');
    }
    const samples = optionalInt(body, 'samples', 1, API_LIMITS.maxSamples);
    // 시드는 부호 없는 32비트로 제한한다 (core 의 createRng 가 쓰는 폭).
    const seed = optionalInt(body, 'seed', 0, 0xffffffff);

    const board = parseCards(boardText);
    const hero = removeBoard(parseRange(heroText), board);
    const villain = removeBoard(parseRange(villainText), board);

    let opts: RangeEquityOptions;
    let usedSamples: number | null;
    let usedSeed: number | null;
    if (mode === 'exact') {
      opts = { mode };
      usedSamples = null;
      usedSeed = null;
    } else {
      usedSamples = samples ?? 200_000;
      // 시드를 생략하면 서버가 정하고 응답에 돌려준다 — 같은 수치를 다시 뽑을 수 있어야 한다.
      usedSeed = seed ?? Date.now() % 0x100000000;
      opts = { mode, samples: usedSamples, seed: usedSeed };
    }

    const r = equityRangeVsRange(hero, villain, board, opts);
    const res: EquityResponse = {
      hero: r.hero,
      villain: r.villain,
      tie: r.tie,
      heroWin: r.heroWin,
      villainWin: r.villainWin,
      matchups: r.matchups,
      heroPerCombo: perComboToJson(r.heroPerCombo),
      villainPerCombo: perComboToJson(r.villainPerCombo),
      mode,
      samples: usedSamples,
      seed: usedSeed,
      board: formatCards(board),
    };
    return c.json(res);
  });

  return app;
}
