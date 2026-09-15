/**
 * `web/test/fixtures/solve-node.json` 생성기 (P5.md 8.1 "집계 대조").
 *
 * 왜 픽스처인가: 웹은 `@ggto/solver` 를 import 할 수 없다 (node: 의존, P5.md 2절). 그래서
 * "서버의 169 집계" 와 "브라우저의 169 집계" 가 같은지 확인하려면 **서버가 만든 실제
 * 응답**을 파일로 넘겨야 한다. 이 스크립트가 그 파일을 만들고, 산출물은 커밋한다.
 *
 * 순열은 **3-cycle** 이다 (`[1,2,0,3]`: c→d→h→c, s 고정). involution (예 `[1,0,3,2]`) 은
 * 자기 자신이 역이라 "역순열을 순순열로 바꿔 쓴" 버그를 통과시킨다 (P4 R1 MAJOR 6).
 *
 * 실행: `node packages/solver/scripts/make-web-fixture.mjs`
 *
 * `buildFixtureDoc()` 를 따로 내보내는 이유: `test/webFixture.test.ts` 가 **다시 만들어**
 * 커밋된 파일과 대조한다. 그래야 `view.ts` 의 순열 방향을 바꾸는 뮤턴트(`inv = perm`)가
 * 픽스처를 낡게 만든 채 통과하지 못한다 — 웹 테스트만으로는 정적 파일을 볼 뿐이다.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { COMBO_COUNT, createRng } from '../../core/dist/index.js';
import { toNodeResponse } from '../dist/index.js';

const PERM = [1, 2, 0, 3];
const ACTIONS = ['X', 'B6.6', 'A'];

function b64(rows) {
  const flat = new Float32Array(rows.length * COMBO_COUNT);
  rows.forEach((r, i) => flat.set(r, i * COMBO_COUNT));
  return Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength).toString('base64');
}

/** 결정적 픽스처 — 같은 시드에서 항상 같은 바이트가 나온다. */
export function buildFixtureDoc() {
  const rng = createRng(0x5eed_1234);
  /** 도달 레인지: 약 1/4 은 0 (레인지 밖) — 분모 0 클래스의 집계 규칙도 검사된다. */
  const reachArray = () => {
    const r = new Float32Array(COMBO_COUNT);
    for (let c = 0; c < COMBO_COUNT; c++) r[c] = rng.nextFloat() < 0.25 ? 0 : rng.nextFloat();
    return r;
  };

  const reach = [reachArray(), reachArray()];
  const strategy = ACTIONS.map(() => new Float32Array(COMBO_COUNT));
  const ev = ACTIONS.map(() => new Float32Array(COMBO_COUNT));
  for (let c = 0; c < COMBO_COUNT; c++) {
    const w = ACTIONS.map(() => rng.nextFloat() + 1e-3);
    const sum = w.reduce((a, b) => a + b, 0);
    for (let a = 0; a < ACTIONS.length; a++) {
      strategy[a][c] = w[a] / sum;
      // EV 는 액션마다 다른 분포 — 집계가 행을 섞으면 값이 달라진다.
      ev[a][c] = (rng.nextFloat() - 0.3) * 10 + a;
    }
  }
  const equity = [new Float32Array(COMBO_COUNT), new Float32Array(COMBO_COUNT)];
  for (let c = 0; c < COMBO_COUNT; c++) {
    equity[0][c] = rng.nextFloat();
    equity[1][c] = 1 - equity[0][c];
  }

  /** 정규 보드 공간의 노드 (데몬이 주는 모양) */
  const canonicalNode = {
    street: 'turn',
    line: 'X-B6.6-C/Qc',
    board: '2c7cKdQc',
    player: 'oop',
    potChips: 2000,
    stacksChips: [8000, 8000],
    actions: ACTIONS,
    strategy,
    ev,
    reach,
    equity,
    evAvgBb: [12.84, 7.16],
    reachable: true,
    evBasis: 'stack_delta_from_node',
  };

  return {
    note:
      '생성: packages/solver/scripts/make-web-fixture.mjs. perm=[1,2,0,3] 은 3-cycle(c→d→h→c, s 고정)이다 ' +
      '— involution 은 자기 자신이 역이라 순열 방향이 뒤집힌 버그를 통과시킨다 (P4 R1 MAJOR 6).',
    perm: PERM,
    // 순열 **전** (정규 보드 공간) 값 — 응답이 어느 방향으로 돌아갔는지 대조한다.
    canonical: {
      board: canonicalNode.board,
      line: canonicalNode.line,
      strategy: b64(strategy),
      reach: [b64([reach[0]]), b64([reach[1]])],
    },
    response: toNodeResponse(canonicalNode, PERM),
  };
}

export const FIXTURE_PATH = fileURLToPath(new URL('../../../web/test/fixtures/solve-node.json', import.meta.url));

export function serializeFixture(doc) {
  return `${JSON.stringify(doc, null, 2)}
`;
}

// 스크립트로 직접 실행했을 때만 파일을 쓴다 (테스트가 import 할 때는 쓰지 않는다).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = serializeFixture(buildFixtureDoc());
  writeFileSync(FIXTURE_PATH, text);
  console.log(`wrote ${FIXTURE_PATH} (${String(text.length)} bytes)`);
}
