# P5 리뷰 — 라운드 1

대상: 브랜치 `p5-ui` = `08294d8` (구현) + `baba47b` (`docs/GAPS.md` 문서 1개, 사용자 작성 — 6절). `main` = `9c1ee29`.
리뷰어: ggto-architect, 2026-09-16. 범위: P5.md 전부. **개발 에이전트의 자체 검증 보고서가 없다** (세션 한도) — 보고 대조 없이 처음부터 전부 직접 검증했다.

## VERDICT: APPROVED

CRITICAL 0 · MAJOR 0 · MINOR 12 (P6 이월) · UNCERTAIN 2. 포커 도메인 값은 전부 **실제 데몬 응답과 화면을 대조**해 맞았다: 캔버스 픽셀 ↔ 서버 169 집계, 콤보 패널 ↔ 1326, 액션 바 % ↔ 도달 가중 평균, 히트맵 ↔ `runouts`, 표기 모드 ↔ 순열 φ 대응 (2652/2652), `Σ evAvgBb = 팟` 8 노드. 계약(정규/표기, `line` 문법, `ChanceNode`, 12절 이월 4건)은 실제 라우트에 공격해 전부 규정대로였다. 코드는 건드리지 않았다 (뮤턴트 17종은 전부 복원, `git status` 청정).

---

## 1. 검증한 것 (실행 근거)

| 무엇 | 명령 / 방법 | 결과 |
|---|---|---|
| `ci` (Bash, `~/.cargo/bin` 을 PATH 에서 제거 — `which cargo` 없음) | `npm run ci` | **exit 0**. core 131 / preflop 45 / server 179 / solver 84 (+15 skip) / trainer 100 / web 172 / chart-gen 23 / chart-import 8 = **742 passed, 15 skipped** (오케스트레이터 수치와 일치). 벤치 전부 `ENFORCED` (외부 부하 22~27% ≤ 43%). smoke 16/16 |
| `ci:solver` (cargo 있음) | `npm run ci:solver` | **exit 0**. 게이트 `verdict=absent`, cargo 3 + 11 (`p5_1_6_node_on_a_chance_node_is_chance_node_not_bad_request` 포함), 통합 15/15, 벤치 cold 23ms · node p99 1.9ms · runouts 49장 4ms |
| fresh clone | `git clone --branch p5-ui` → `npm install` → `seed` → `npm run ci` (Rust 없이) | **exit 0**, 테스트 수 위와 동일, SMOKE OK |
| `check:mobile` | `npm run check:mobile` (실제 바이너리, 시드 `Ks7h2hQc` 캐시 히트) | **131 PASS / 0 FAIL, exit 0**. `/solve` 6 화면 (목록·폼·행동·chance·리버·터미널) 전부 375/375, 넘침 0, 44px 미달 0, 히트맵 52칸 행폭 299 ≤ 343, 하단 바 747~812 / 65px. SKIP 줄 없음 |
| `check:desktop` | 2회 (1회차는 Chrome 이 무작위로 고른 디버그 포트 **6666** 을 Node `WebSocket` 이 거부 — 코드 문제 아님) | 2회차 **36 PASS, exit 0**. 1280×720·1500×1000 3열: 트리 right 208 < 격자 left 258, 격자 right 778 < 어그리게이트 left 872/1092, 격자·어그리게이트·액션 전부 스크롤 0 에서 뷰포트 안. 노드 이동 체감 19ms / 3ms |
| 잔여 프로세스 | 시작 시 개발 에이전트의 서버(7799)+데몬 잔류 → 내가 kill. 끝: `tasklist`·`netstat` | `ggto-solver-cli` 0, 7777/7791/7821/7823 LISTEN 0, `git status` 청정, `data/solves` 원래 1개 (내가 만든 2개는 UI 삭제·취소로 정리) |
| 계약 공격 (`scratchpad/contract.mjs`, 실제 데몬 `ff5a92ae…`) | 2절 | 전부 규정대로 |
| 브라우저 (Browser 도구, 375×812 / 768 / 800 / 829 / 1280×720 / 1500×1000) | 3절 | 값 대조 전부 일치 |
| 뮤턴트 17종 (`scratchpad/mutants.sh`, 전부 복원) | 5절 | 12 사망 / 5 생존 (생존은 MINOR 3) |
| 번들 | main 을 fresh clone 에서 빌드해 비교 | JS gzip **94.64 → 107.69 kB (+13.05 kB ≤ 60 kB)**, CSS 3.84 → 4.06 |
| 벤치 `@ggto/web` (신규) | `ci` 안 | `decodeF32Rows 3x1326 x1000` **42.2 / 50ms**, `aggregate 1326→169 x1000` 151.5 / 200ms, `enforced:true` (MINOR 7: 디코드 헤드룸 16%) |
| D24 (솔버 없는 PC) | `GGTO_SOLVER_BIN=/c/nonexistent/… PORT=7823 node packages/server/dist/main.js` | `/api/solves` **503 SolverUnavailable**, `POST /api/solve` 503, `/api/charts` 200, `/api/trainer/pool` 200. 브라우저 `/solve`: 배너 `이 PC 에는 솔버가 없습니다 (npm run build:solver)`, 목록·`+ 새 솔브` 없음, Range/Charts/Trainer 링크 살아 있음. 가짜 솔버 없음 |

## 2. 계약 (P5.md 1절) — 실제 라우트 실측

| 케이스 | 결과 |
|---|---|
| 정규 모드 `node?line=` | 200, `perm [0,1,2,3]`, board `2c7cQdKh`, actions `[X, B15]`, evAvg `[15.573, 4.427]` |
| 표기 `Ks7h2hQc` + 원 레인지 | 200, **`perm [1,3,0,2]`** (c→d, d→s, h→c, s→h — 4-cycle), board `Ks7h2hQc` |
| **역순열 방향 전수**: 표기 응답 `[c]` == 정규 응답 `[φ(c)]` (strategy·ev 2 액션 + reach) | **0 / 2652 불일치**. `AsKs`(표기) ↔ `AhKh`(정규) 둘 다 reach 0 (보드 K) |
| 다른 표기 `Kd7s2sQh` / `Kc7d2dQs` / `Ks7h2hQd` | 200, perm `[3,2,1,0]` / `[2,0,3,1]` / `[3,1,0,2]`, board 는 보낸 그대로 |
| `runouts X-X` 표기 모드 | 200, board `Ks7h2hQc`, 48장, **`Qc` 없음 · `Qd` 있음** (표기 공간의 카드 제거) |
| `line` 위반: `b33.c` / `X-X-X` / `B99` / `x` / `X-X/Kh`(보드 카드) | 전부 400 **NoSuchLine** (문법 오류와 부재 라인이 같은 코드 — MINOR 2) |
| 터미널: `X-B15-F` / `X-X/2d/X-X`(리버 쇼다운) / `B15-A-C` / `B15-R37.5-A-C`(올인 콜) | 400 NoSuchLine. **올인 콜 뒤는 chance 가 아니라 터미널**이다 (D27 문구와 다름 — MINOR 11) |
| chance: `X-X` / `B15-C` / `B15-R37.5-C` | `node` 400 **ChanceNode**, `runouts` 200 48장 (턴 솔브 → 리버 48) |
| 행동 노드에서 `runouts` (루트, `X-X/2d`) | 400 NotChanceNode |
| `compressed=true` / `1` → HashMismatch(비압축 솔브라 맞음), `0` / `false` → 200, `yes` → 400 BadRequest | **R2 MINOR 2 닫힘** |
| `sizings=simple` / `standard` / `compressed=0` / `rakePct=0` 만 | 전부 400 BadRequest — **R2 MINOR 3 닫힘** |
| `POST` 커스텀 `sizings` 객체 | 400 **OutOfRange** — **R2 MINOR 1 닫힘** |
| `Σ evAvgBb = 팟` | 루트 20.0000 · `X` 20 · `B15` 35 · `X-B15` 35 · `B15-C/2d` 50 · `B15-R37.5` 72.5 · `X-X/As` 20 · `X-X/As/X` 20 — 8/8, `reachable:true` |
| 캐시 행 | `config_json.v = 2`, `solver = postflop-solver@9d1509fe` — **R1 MINOR 7 닫힘** |

## 3. 브라우저 — 화면 값 ↔ 서버 값

### 3.1 375×812 (mobile 프리셋)

| 항목 | 화면 | 서버 | 판정 |
|---|---|---|---|
| 루트 헤더 | `2♣7♣Q♦K♥ · pot 20 · eff 80 · expl 0.49% · [정규 표기]` | `potChips 2000`, `stacks 8000`, 목록 `exploitability 0.494` | 일치 |
| 격자 캔버스 픽셀 (열 x0+3..5px 을 위→아래 스캔, 레이어 색 분류) | AA `B15 23/46`, KK `42/46`, QQ `7/46`, JJ `X 46/46`, TT `B15 33/46` | `aggregate.strategy` AA 0.502 · KK 0.879 · QQ 0.177 · JJ 0 · TT 0.698 (50px 셀 − 4px 테두리 = 46 표본) | **1px 안에서 일치** |
| 상태줄 `선택: AA · X 49.8% +15.31bb · B15 50.2% +15.34bb` | | `aggregate` AA `[0.498, 0.502]`, ev `[15.31, 15.34]` | 일치 |
| 콤보 패널 AA 6행 (`AdAc X 0.14 / +15.95bb · B15 0.86 / +15.96bb` …) | | 1326 `strategy`/`ev` 의 AA 6 콤보와 소수 둘째 자리까지 6/6 | 일치 |
| 하단 바 `X 56% · B15 44%`, 어그리게이트 `55.7 / 44.3` | | `Σ reach·strategy / Σ reach` = 55.7 / 44.3 (**비가중이면 57.6 / 42.4**) | 가중 평균 맞음 |
| `B15` 노드 바 `F 69% C 28% R37.5 3% A 0%` | | 가중 69.3 / 27.8 / 3.0 / 0.0 | 일치 |
| OOP/IP 토글 → IP | 범례 `reach IP`, 콤보 패널 없음, 격자에 AQs·AJs·QQ·JJ·TT·99 만 (99 = 만색, AQs 25/42 = 0.595) | IP 도달 클래스 6개, AQs mass 0.085 / 3콤보 → `3×0.0283/0.0357/4 = 0.595` | 일치 (다른 격자 재사용 아님) |
| 액션 트리 깊이 4: `B15` → `C` → 히트맵 → `2d` 2단계 탭 → `B15-C/2d` → `X` → `X-X`(터미널) | URL `line=B15-C%2F2d%2FX-X`, 라인 바 `Turn › B15 › C · 2d River › X › X`, 헤더 5장, 팟 20→35→50, 행동 OOP→IP→OOP→IP | | 항등 왕복: `crumb-B15` → `line=B15` 팟 35, `crumb-root` → 쿼리 없음 팟 20 |
| 히트맵 `B15-C` (딥링크) | 48칸, 빈칸 `Kh Qd 7c 2c`, 요약 `48장 · OOP 평균 25.38bb · 최고 A♠ +12.20 · 최저 K♣ -11.87`, 상태줄 `2♦ · OOP +28.89 · IP +21.11 · 에퀴티 53.8% · 카드 뒤 전략 80.8/0/19.2` | `runouts` 평균 25.38, best As +12.20, worst Kc −11.87, `2d {28.891, 21.109, 0.538, [0.808, 2e-8, 0.192]}` | 일치. As `#34d399`(+1), Kc `#f57273`(−0.97). IP 토글 → As 빨강, Kc 초록, 요약 `IP 평균 24.62` |
| 폼 → 캐시 히트 (시드 스팟) | 확인 시트 없이 탐색기, 헤더 `K♠7♥2♥Q♣`, **칩 없음**, `localStorage['ggto.solve.notation.ff5a…']` 저장 | | 표기 모드 |
| 표기 모드 AKs 콤보 패널 | `AcKc 0.43/+15.57 · AdKd 0.64/+14.88 · AhKh 0.85/+18.06 · AsKs 0.00` | 정규 `AdKd 0.43 · AsKs 0.64 · AcKc 0.85` = φ 대응 (c→d, d→s, h→c) | **역순열이 UI 까지 맞다** (P4 MAJOR 6 의 UI 판). `AsKs` 는 보드 K♠ 로 막힌 콤보 → MINOR 5 |
| 표기 모드 `X-X` → `As` 2단계 탭 | 빈칸 `Ks 7h 2h Qc`, 리버 노드 헤더 `K♠7♥2♥Q♣A♠`, `line=X-X/As`, EV `+16.89 / +3.11` | `runouts` As `evOop 16.886`, `node X-X/As` board `Ks7h2hQcAs` | 일치 |
| 정규 모드 칩 → 표기 시트 `Kd7s2sQh` | 200 → 헤더 `K♦7♠2♠Q♥`, 칩 사라짐, LS 저장, AKs 패널 `AcKc 0.64 · AhKh 0.43 · AsKs 0.85` | perm `[3,2,1,0]` 대응 | 일치 |
| 표기 시트에 다른 게임 (pot 30) | 시트 안 `이 솔브의 게임이 아닙니다`, 시트 유지, LS 비어 있음; pot 20 으로 재제출 → 열림 | | 규정대로 |
| 열 때 LS 표기가 틀림 (pot 30 저장 후 딥링크) | 토스트 `저장된 표기가 이 솔브와 맞지 않아 정규 표기로 엽니다`, LS 삭제, 칩 복귀 | | 규정대로 |
| 새 솔브 `Ks7h2hJc` (미캐시) | 시트 `예상 메모리 1MB · 약 1초 · 캐시 없음`, `실행` → 3.46s 뒤 탐색기 (표기 모드, `expl 0.34%`) → `←` 목록 2행 → 삭제 확인 → 1행, LS 삭제 | | 완료 경로 OK. 진행 화면은 잡이 0.4s 안에 끝나 못 봄 (UNCERTAIN 2) |
| 플랍 `Ks7h2h` 넓은 레인지 | 시트 `1.2GB · 약 7분`, `실행` → `솔브 중 — running · 대기 중…` → `취소` → **495ms** 뒤 목록, `.part` 0, 솔브 프로세스 0 (데몬만 남음) | | R1 MINOR 3·5 실기 확인 |
| 딥링크 `?line=b33.c` | `Flop › b33.c` + `종료 노드 — 이전으로`, `←` 로 루트 복구 | | 회복은 되나 라벨 둘이 틀림 — MINOR 1·2 |

### 3.2 태블릿 768 / 800 / 829 (수동 — 게이트에 없다, MINOR 4)

| 폭 | 격자 | 우측 열 | 겹침 | 하단 바 |
|---|---|---|---|---|
| 768 | 377 (≤ 420), left 42~419 | 288, left 441 | 없음 | `position: static`, 바 1개, 토글 1개 |
| 800 | 403, ~445 | 288, 473 | 없음 | |
| 829 | 416, ~458 | 288, 502 | 없음 | |

chance 노드 (768): 런아웃 401px 왼쪽 열, 미니 막대 48개, 칸 32px, 우측 열에 토글·`카드를 고르세요`.

### 3.3 데스크톱 1280×720 / 1500×1000

3열 (트리 176 · 격자 520 · 우측 384). 딥링크 `?line=B15` 의 트리는 `Turn …` (루트 미캐시 — 설계대로, MINOR 12), `crumb-root` → `B15` 뒤 `Turn X B15` 에 두 액션 강조, `B15-C` 에서 `Turn X B15 / B15 F C R37.5 A`, `tree-action-X` 클릭 → `line=X` EV `14.40 / 5.60`. `B15` 노드의 액션 4개는 우측 열에서 2줄(112px) — 스크롤 0 안. 1500 도 같은 배치.

## 4. P4 이월 (P5.md 12절) 닫힘 확인

| 항목 | 확인 |
|---|---|
| R1 M1 `isomorphism.ts` import | diff 로 `comboIndex` 제거 확인 |
| R1 M3 `.part` 잔류 | `queue.ts` catch 에서 `rmSync`; 테스트 `P5 12 R1-3`; **실기**: 플랍 취소 뒤 `.part` 0 |
| R1 M4 같은 해시 재요청 | 라우트 `queue.byHash`; 테스트 `P5 12 R1-4` (`estimateCalls 1`, 같은 `jobId`) |
| R1 M5 취소 500ms | `CANCEL_KILL_MS = 500`; 테스트 `stubborn-cancel` 시나리오 `< 2000ms`; **실기** 495ms |
| R1 M6 / M10 문서 | P4.md 4.2 / 3.5 에 정정 문단 |
| R1 M7 해시에 solver id | `v:2 + solver`, `configHash(cfg, solverId)` 필수 인자, `repair()` 가 v1 행 삭제 (테스트), 실 캐시 행 v2 |
| R1 M9 소문자 | `hash.test` 8 토큰 throw |
| R1 M11 `evAvgBb` NaN | Rust `reachable`, `postflopCli` 가 필드 없으면 `ProtocolMismatch`, UI `—` (테스트 + 뮤턴트 사망) |
| R2 M1·M2·M3 | 2절 실측 |
| R2 M4 | P4.md 5.1 문단 — 문서만 (수용) |

## 5. 뮤턴트 (내가 심고 전부 복원)

| 뮤턴트 | 결과 |
|---|---|
| `childLine` 카드 토큰을 `-` 로 / 카드 뒤 첫 액션을 `-` 로 / `parentLine` 카드 세그먼트 오류 / `segments` 스트리트 미승급 | 각 2 사망 |
| `actorReach` OOP↔IP 스왑 | 2 사망 (`solveAggregate` 전략·EV) |
| `f32` 길이 검사 제거 / `solveNotation` 인코딩 제거 / `presetNameOf` 정렬 제거 | 각 1 사망 |
| `NoSuchLine → chance` / `AggregatePanel` `reachable` 무시 | 각 1 사망 |
| `view.ts` `inv = perm` (솔버 dist 재빌드) | 솔버 **5 사망** (`webFixture` 재생성 대조 + view 3-cycle). 웹 정적 픽스처 테스트는 6/6 통과 — 개발 에이전트가 예고한 대로, 솔버 쪽 재생성 테스트가 그 구멍을 막는다 |
| **생존**: `actionFrequencies` 비가중 평균 (172/172 통과) · `canonicalChip = true` (10/10) · `symmetricScale` `Math.abs` 제거 (6/6 — `[+2, −1]` 은 양수가 지배해 못 잡는다) · `displayReach` 미정규화 (테스트 없음) · `heatColor` 부호 반전 (mix 가 t<0 에서 외삽돼 우연히 통과 — 약한 뮤턴트, 항목 아님) | MINOR 3 |

신규 web 테스트 61개 동어반복 검사: `solveLine.test` 는 스펙 1.3 표를 **손으로** 박았고, `solveAggregate.test` 는 3-cycle 에서 기대 인덱스(`AdKh` vs 오방향 `AhKc`)를 손으로 박고 "우연히 같지 않음" 까지 단언한다. `SolveExplorer.test` 는 실제 `toNodeResponse` 픽스처 + 서버 오류 봉투로 chance/terminal/HashMismatch 를 코드로만 판별한다 (D27). 구현을 베낀 것은 없다.

## CRITICAL

없음.

## MAJOR

없음.

## MINOR (P6 12절로 이월)

1. `SolveExplorer.tsx:83-97` — 터미널·부재 라인으로 **딥링크**하면 `node`·`runouts` 둘 다 없어 `currentStreet` 이 `'flop'` 으로 떨어진다: 턴 솔브 `?line=b33.c` 가 라인 바 **`Flop › b33.c`**, 헤더 보드 없음. UI 흐름(부모를 거쳐 도달)에서는 `lastSeen` 이 막지만 URL 로는 틀린 스트리트가 보인다. `summary`(목록 행 `street`·`boardCanonical`)를 폴백으로 쓰면 된다 — 정규 모드에서는 그 보드가 곧 응답 보드다.
2. `api/solve.ts:126` — 문법 위반 라인(`b33.c`, `x`)도 서버가 `NoSuchLine` 이라 **`종료 노드`** 로 표시된다. 노드 종류 추측이 아니라 **문법** 검사(`isActionToken`/`isCardToken`, 이미 있다)로 `잘못된 라인` 을 갈라 표시하라.
3. 테스트 공백 (5절 생존 4종): `actionFrequencies` 가중 여부 (픽스처로 `55.7%` 류 값을 박아라), `정규 표기` 칩이 표기 모드에서 **없다**, `symmetricScale([-2, 1]).max === 2`, `displayReach` 최댓값 1.
4. `tools/shots/mobile.mjs` 태블릿 3폭 구간에 `/solve` 화면이 없다 (P5.md 8.3 요구). 수동 측정은 3폭 전부 겹침 0 이었다 — 게이트만 추가.
5. `ChartComboPanel` 이 보드에 막힌 콤보(`AsKs` on `K♠…`)를 `X 0.00 / +0.00bb` 로 그린다 — 값이 없는데 0 으로 보인다 (P5 1.5 의 원칙 위반, 프리플랍에는 없던 경우). reach 0 콤보는 행을 빼거나 `막힘` 으로.
6. 파일 길이: `SolvePage.tsx` 365, `SolveExplorer.tsx` 304 (6절 ≤ 300). 표기 시트 로직(`verifyNotation` 동적 import 포함)을 훅으로 빼면 둘 다 들어간다.
7. `web/bench` `decodeF32Rows` 42.2/50ms — 헤드룸 16%. 부하 있는 CI 에서 흔들릴 값이다. `atob` 대신 `Uint8Array.fromBase64` 검토 또는 예산 근거 재기록.
8. `EstimateSheet` — R1 M4 경로(이미 실행 중인 잡)의 `estSeconds 0` 이 `약 1초` 로 보인다. `status === 'running'` 이면 `이미 실행 중 — 진행 화면으로` 로.
9. 2열 chance 노드에서 런아웃이 **왼쪽 열**(401px)에 있다 (스펙 3.2 "격자 아래 전폭"). 기능상 문제 없음 — 스펙 문구를 구현에 맞춰 고쳐라.
10. `SolveExplorer.tsx:303` `streetOfBoard` — chance 노드의 스트리트를 `runouts.board` 장수로 정한다. 추측이 아니라 응답의 카드 수이지만, `runouts` 응답에 `street` 를 넣으면 없앨 수 있다 (P6 에서 `runouts` 응답 확장 시).
11. D27 문구 "올인 콜 뒤의 스트리트" — 데몬은 올인 콜 뒤를 **터미널**(`NoSuchLine`)로 답한다 (`B15-R37.5-A-C`, `B15-A-C` 실측). 예시를 "리버 체크-체크(터미널)" 하나로 줄여라.
12. `LineTree` 딥링크 시 조상 액션이 `…` (캐시에 없다). 설계 주석은 있으나 DESIGN 5.4 "조상 + 형제 액션" 과 다르다 — 딥링크 시 조상 프리페치(깊이 ≤ 8, 요청 ≤ 8) 또는 DESIGN 문구 갱신.

## UNCERTAIN (개발 에이전트가 증명할 것)

1. **태블릿 `pointer: coarse` 에서 탐색기의 44px** — Browser 도구로 coarse 를 켤 수 없어 768 에서 `Range/Charts/Trainer/explorer-back/combo-toggle` 이 44 미만으로 잰 것은 fine-pointer 값이다. `TOUCH` 에 `pointer-coarse:min-h-11` 이 있으니 맞을 것이나, MINOR 4 의 게이트가 실측으로 증명해야 한다.
2. **SSE `progress` 표시** — 3.5s 솔브는 진행 이벤트 전에 끝났고, 7분 솔브는 트리 빌드 중(`running · 대기 중…`)에 취소했다. `iter · expl · pct` 줄과 재연결(3초) 경로는 브라우저에서 못 봤고 `SolveProgress` 단위 테스트도 없다. `EventSource` 를 모킹한 테스트(progress → 바 폭, done → `onDone`, onerror → 3초 재연결) 를 P6 첫 커밋에.

## 6. 머지 가능성

`git merge-base --is-ancestor main p5-ui` 참 — fast-forward 가능. `p5-ui` 에는 구현 `08294d8` 위에 `baba47b`(`docs/GAPS.md`, 사용자 작성, 코드 없음)가 얹혀 있고 `origin/p5-ui` 도 같다. 그대로 fast-forward 해도 된다. **단** `GAPS.md` 는 "P6(포스트플랍 트레이너)보다 P7·P8(6-max 프리플랍 생성기·게임 타입 분리)이 먼저" 라고 적고 있다 — 아래 P6 스펙은 요청대로 썼으나 **착수 순서는 사용자 결정**이다. P6 는 P7·P8 에 의존하지 않고, 역도 마찬가지다.

## 다음 페이즈 진행 가능 여부

가능하다. **P6 = 트레이너 v2 (포스트플랍 스팟)**, 스펙 `docs/specs/P6.md`. 핵심 결정: (1) 스팟은 **한 솔브 안에서만** 채점된다 — P4 R2 실측(솔브 간 EV loss maxΔ 0.257bb, Perfect 뒤집힘 2/60)이 근거이고, 시도 기록이 채점 근거(`hash`·`exploitability`·`iterations`)를 함께 저장한다; (2) 채점 가능 솔브 = 비압축(D28) + 정확도 상한(플랍 0.1%, 턴·리버 0.05% — P6 첫 주에 턴 기준을 재실측해 확정); (3) 스팟 샘플링은 트리 열거 없이 **전략을 따라 걷는 랜덤 워크**로 도달 가중을 얻는다; (4) 카테고리 9종(스트리트 × 베팅/베팅 직면/레이즈 직면) + 리버 블러프/밸류 태그; (5) 리크 분석에 성향(과폴드·과콜·과베팅)을 추가; (6) P5 MINOR 12건 배치. 개발 에이전트는 P6.md 8절 DoD 와 13절을 읽고 시작한다.
