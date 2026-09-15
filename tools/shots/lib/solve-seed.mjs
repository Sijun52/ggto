/**
 * `check:mobile` / `check:desktop` 이 쓸 **실제 솔브**를 하나 만든다 (P5.md 8.3).
 *
 * 가짜 솔버로 대체하지 않는다 (D24): 솔버가 없는 PC 에서는 `null` 을 돌려주고 호출부가
 * `SKIP solve pages (no solver binary)` 한 줄을 찍고 넘어간다. 가짜 전략으로 레이아웃을
 * 검사하면 "격자가 그려진다" 는 사실만 남고 그 격자가 무엇인지는 아무도 모른다.
 *
 * 솔버가 있는지는 **서버에게 묻는다** — `/api/solves` 가 503 이면 없는 것이다 (D24 의 계약
 * 그대로). 환경변수를 다시 해석하면 서버와 판정이 갈라질 수 있다.
 */

/** 작은 턴 스팟. 레인지가 좁아 100 iter 가 몇 초다 (플랍은 GB 단위라 게이트용으로 못 쓴다). */
export const SEED_SPOT = {
  board: 'Ks7h2hQc',
  oop: 'AA-TT,AKs',
  ip: 'QQ-99,AQs,AJs',
  potBb: 20,
  stackBb: 80,
  sizings: 'simple',
  targetExploitabilityPct: 0.5,
  maxIterations: 100,
};

async function json(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} 이 JSON 이 아니다 (${String(res.status)}): ${text.slice(0, 200)}`);
  }
  return { status: res.status, body };
}

/**
 * 솔브 하나를 확보한다.
 * @returns {Promise<{hash: string, spot: typeof SEED_SPOT} | null>} 솔버가 없으면 null
 */
export async function ensureSolve(baseUrl) {
  const list = await json(`${baseUrl}/api/solves`);
  if (list.status === 503) return null;
  if (list.status !== 200) throw new Error(`GET /api/solves ${String(list.status)}`);

  const started = Date.now();
  const post = await json(`${baseUrl}/api/solve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...SEED_SPOT, confirm: true }),
  });
  if (post.status !== 200) {
    throw new Error(`POST /api/solve ${String(post.status)}: ${JSON.stringify(post.body).slice(0, 300)}`);
  }
  const hash = post.body.hash;
  if (post.body.cached === true) return { hash, spot: SEED_SPOT };

  // 잡이 끝날 때까지 목록을 폴링한다 (SSE 는 이 스크립트에 필요 없다 — 진행률을 안 쓴다).
  for (;;) {
    const now = await json(`${baseUrl}/api/solves`);
    if (now.status === 200 && now.body.solves.some((r) => r.hash === hash)) return { hash, spot: SEED_SPOT };
    if (Date.now() - started > 180_000) throw new Error(`솔브가 180초 안에 끝나지 않았다 (${hash})`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
