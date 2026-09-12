# P1 리뷰 — Round 2

리뷰어: ggto-architect. 날짜: 2026-09-11. 대상: R1 MAJOR 1·2 + MINOR 3~6 수정분 (`web/src`, 루트 `package.json`, `web/test`).
스펙: `docs/specs/P1.md` (본 라운드에서 R2 개정 — 문서 끝 개정 이력).

## VERDICT: APPROVED

CRITICAL 0, MAJOR 0, MINOR 5 (전부 P2 로 이월 가능). 벤치 2배 저하는 **머신 부하로 확정** (아래 5절). 설계 변경 4건 전부 수용, 자인 한계 2건 전부 수용.

## 검증한 것 (실행 근거)

| 항목 | 방법 | 결과 |
|---|---|---|
| `npm run ci` | 루트에서 직접 실행, 로그 `scratchpad/ci-r2-architect.log` | exit 0. core 125 / server 31 / **web 41** / Vite 경고 0 / bench 5/5 / smoke 8/8 |
| **fresh clone** | 소스만 복사(`node_modules`/`dist`/lock 제외) → `npm install` → `npm test` → `dist` 3개 삭제 → `npm test` → `dist` 삭제 → `npm run typecheck` (`scratchpad/fresh-r2/summary.txt`) | install exit 0 (`prepare` 가 core/protocol dist 생성 확인), test exit 0, **dist 삭제 후 test exit 0** (`pretest`), typecheck exit 0. 125/31/41 두 번 모두 통과. MINOR 3 종결 |
| core/server/protocol 불변 | 파일 mtime 전수 (`ls --time-style=full-iso`) | `packages/core/src/**` 최신 11:08:46, `packages/server/src/**` 11:15:01, `packages/protocol/src` 11:12:14 — 전부 R1 ci(11:33) 이전. 이번 라운드 변경은 `web/src/{lib/defaults.ts, lib/grid.ts, components/RangeGrid.tsx, components/RangeInput.tsx, pages/RangePage.tsx}`, `web/test/*`, 루트 `package.json` 뿐 |
| **브라우저 실물 — URL 20종** | headless Chrome CDP (`scratchpad/p1/r2-browser.mjs`, 결과 `r2-browser.out.json`) 로 `npm start` 서버(7777)에 접속, 입력 상자·요약·에러·자리표시자·`location` 을 읽음 | 아래 1절 표 |
| **브라우저 실물 — 픽셀** | 캔버스 `getImageData` 169 셀 × (상단 15%/하단 85%) 를 `parseRange` fill 과 대조 | 리터럴 `+` URL: 불일치 0, AKo (30,41,59) 빔, KQo (34,197,94) 채움, A2s 채움, A2o 빔. **인코딩 URL 과 리터럴 URL 의 169×6 픽셀 샘플이 바이트 동일** |
| **MAJOR 2 실물** | `?range=QsQh%3A0.5` 에서 QQ 호버, 셀 중앙 열을 40행/120행 샘플링 | 툴팁 `QQ · 0.50 / 6`, 상태줄 `hover: QQ · 0.50 / 6`, 녹색 2/40 (120 샘플 6/120 = 0.05; 기대 fill 0.0833 에서 하단 1px 테두리 stroke 가 fill 위에 그려져 ~1px 를 덮음 — R1 과 같은 값). `QQ:0.5` → `QQ · 3.00 / 6`, 17/40 (라벨 텍스트 2행 제외 ≈ 19). 다른 168 셀 녹색 0. 스크린샷 `P1-r2-architect-QsQh05-tooltip.png` |
| 툴팁 = 상태줄 | AA/AKs/AKo/KTo/72o/A2s 6셀 호버 | 6/6 텍스트 동일 (`hover: ` 접두만 다름). mouseleave 후 `hover: —` |
| **툴팁 기하** | 9셀(4모서리·행1 양끝·QQ·A3s·32o)에서 `getBoundingClientRect` 로 열 라벨 밴드·격자 행/열 겹침 계산 | 열 라벨 겹침 **0/9** (MINOR 6 종결). 행 0·1 툴팁은 행 1·2 를 덮고, 행 ≥2 툴팁은 행-1 을 덮는다 (기존 동작). 우측 끝 열은 `size-120` 클램프로 격자 밖 넘침 없음. 스크린샷 `P1-r2-architect-AKo-tooltip-covers-row2.png` |
| **DPR (MINOR 5) 실브라우저** | `scratchpad/p1/r2-dpr.mjs` — CDP `Emulation.setDeviceMetricsOverride` 로 deviceScaleFactor 를 2→1.5→1→1.25→3→1.1→0.9→2→1, 급변(2→1.5 프레임 없이 연속) 순으로 바꾸며 `canvas.width`, `setTransform` 호출 수(프로토타입 패치), 픽셀 정합, 공백 여부를 측정. 훅과 **같은 원리의 독립 리스너**(내가 페이지에 주입)를 대조군으로 둠 | 프레임이 강제될 때(`Page.captureScreenshot`) **11회 변경 모두 11회 발화·11회 재그리기, `canvas.width == round(520×dpr)` 11/11, 픽셀 불일치 0, 공백 0**. 소수 dpr(1.100000023841858, 0.8999999761581421)에서도 `(resolution: <dpr>dppx)` 자기 질의가 match 하고 다음 변경에 발화. 단 rAF 만으로는 headless 에서 MQL change 가 dispatch 되지 않았고 대조군 리스너도 똑같이 침묵 → **에뮬레이션 환경의 프레임 스케줄링 아티팩트**이지 훅 결함이 아님 (아래 3절). 스크린샷 `P1-r2-architect-dpr2.png` (dpr 2, 1040×1040 캔버스) |
| store 제어 입력 | `?range=AA` 로드 → 값 주입 → `requestSubmit()` | 요약 `canonical: KK:0.25 combos: 6 weight: 1.50`, 입력 상자 유지 |
| R1/R2/P0 회귀 | `scratchpad` 의 `r2/connector.mjs`, `r2/tree.mjs`, `verify-r2.mjs`, `r2/verify1-patched.mjs`, `r2/verify2-patched.mjs`, `p1/rebuttal1.mjs`, `p1/minor.mjs`, `p1/http-fuzz.mjs`(실 서버 50개) 전부 재실행 | 전부 exit 0. TOTAL BAD 0 / VERIFY1·2 ALL OK / fuzz mism 0 |
| grep 게이트 G1~G8 | 내 정규식 재실행 | G1 0 / G2 `DEFAULT_RANGE_TEXT` 1건만 / G3 0 / G4 0 / G5 0 / G6 0 / G7 0 / G8 번들(`index-ImPzr4kB.js` 259,396B) 핸드 리터럴 연속 패턴 0, `node:` 0 (`node:n` 오탐 1건 동일), **`URLSearchParams` 0** |
| **벤치** | 5절 참조 | 회귀 아님 |
| 새 테스트 17개 | 4 파일 전부 읽음 (41 = 9+12+7+13) | 6절 |

## 1. MAJOR 1 — URL 리터럴 `+` (수정 확인, 엣지 포함)

`web/src/lib/defaults.ts:17-33` 실물 (요약/입력 상자 값은 브라우저에서 읽은 것):

| URL | 입력 상자 | 요약 / 결과 | 판정 |
|---|---|---|---|
| `?range=22+,A2s+,KTo+` (리터럴) | `22+,A2s+,KTo+` | combos **162**, AKo 빔, KQo 참 | 수정됨 |
| `?range=22%2B,A2s%2B,KTo%2B` / 전부 인코딩 | 동일 | 162, 픽셀 바이트 동일 | OK |
| `?range=22%20,A2s` (진짜 공백) | `22 ,A2s` | `canonical: 22,A2s combos: 10` — core 가 항목 뒤 공백 허용, 에러 없음 | 의도된 공백은 보존되고 망가지지 않음 |
| 주소창에 `22 ,A2s` 직접 | Chrome 이 `%20` 으로 인코딩 → 위와 동일 | | OK |
| `?xrange=AA&range=QQ` | `QQ` | combos 6 | `range` 만 읽음 |
| `?range=AA&range=KK` | `AA` | **첫 번째** 가 이김 (`URLSearchParams.get` 관례와 동일) | 동작은 결정적이나 스펙에 없음 → MINOR 1, 스펙 4.1 에 명시했다 |
| `?range=%zz` | 기본값 | 162, 에러 없음 | URIError → 기본값 |
| `?range=AA#foo`, `?range=AA#x&range=KK` | `AA` | `location.search` 에 해시가 안 들어옴 | OK |
| `#range=KK` (해시만) | 기본값 | 162 | 해시는 읽지 않음 (스펙대로) |
| `?range==AA` | `=AA` | 빨간 `RangeSyntaxError: bad rank "="`, `no range to draw` | 조용히 삼키지 않음 |
| `?range=` | `` | `combos: 0` (P0 규약: 빈 문자열 = 빈 레인지) | OK |
| `?range=AA&`, `?&range=AA`, `?range`(플래그), `?RANGE=AA` | AA / AA / 기본 / 기본 | | 대소문자 구분은 관례대로 |
| `?range=QsQh:0.5` (리터럴 콜론), `?range=AA;KK`, `?range=%E2%99%A0` | 그대로 / 에러 / 에러(`♠`) | 다국어 디코드 정상, 파서 에러는 화면에 뜸 | OK |

`web/test/RangePage.test.tsx` 의 리터럴 `+` 3케이스가 첫 요청 본문 `{"text":"22+,A2s+,KTo+"}` 을 고정한다. 번들에 `URLSearchParams` 문자열 0.

## 2. MAJOR 2 — 툴팁 분모

`formatCellSummary` 하나가 툴팁(`RangeGrid.tsx:131`)과 상태줄(`RangePage.tsx:92`) 양쪽에 쓰인다. `QsQh:0.5` 에서 툴팁 `0.50 / 6`, 셀 fill 0.5/6 (녹색 ~3px), 상태줄 동일 — 세 곳이 같은 말을 한다. `grid.test.ts` 에 분모 6 / `activeCombos 1` 대비 케이스, `RangeGrid.test.tsx` 에 `QQ · 0.50 / 6` 케이스 있음. 종결.

## 3. 개발 에이전트 자인 한계 2건 → 전부 수용

1. **`useDevicePixelRatio` 실브라우저 미검증** → 내가 검증했다. 결과는 위 표. 요점: (a) `(resolution: <dpr>dppx)` 를 현재 dpr 로 고정 구독하고 깨질 때 재구독하는 방식이 11회 연속 변경(정수·소수·급변)에서 전부 발화·재그리기했다. (b) `canvas.width` 속성 변경이 캔버스를 지우는데 `dpr` 이 draw effect 의존성에 들어 있어 공백 프레임이 남지 않는다. (c) 유일한 caveat: headless Chrome + CDP 에뮬레이션에서는 MQL `change` 가 실제 컴포지터 프레임에서만 dispatch 되어 rAF 만으로는 안 왔다. **내가 주입한 독립 리스너도 똑같이 침묵**했으므로 훅의 문제가 아니다. 실제 브라우저의 Ctrl+휠 줌은 항상 프레임을 만든다. 죽은 코드가 아니다.
2. **툴팁이 행 0·1 에서 아래 행을 가림** → 수용. 측정 결과 행 ≥2 툴팁도 항상 위 행 1개를 가린다 (기존 동작). 즉 "이웃 행 1개를 가린다" 는 성질은 전 행 동일하고, 방향만 다르다. 새로운 종류의 가림이 아니다. 열 라벨 겹침은 0 이 됐다. 게다가 상태줄이 같은 텍스트를 항상 보여주므로 툴팁이 가린 셀로 마우스를 옮기면 그 셀 정보가 나온다. 허용.

## 4. 설계 변경 4건 → 전부 수용 (스펙 R2 로 갱신)

1. `hover-readout` 상태줄: 스펙 4.1 스케치에 없었다. 개선이다 — MINOR 4 의 "store 의 `hoveredClass` 를 누군가 읽어야 한다" 를 실제 UI 로 해결했고, 툴팁이 가린 셀 문제(3-2)도 완화한다. 4.1 에 추가.
2. `RangeInputProps.initialText` 제거, store 직접 구독: MINOR 4 가 권장한 방식 그대로. `RangePage` 가 `useLayoutEffect` 로 URL 값을 store 에 1회 주입 (첫 페인트 전). 4.4 에 명시.
3. `formatCellSummary` 를 `lib/grid.ts` 에: 순수 표시 포매터이고 `CellModel` 과 같은 파일에 있는 것이 맞다. 4.2 export 목록에 추가.
4. `prepare` + `pretest` 둘 다: 서로 다른 시나리오를 덮는다 (`prepare` = 설치 직후 dist 없음, `pretest` = src 수정 후 dist stale). 수용. 부작용: `ci` 가 core 를 4번 빌드한다 (`typecheck`→`build:libs`, `pretest`→`build:libs`, `build`, `bench` 안의 `npm run build`). 각 3초, 무해. MINOR 4.

## 5. 벤치 2배 저하 → 머신 부하. 회귀 아님.

근거 (전부 직접 측정):
- **core 소스가 R1 이후 안 바뀌었다** (mtime 전수, 최신 11:08:46 < R1 ci 11:33).
- **머신 상태**: 리뷰 시점 `Win32_Processor.LoadPercentage` 93%. 실행 중 프로세스: `League of Legends`(CPU 1521s, **시작 11:47:58**), `LeagueClient`(11:32:28), `LeagueClientUxRender`, `Riot Client`(1500s), `OP.GG` ×3. 개발 에이전트의 R2 ci 는 **11:56** — 게임 클라이언트 실행 8분 뒤다. R1 ci(11:33)는 게임 본체 실행 전.
- **부하 상태 5회 반복** (`node packages/core/bench/perf.mjs`): parseRange 11.6~31.4ms, removeBoard 26.9~41.5, exact 276.8~423.6, hvh 184.1~240.1, canonical 19.7~29.3 — 한 번의 실행 안에서도 R1 값과 R2 값 사이를 오간다.
- **High 우선순위로 3회** (`Start-Process -Priority High`): parseRange **9.2 / 8.5 / 8.8**, removeBoard **18.4 / 18.6 / 18.4**, exact **188.7 / 186.3 / 188.0**, hvh **110.9 / 108.2 / 108.6**, canonical **13.7 / 13.6 / 14.8** — R1 값(8.4 / 16.9 / 188.5 / 112.6 / 13.7)과 ±5% 이내로 일치.
- 대조: `scratchpad/r2/bench-cmp.mjs` (P0-R1 dist vs 현재 dist 같은 프로세스 교대 실행) exact 266.6 vs 328.1, hvh 185.0 vs 178.7 — 같은 부하 아래서 두 dist 가 같은 급.

결론: 코드 회귀 없음. 예산(1000/200/5000/5000/3000ms)은 부하 상태에서도 2~12배 여유. 개발 에이전트에게: 벤치를 보고할 때 게임 클라이언트를 끄거나 `LoadPercentage` 를 같이 적어라.

## 6. 새 테스트 17개 (24→41) 품질

- `defaults.test.ts` (7, 전부 신규): 리터럴 `+`/`%2B`/`%20`/`%3A`/키 접미사(`xrange`,`myrange`)/플래그/다중 파라미터/`?` 없는 입력/빈 값/`%zz`·잘린 UTF-8. 실제 회귀 가드는 `expect(text).toBe('22+,A2s+,KTo+')` 와 `combos(text) === 162` 다 — URLSearchParams 구현이면 `'22 ,A2s ,KTo '` 가 되어 첫 줄에서 즉시 실패한다. **`URLSearchParams(...)` 블록 자체는 코드 아래를 거치지 않는 플랫폼 사실 단언**이다: "폼 규칙이면 공백이 된다 + core 가 그걸 22 콤보로 받아준다" 는 전제 확인이지 가드가 아니다. 무해하지만 core 파서가 후행 공백을 거부하도록 바뀌면 이 테스트가 무관하게 깨진다 (MINOR 2).
- `RangePage.test.tsx` (+4: 리터럴 `+` 2, `%2B`, `QQ%3A0.5`; +2: store 소유·`hoveredClass` 읽힘): `window.history.replaceState` 로 진짜 `location.search` 를 만들고 첫 fetch 본문을 검사한다. 동어반복 없음. `4.4 hoveredClass` 테스트가 상태줄 분모 6 까지 본다.
- `RangeGrid.test.tsx` (+3: `QsQh:0.5` 툴팁, MINOR 6 위치, MINOR 5 dpr): dpr 테스트는 `matchMedia` 스텁의 리스너를 직접 호출해 `canvas.width` 2배·`setTransform` 2회를 본다. 재구독(두 번째 `matchMedia` 호출이 `2dppx` 질의인지)은 단언하지 않는다 (MINOR 3) — 실브라우저 검증으로 보완됐다.
- `grid.test.ts` (+3: `formatCellSummary` 2, axisLabels 1): 분모 6/4/12, 레인지 밖 클래스도 `0.00 / 12`, `QsQh:0.5` 의 `fill ≈ 0.5/6` 과 같은 분모임을 명시.

## CRITICAL
없음.

## MAJOR
없음.

## MINOR (P2 로 이월)

1. [web/src/lib/defaults.ts:20] `?range=` 가 두 번이면 첫 번째가 이긴다. 동작은 결정적이지만 스펙에 없었다 → P1.md 4.1 에 명시했다. 코드 변경 불필요.
2. [web/test/defaults.test.ts:19-22] `URLSearchParams` 블록은 core 파서의 공백 관용에 결합된 전제 단언이다. 회귀 가드가 아니므로 주석의 "회귀의 근거" 를 "전제 확인" 으로 바꾸거나, core 가 바뀌어 깨지면 그냥 지워라.
3. [web/test/RangeGrid.test.tsx:151-176] dpr 테스트가 재구독 질의 문자열(`(resolution: 2dppx)`)을 단언하지 않는다. `matchMedia` 스텁이 받은 query 를 기록해 두 번째가 `2dppx` 인지 한 줄 추가.
4. [package.json] `ci` 가 core 를 4회 빌드. `packages/core` 의 `bench` 스크립트에서 `npm run build &&` 를 빼면 3회. 선택.
5. [web/src/components/RangeGrid.tsx:124-136] 상태줄이 생긴 뒤 툴팁은 정보 중복이다. P2 뷰어에서 툴팁을 없애고 상태줄만 남기거나, 툴팁을 격자 밖(우측 패널 상단)에 고정하는 것을 고려. 외관.

## UNCERTAIN
없음.

## 스펙 개정 (P1.md R2)
4.1 `hover-readout` 상태줄·다중 `range=` 첫 번째 규칙·툴팁 행 0·1 아래 배치. 4.2 `formatCellSummary` export. 4.4 입력 텍스트는 store 소유, `RangeInput` 은 store 구독. 1절 `prepare`+`pretest`+`predev:*`. 개정 이력 R2.

## 다음 페이즈 진행 가능 여부

P1 종료. `docs/specs/P2.md` 를 작성했다 — 프리플랍 스키마(`node:sqlite`, STRICT), `ggto-json` v1, `tools/chart-import`, `tools/chart-gen`(자체 생성 HU 푸시/폴드 시드 — 외부 데이터 대기 없이 파이프라인을 끝까지 검증), `/api/charts/*`, 차트 뷰어(포지션 탭 + 브레드크럼 + 액션 누적 격자), P4 스파이크 병행. DESIGN.md 1~2절을 하이브리드 스택으로 재작성했다 (R1 MINOR 7 종결). 개발 에이전트는 P2.md 0절의 "시작 조건" 부터 읽어라 — 시드 차트 확보가 P2 를 막지 않도록 자체 생성 차트가 1순위다.
