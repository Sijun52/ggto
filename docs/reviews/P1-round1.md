# P1 리뷰 — Round 1

리뷰어: ggto-architect. 날짜: 2026-09-11. 대상: `packages/server`, `packages/protocol`, `web`, 루트 스크립트, P0 이월 MINOR 1~6.
스펙: `docs/specs/P1.md` (본 라운드에서 R1 개정 — 아래 "스펙 개정" 절).

## VERDICT: CHANGES_REQUIRED

CRITICAL 0, MAJOR 2, MINOR 6. 반박 5건 중 4건 수용(1·2·4·5), 1건 반려(3). 알려진 한계 3건 전부 수용.
서버·프로토콜·grep 게이트·P0 이월분은 이상 없음. 두 MAJOR 는 모두 `web` 표시 계층이며 각각 한 줄 수정 + 테스트 한 개 규모다.

## 검증한 것 (실행 근거)

| 항목 | 방법 | 결과 |
|---|---|---|
| `npm run ci` | 루트에서 직접 실행, 로그 `scratchpad/ci-round1.log` | exit 0. core 125 / server 31 / web 24 통과. Vite 경고 0. bench 5/5 ok. smoke 8/8 |
| **fresh clone 재현** (반박 2) | 소스만 임시 디렉터리에 복사 (`node_modules`/`dist`/`package-lock.json` 제외) → `npm install` → `npm run ci` | install exit 0, ci exit 0 (core 125 / server 31 / web 24 / smoke 8/8). 실행 순서: `build:libs` → 4 워크스페이스 typecheck → test → build → bench → smoke |
| 반박 2 전제 확인 | 같은 디렉터리에서 `dist/` 전부 삭제 후 `npm run typecheck --workspaces` 직접 | server/web 에서 `TS2307 Cannot find module '@ggto/core'` 9건 → exit 1. 전제 사실 |
| `npm test` 단독 (dist 없음) | 같은 디렉터리 | core 통과, **server 4 파일 전부 "Failed to resolve entry for package @ggto/core"** → exit 1 (MINOR 3) |
| 반박 1 계산 | `scratchpad/p1/rebuttal1.mjs` (core dist 직접 import) | `22+`=78, `A2s+`=48, `KTo+`=36, 합 162. AKo(idx 13) 합 0 / fill 0. 활성 오프수트 클래스 = KQo, KJo, KTo. AKo 포함 시 174 |
| P0 MINOR 1/2/6 재현 | `scratchpad/p1/minor.mjs` | `stack 0.5, SB 0.5/BB 1` → `PreflopConfigError "posted blinds for SB (0.5) must be < stack (0.5)"` (빈 시퀀스·`[call]` 둘 다). `stack 1` → BB 로 거부. `stack 1.01`, `100` 통과. 이중 포스트 BB 1+1 / stack 2 거부. `stack MAX_AMOUNT` 통과, `+1` 거부. `AKs+`/`AKo+`/`AK+` 메시지에 런 예시 없음 (`list the class explicitly as "AKs"`), `T9s+`/`QJo+` 는 런 예시 있음 |
| P0 MINOR 3/4/5 | 파일 열어 확인 | `action.ts:57-64` JSDoc 근거 교체됨. `preflopState.ts:213-216` bet 분기 도달 불가 주석 있음. 루트 `ci` 스크립트 있음 |
| R1/R2 회귀 | `scratchpad/r2/connector.mjs`, `r2/tree.mjs`, `verify-r2.mjs`, `r2/verify1-patched.mjs`, `r2/verify2-patched.mjs`, `r2/bench-cmp.mjs` 전부 재실행 | 전부 exit 0. connector 36 거부 / 198 키커 런 일치 / bad 0. tree TOTAL BAD 0. VERIFY1/2 ALL OK |
| 실 HTTP 전 엔드포인트 | `npm start` 후 curl | health 200 / parse 200·400(`RangeSyntaxError` 메시지 connector) / JSON 아님 400 `BadRequest` / `GET /api/range/parse` 404 / `/api/nope` 404 / `PUT /api/health` 404 / `POST /foo` 404 JSON (notFound 핸들러 throw 경로) / 70KB 본문 413 (Content-Length 있을 때·chunked 둘 다) / equity exact `Kh7c2d` hero 0.08586, matchups 18 / seed 생략 시 응답에 seed / seed `-1`·`1.5`·`2^32` → 400, `2^32-1` → 200 / HEAD `/` 200 / 경로 탈출 5종 (`/../`, `/%2e%2e/`, `/assets/../../`, `/..%5c`, `/assets/..%2f..%2f`) 전부 index.html 폴백, 파일 유출 없음 / `/%zz` 200 index.html (500 아님) |
| 실 HTTP fuzz | `scratchpad/p1/http-fuzz.mjs` — 서버 테스트와 **다른** 생성기 (콤보 표기 `Qs7c`, 키커 구간 `AQs-A5s`, 가중치 `:0.01~0.99` 포함) 50개 | 50/50 `Float32Array.from(weights)` 가 로컬 `parseRange` 와 1326 원소 완전 동일, `comboCount`/`totalWeight`/`text` 일치 |
| **브라우저 실물** | headless Chrome 을 CDP 로 직접 조작 (`scratchpad/p1/cdp.mjs`, `browser-check.mjs`, `browser-check2.mjs`). 캔버스 픽셀을 `getImageData` 로 169 셀 × (상단 15% / 하단 85%) 샘플링해 `parseRange` 로 계산한 fill 과 대조 | `?range=QQ%3A0.5`: 요약 `combos: 6 / 1326  weight: 3`, QQ 하단 녹색·상단 회색, **나머지 168 셀 녹색 0**. 축 라벨 가로·세로 `AKQJT98765432`. `?range=22%2B%2CA2s%2B%2CKTo%2B`: 169 셀 픽셀 불일치 0, **AKo 픽셀 (30,41,59) = 비어 있음**, KQo (34,197,94) = 채움. 우상단 A2s(idx 12) 채움·좌하단 A2o(idx 156) 빔·우하단 22 채움 → 방향 정상. 툴팁 `AKo · 0.00 / 0`, `KTo · 12.00 / 12`. A5s 클릭 → 패널 `Ac5c 1.00 Ad5d 1.00 Ah5h 1.00 As5s 1.00` = `comboCards`+`formatCard` 직접 계산과 일치. `?range=T9s%2B`: 빨간 `RangeSyntaxError: connector ...`, 격자 없음, `no range to draw`. `AA` 성공 후 `AKx` 제출: 에러 표시 + 이전 요약/격자 유지. 이후 `AA` 재제출: 에러 사라짐. Enter 제출 동작 |
| 스크린샷 | `docs/reviews/assets/P1-r1-architect-*.png` 7장 | 개발 에이전트의 `P1-qq05.png` 와 동일 화면 확인 |
| **169 하드코딩 부재 실물 증명** | `/api` 가 없는 정적 서버(`scratchpad/p1/static-only.mjs`, 7899)로 `web/dist` 만 서빙하고 SPA 로드 | 격자 없음, `no range to draw`, 에러 `BadResponse: server sent non-JSON (404)`, DOM 에 핸드 이름 0개. 클라이언트에 격자 데이터가 없다 |
| grep 게이트 G1~G8 | 내 정규식으로 재실행 | G1 `core/internal` 0. G2 `web/src` 핸드 리터럴 0 (`DEFAULT_RANGE_TEXT` 1건만). G3 web→server 0. G4 server 의 react/DOM 0. G5 `any`/`@ts-ignore`/`@ts-expect-error`/`TODO`/`FIXME` 0 (core/server/protocol/web src+test). G6 빈 catch 0. G7 protocol import 0. G8 번들(`index-BksotA4B.js`, 258,545B): 연속 핸드 리터럴 `"AKs","AQs"` 패턴 0, `node:` import 0 (`node:n` 1건은 `nodeType...{node:n,offset}` 오탐 확인) |
| 의존성 (DoD 4) | `npm ls` | server: hono 4.13.7, @hono/node-server 2.1.1. web: vite 8.3.0, react/react-dom 19.3.0, tailwindcss 4.3.3, @tailwindcss/vite 4.3.3, @tanstack/react-query 5.102.8, zustand 5.0.15. 공통: typescript 7.0.2, vitest 5.0.0, jsdom 29.1.1. 1절 목록 밖 런타임 의존성 없음 |
| 번들 크기 (DoD 6) | `du` | `web/dist` 270,386B. JS 258,545B (gzip 80.91kB), CSS 11,442B |

## 반박 판정

### 반박 1 — 스펙 4.5 의 `AKo=1` 은 틀렸다 → **수용. 내 스펙 오류.**
P0.md 3.2 가 `KTo+` = KTo,KJo,KQo 로 못 박았고, P1.md 3.4 의 162 (= 78+48+36) 는 그 정의로만 성립한다. 같은 문서 4.5 가 AKo 를 요구한 것은 3.4 와 자기모순이었다. 위 표의 계산으로 확정: AKo fill 0, AKo 포함이면 174. **P1.md 4.5 를 `AKo=0, KQo=1, KTo=1` 로 정정했다.** 개발 에이전트의 테스트(`grid.test.ts:58-69`)가 이미 그 값이다.

### 반박 2 — `typecheck` 가 `build:libs` 를 선행 → **수용.**
fresh clone 에서 dist 없이 typecheck 가 TS2307 로 깨지는 것을 직접 재현했고, 수정된 순서로 `npm install && npm run ci` 가 exit 0 임을 확인했다. `paths` 매핑(타입은 src/런타임은 dist 불일치)과 project references(`--noEmit` 과 `-b` 충돌)를 피한 판단은 맞다. 다만 같은 문제가 `npm test` 단독 실행에도 있다 (MINOR 3). 스펙 1절 스크립트 표를 실제 순서로 갱신했다.

### 반박 3 — 툴팁 분모를 `activeCombos` 로 → **반려. MAJOR 2.**
스펙 4.2 가 "콤보 수" 를 `comboCount` (클래스 크기) 로 이름 붙였고 4.1 의 "콤보 수" 는 같은 용어다. 우연의 일치가 아니라 정의다. 실물로 반례를 찍었다: `?range=QsQh%3A0.5` → 툴팁 `QQ · 0.50 / 1`, 셀은 40행 중 2행만 녹색 (fill 0.083). 툴팁이 "절반" 이라고 읽히는 상태에서 셀은 8% 다. 분모가 `activeCombos` 면 비율이 정의상 항상 ≤ 1 이라 정보량이 없고, 셀의 유일한 시각 매핑(fill = weightSum / comboCount) 과 어긋난다. 스크린샷 `P1-r1-architect-QsQh05-tooltip.png`.

### 반박 4 — 첫 파싱 실패 시 `no range to draw` → **수용.** 스펙 4.1 에 명문화.
### 반박 5 — `API_ROUTES` 상수 → **수용.** 3.3 의 "상수 몇 개 허용" 범위. 스펙 3.3 에 추가.

### 알려진 한계 3건 → 전부 수용
- 본문 상한 비스트리밍: 127.0.0.1 바인드 + 64KB 라 P1 에서 문제없음. chunked 도 413 으로 끝나는 것을 확인. P2 에서 octet-stream 블롭 엔드포인트가 생길 때 재검토 (스펙 3.1 에 주석).
- 정적 서빙 무캐시: 요청당 `stat`+`readFile` 2회. 개인용 로컬 앱에서 측정 가능한 비용이 아니다. P2 이후 mtime 캐시는 선택.
- `seed` 를 `[0, 2^32-1]` 로 제한: `rng.ts:40` `splitmix32(Math.trunc(seed) | 0)` 확인. 응답 seed 가 그 범위 안에서 재현되므로 맞다. 스펙 3.3 에 명시.

## CRITICAL
없음.

## MAJOR (승인 전 수정 필요)

1. **[web/src/lib/defaults.ts:8-11] `?range=` 를 `URLSearchParams` 로 읽어 리터럴 `+` 가 공백이 된다 → 조용히 다른 레인지를 그린다.**
   실측: `http://localhost:7777/?range=22+,A2s+,KTo+` (주소창에 그대로 입력하는 형태) → 입력 상자 `"22 ,A2s ,KTo "`, 요약 `canonical: 22,A2s,KTo  combos: 22`, **에러 없음**. core 파서가 항목 뒤 공백을 허용하므로 `22+` 가 `22` 로 바뀌어 성공한다. 스펙 4.1 은 `decodeURIComponent` 를 지정했다 (`+` 를 보존한다). 이것은 "돌아가지만 틀린 것" 이다 — 사용자가 URL 에 레인지를 쓰는 유일한 경로에서 `+` 는 가장 흔한 문자다.
   고칠 것: `location.search` 에서 `range=` 값을 직접 잘라 `decodeURIComponent` (실패 시 `DEFAULT_RANGE_TEXT`). 테스트: `?range=22+` (인코딩 안 함) 로 마운트하면 첫 요청 본문이 `{"text":"22+"}` (스펙 4.5 에 추가했다). `%2B` 도 계속 동작해야 한다.

2. **[web/src/components/RangeGrid.tsx:128] 툴팁 분모가 `activeCombos`.** 반박 3 참조. `${label} · ${weightSum.toFixed(2)} / ${comboCount}` 로. `activeCombos < comboCount` 일 때만 ` · ${activeCombos} active` 를 덧붙이는 것은 허용 (스펙 4.1 갱신). `RangeGrid.test.tsx:210` 의 `'AA · 6.00 / 6'` 은 분모가 같아 구분을 못 하므로 `QsQh:0.5` (→ `QQ · 0.50 / 6`) 케이스를 추가하라.

## MINOR (다음 페이즈로 미뤄도 됨)

3. [루트 package.json] `test` 가 `build:libs` 를 보장하지 않는다. fresh clone 에서 `npm test` 단독 → server/web 4 파일 "Failed to resolve entry for package @ggto/core". `ci` 는 typecheck 가 먼저라 무사. `pretest` 또는 루트 `prepare`(= `build:libs`, `npm install` 시 자동) 중 하나. `dev:server`/`dev:web` 도 같은 전제.
4. [web/src/store/ui.ts] `rangeText` 와 `hoveredClass` 가 **쓰기 전용**이다. `RangeInput` 은 자체 `useState` 를 쓰고 store 의 `rangeText` 를 아무도 읽지 않는다. 스펙 4.4 의 의도는 입력 텍스트를 store 가 소유하는 것. `RangeInput` 을 store 로 제어하거나(권장), 안 쓸 거면 필드를 빼라. 죽은 상태를 남기지 않는다.
5. [web/src/components/RangeGrid.tsx:32] `devicePixelRatio` 를 렌더 시점에 한 번 읽는다. 브라우저 줌 변경 시 다시 그리지 않는다 (`matchMedia('(resolution: ...)')` 리스너). P2 뷰어에서.
6. [web/src/components/RangeGrid.tsx:124-126] 툴팁 `top = row*step - 26` 이 행 0 에서 음수 → 축 라벨 위로 겹친다 (스크린샷 `P1-r1-architect-default-AKo-hover.png`). 행 0~1 은 아래쪽에 띄워라. 외관.
7. [DESIGN.md 1~2절] 여전히 Axum/Rust/rust-embed 서술. Phase -1 리뷰가 "하이브리드로 1~2절 재작성" 을 요구했고 P1.md 가 "폐기됐다" 고만 적었다. **리뷰어(나)의 문서 부채** — 본 라운드에서 DESIGN.md 상단에 개정 공지를 넣었다. 전면 재작성은 P2 스펙과 함께.
8. [packages/server/src/http.ts:21-25] 본문을 전부 읽은 뒤 크기 검사 (한계 1). P2 에서 octet-stream 엔드포인트를 추가할 때 `content-length` 없는 요청은 스트림에서 끊어라.

## UNCERTAIN (개발 에이전트가 증명할 것)
없음. 반박 5건과 한계 3건 전부 직접 재현했다.

## 테스트 품질
- `packages/server/test/rangeParse.test.ts`: 50개 무작위 텍스트를 테스트 안의 독립 생성기로 만들어 로컬 `parseRange` 와 원소 비교. 4,000/4,001 경계, 거짓 `content-length` 케이스 포함. 동어반복 없음.
- `packages/server/test/rangeEquity.test.ts`: exact 결과를 core 직접 호출과 1e-9 비교, perCombo NaN→null 1326 전수, seed 생략 재현. 적절.
- `packages/server/test/static.test.ts`: 경로 탈출 `resolveWithin` 단위 + 디렉터리 요청 폴백. 적절.
- `web/test/grid.test.ts`: fill/activeCombos 를 `handClassCombos` 로 169 셀 전부 손 계산 대조. 스펙 요구 충족.
- `web/test/RangeGrid.test.tsx`: 스텁 컨텍스트의 호출 흔적으로 그리기 횟수 측정 — 자기 모듈 모킹 안 함. `fillRect === 169 + filled` 는 구현 세부(채움 사각형 1개/셀)에 묶여 있으나 P2 액션 스택에서 바뀔 것을 알고 있으면 됨.
- `web/test/RangePage.test.tsx`: 응답을 core 로 생성. 첫 실패 케이스 포함. 적절. 단 **URL `+` 리터럴 케이스가 없어 MAJOR 1 을 놓쳤다.**

## 스펙 개정 (P1.md R1)
- 1절 스크립트: `typecheck` = `build:libs` → 워크스페이스 typecheck (반박 2). `ci` 순서 설명 갱신.
- 3.1: 본문 상한 비스트리밍 허용 주석. 3.3: `API_ROUTES`, `seed` 정수 `[0, 2^32-1]`, `EquityMode` 타입.
- 4.1: URL 파싱은 `decodeURIComponent` — **`URLSearchParams` 금지** (`+` 보존) 명시. 툴팁 `weightSum / comboCount` 명시. 첫 실패 시 `no range to draw`.
- 4.5: `AKo=0, KQo=1, KTo=1` 정정 (반박 1). `?range=22+` 리터럴 테스트, `QsQh:0.5` 툴팁 테스트 추가.
- 개정 이력 절 신설.

## 다음 라운드
MAJOR 1·2 수정 + 해당 테스트 2개 추가 후 재제출. `npm run ci` 출력과 `?range=22+,A2s+,KTo+` (리터럴) 스크린샷 1장. MINOR 3~6·8 은 P2 전까지. 다른 파일은 건드리지 마라 — 서버·프로토콜·core 는 이번 라운드 그대로 통과다.
