# P2 리뷰 — 라운드 1

리뷰어: ggto-architect. 날짜: 2026-09-11. 대상: 프리플랍 차트 전체(스키마·코덱·생성기·임포터·API·뷰어) + P4 스파이크 문서.
스펙: `docs/specs/P2.md` (본 라운드에서 R2 개정 — 문서 끝 개정 이력). 스크래치: `scratchpad/arch-p2/` (전부 리뷰어 자작, 개발 에이전트 코드 미사용).

## VERDICT: CHANGES_REQUIRED

CRITICAL 0, **MAJOR 3**, MINOR 8, UNCERTAIN 2.
**시드 차트는 맞다** (아래 1절 — 도메인 관문 통과). 남은 MAJOR 는 전부 한 줄~수 줄짜리 재현성/에러 매핑/문서 정정이고 도메인 결함이 아니다. R2 에서 셋을 고치면 APPROVED 이고 그 즉시 P3 스펙을 쓴다.

## 검증한 것 (실행 근거)

| 항목 | 방법 | 결과 |
|---|---|---|
| `npm run ci` | 루트에서 직접 실행 (`scratchpad/ci-p2-architect.log`), LoadPercentage **9** | exit 0. core 125 / preflop 45 / server 44 / web 57 / chart-gen 21 / chart-import 8 = **300**. bench 8/8 (importSet 10.3 / getNode 137.4 / reach 101.6 ms), smoke 11/11 |
| **fresh clone** | 소스만 복사(`node_modules`/`dist` 제외) → `npm install` → `npm run ci` (`scratchpad/arch-p2/fresh/ci.log`) | install 0, typecheck 0, **`ci` exit 1** — `chart-import` CLI 테스트 8/8 실패 (`dist/main.js` 없음). MAJOR 1 |
| **`npm run seed` 빈 `data/`** | `data/` 를 통째로 옮기고 두 번 실행, 생성 JSON 을 이전 산출물과 `cmp` (`scratchpad/arch-p2/seed{1,2}.log`) | 1회차 6/6 OK (set #1~#6, 12 노드), 2회차 **6/6 SKIP** (content_hash). 6 파일 전부 **바이트 동일**. `user_version=1`, `journal_mode=wal` |
| **독립 exploitability** | 자작 덱/콤보/클래스/w(h,v) + 자작 best response (`verify.mjs`, core 미사용) | 6 스택 nashConv **6.3e-8 ~ 2.6e-7** (파일 기록값과 같은 자릿수), exploitability 3.2e-8 ~ 1.3e-7. 행 합·F=0 위반 0 |
| **독립 솔버** | vanilla regret matching, 동시 갱신, 균등 평균 (개발 에이전트의 CFR+/선형/교대와 다른 알고리즘), 40k 반복 | 집계 레인지 6/6 일치 (예: 10bb SB 58.33/58.33, BB 37.35/37.35), 게임값 차 ≤ 3e-5bb, 교차쌍 (devSB,myBB)/(mySB,devBB) NashConv ≤ 4e-5 (내 솔버 잔차 수준) |
| **EV 재계산** | 정의식으로 EV_A/EV_C 169 클래스 재계산 | 파일과 최대 편차 **8.7e-7 bb** (6자리 반올림 잔차) |
| **균형 비유일성 판정** | 분쟁 클래스 빈도를 0~1 로 쓸며 NashConv 재계산 (`nonunique.mjs`) | 5bb BB 95s: 전 구간 ≤ 3.3e-6. 20bb SB Q5s: [0, 0.5] ≤ 3.2e-7, 1.0 에서 6.4e-5. **대조군** 10bb K2o(순수): 0.9 로만 옮겨도 1.1e-4, 0 이면 1.1e-3. 2절 |
| **공개 Nash 표 대조** | HoldemResources HUNE 무앤티 표 (WebFetch 원문 CSV, 같은 모델: SB A/F, BB C/F, 앤티 없음, 스택 = 블라인드 전 유효 스택) 169×2×6 = 2,010 셀 | **2,007 일치**. 불일치 3 은 전부 경계: 5bb 96o(HR 5.2), 5bb 95s 콜(HR 5.0), 8bb 84s(HR 10.1, 우리 EV −0.0012) |
| **에퀴티 표 정확성** | 고정 10쌍 + 무작위 20쌍을 core 전수 hvh (P0 에서 리뷰어 평가기로 검증됨) 로 슈트 정규형 중복 제거해 **정확히** 계산 (`equity-exact.mjs`) | 기준 4개 ≤ 0.055%p. **30쌍 최대 0.282%p (AKs-QQ)**, 행 단위(84s/96o/Q4s/Q5s 169열) 최대 0.339%p. 200k 의 SE 0.11%p 대비 정상 꼬리. 대칭/대각 위반 0 |
| **MC 노이즈의 결정 영향** | 경계 핸드 5개의 정확 행으로 잼 EV 재계산 (`noise-impact.mjs`) | EV 이동 최대 **1.3e-3 bb** (84s@8bb −0.0012→−0.0024, 부호 불변). 채점 임계 0.05bb 의 1/40 |
| **169 로 푸는 정당성** | 이론 검토 + 실증 | 슈트 순열 S4 는 프리플랍 HU 게임의 자기동형(덱·딜·랭킹·지불 보존) → 대칭 균형 존재, 클래스 = 궤도(6/4/12). 축소 게임의 균형은 원 게임의 균형 (대칭 상대 전략에 대한 콤보 지불이 클래스에만 의존). API 1326 배열의 값별 콤보 수 히스토그램이 169 파일과 동일 |
| **API vs DB 블롭** | `/api/charts/1/node` 의 `strategy`/`ev` 를 `Float32Array.from` → `node:sqlite` 직접 SELECT + `zstdDecompressSync` + `DataView` LE (코덱 우회) (`api-check.mjs`) | 2 노드 × 2 컬럼 × 1326 **불일치 0**. reach(A,SB) = 루트 A 열 (773.44/1326 = 58.33%), reach(A,BB) 전부 1 |
| **seq 엣지 URL** | 16종 | `%2D`=`-` 동일 404, `A+C`/`A%20C`/`%2B` → 400 ActionSyntaxError, `seq=A&seq=F` → 첫 값. **`%zz` → 500 Internal + 스택 로그**. MAJOR 2 |
| **퍼즈** | 결함 37종 (스펙 8종 포함) 을 실제 CLI 자식 프로세스로, WAL 체크포인트 후 DB 파일 sha256 비교 (`fuzz.mjs`) | **37/37 exit 1, errors ≥ 1, DB 바이트 불변** |
| **브라우저 실물** | Browser 도구, `npm start` 7777, 실제 마우스 이벤트 + 캔버스 `getImageData` 열 샘플 | 아래 3절. **43s 셀: 하단 슬레이트 4px + 경계 1px 블렌드 (기대 5.56px), 크림슨 ~34px (기대 34.44)**. 노드 A Q6s: 에메랄드 11px + 블렌드 (기대 12.6). reach SB 43s 녹색 34px |
| grep 게이트 | 2절 정규식 | server SQL 0 / web `@ggto/preflop` 0 / preflop import = core·sqlite·zlib·crypto 뿐 / preflop 핸드 리터럴 0 / web 리터럴 `DEFAULT_RANGE_TEXT` 1건 / `URLSearchParams` 주석 1건(코드 0) / 새 npm 의존성 0 (package.json 표 확인) |
| 설계 변경 3 실증 | `validateChart` 에 루트 `actions` 6종 | `F,R2,R2.5,R3,R9.5,A` 수용 / `R10`·`R1.5`·`B2`·`X` 거부 |
| 새 테스트 175개 | 전 파일 읽음 | 6절 |
| P1 이월 MINOR 1~5 | 파일 확인 | 1 스펙만(변경 불필요) / 2 주석 "전제 확인" 으로 교체 / 3 `queries` 두 번째가 `2dppx` 단언 / 4 core `bench` 에서 build 제거 / 5 툴팁 제거 (RangeGrid 에 툴팁 코드 없음, 실물 확인). **5/5 처리** |
| 스파이크 | 문서 + 클론(`scratchpad/spike/pfs`) `git` 상태 | `Cargo.lock` 은 **상류 HEAD 에 없다** (`git show HEAD:Cargo.lock` → 없음, `git ls-files` 에 lock 없음). 문서의 진단이 틀렸다. MAJOR 3 |

## 1. 시드 차트 — 관문 통과

파일이 주장하는 exploitability 는 내 BR 로 재현된다 (5bb 3.2e-8, 8bb 1.3e-7, 10bb 4.8e-8, 12bb 2.1e-8, 15bb 1.0e-7, 20bb 9.1e-8). 게이트 0.005bb 의 4~5 자릿수 아래. EV 는 정의식과 1e-6 안. 다른 알고리즘의 내 솔버가 같은 집계 레인지에 도달하고, 공개 Nash 표(HR, 같은 모델)와 2,010 셀 중 2,007 일치 — 불일치 3 은 전부 HR 임계값 ±0.2bb 안의 경계 핸드. **차트는 거짓말하지 않는다.**

주의할 사실 하나: 84s 는 10bb 에서 잼(0.9998, EV +0.007) 인데 8bb 에서 폴드(EV −0.0012, 정확 에퀴티로 −0.0024) 다 — 스택에 대해 비단조. HR 은 84s 를 10.1 로 적어 단조라 한다. 두 EV 모두 1e-3bb 급이라 어느 쪽이 "진짜" 인지는 MC 노이즈 아래이고, 채점에 영향 없다. 성질 게이트 (b) 는 집계 콤보 수의 단조성이라 여전히 성립.

## 2. 개발 에이전트의 "균형 비유일성" 경고 — **맞다. 게이트를 고쳤다.**

게임이론: 2인 제로섬 유한 게임의 균형 집합은 두 플레이어 minimax 집합의 곱이고 볼록하며, 교환 가능하다(interchangeability). 무차별 클래스(|EV| = 0)의 빈도를 바꿔도 상대의 BR 이 유지되는 구간에서는 전부 균형이다. 실증: 5bb BB 95s 를 0, 0.25, 0.5, 0.75, 1 로 두면 NashConv 3.3e-6 / 1.5e-6 / 7e-8 / 2.2e-7 / 3.7e-7 — 전 구간 균형(1e-5 이하). 반면 순수 클래스 K2o 는 0.9 로 옮기는 순간 1.1e-4. 교차쌍 (devSB, myBB) 도 ≤ 4e-5. 따라서 L∞ 는 균형 비교의 척도가 아니다.

스펙 13절을 (a) 독립 BR exploitability < 1e-5, (b) L∞ ≥ 0.02 인 클래스는 |EV| < 1e-3 이고 어느 쪽 값으로 바꿔도 NashConv < 1e-5, 그 외 L∞ < 0.02, (c) 집계 % 차이 < 0.2%p, (d) 게임값 차이 < 1e-4, EV L∞ < 0.05 로 교체했다. 이번 결과는 전부 통과 (EV L∞ 최대 2.4e-2 는 20bb 에서 Q5s 잼 빈도 차이가 BB 콜 EV 를 흔든 것 — 비유일성의 직접 결과이고 0.05 아래).

## 3. 뷰어 실물 (`/charts?set=1`)

- 루트: 헤더 `source: generated / ggto chart-gen push-fold · EV · 169`, 탭 `SB •`(aria-pressed) / `BB`, 라인 `root`, 다음 `F`(disabled, 터미널) `A`(go to A), `pot 1.50bb`, 범례 `F A`.
- 43s 호버(실제 mousemove): 상태줄 `hover: 43s · F 13.9% +0.00bb · A 86.1% +0.00bb`. 클릭: 패널 `43s (4 combos) / reach 100% (4.00 / 4) / F 13.9% +0.00bb / A 86.1% +0.00bb / 169 해상도 안내 / 4c3c 4d3d 4h3h 4s3s 각 F 0.14 A 0.86`. 파일값 0.8609 / EV 0.000002 와 일치.
- `A` 클릭: URL `?set=1&seq=A`, 탭 `BB •`, 라인 `root › A` (둘 다 링크), 다음 `F`/`C` 둘 다 disabled(터미널), `pot 11.00bb`, 범례 `F C`. 패널은 선택 유지된 43s 로 `F 100% / C 0% −1.68bb` (파일 EV_C −1.684125).
- reach 모드: `BB reach: 100% of all combos`; SB 탭 클릭 → `SB reach: 58.3%`, 범례 `reach SB`, 43s 녹색 34px, Q4o/72o dim. 이때 우측 패널은 여전히 전략 패널 (개발 에이전트 자인, MINOR 3).
- 픽셀은 표의 "브라우저 실물" 행. 개발 에이전트 스크린샷 4장 존재, `P2-charts-cell-43s.png` 가 내 화면과 같다.
- `<title>` 이 `/charts` 에서도 `GGTO — Range` (MINOR 2).

## CRITICAL

없음.

## MAJOR (승인 전 수정 필요)

1. **[package.json:`pretest` / tools/chart-import/test/cli.test.ts] fresh clone 에서 `npm run ci` 가 exit 1.** `ci` = typecheck → **test** → build 인데 `pretest` 는 `build:libs` 만 돌리고, `cli.test.ts` 는 `dist/main.js` 를 자식 프로세스로 띄운다. `dist` 가 없는 체크아웃에서 8 테스트 전부 `expected 1 to be 0`. 보고된 "ci exit 0" 은 stale `dist` 위에서만 참이다. P1 R2 가 fresh clone 을 게이트로 확정했으므로 회귀다. 수정: `pretest` 에 `build:tools` 추가 (스펙 1절 R2). 재현: `scratchpad/arch-p2/fresh/ci.log`.
2. **[packages/server/src/routes/charts.ts:25 `queryParam`] `?seq=%zz` → 500 Internal + `[ggto] unhandled error URIError: URI malformed` 스택 로그.** `decodeURIComponent` 의 `URIError` 를 안 잡는다. 스펙 8 은 파싱 실패 → 400 이고, P1 3.1 은 사용자 입력 결함 = 4xx 다. `web/src/lib/defaults.ts:urlParam` 은 이미 `URIError` 를 잡는다 — 서버만 빠졌다. `range` 엔드포인트의 `pos` 도 같은 경로. 수정: `URIError` → `badRequest`, 회귀 테스트 `queryParam('…?seq=%zz')` 1개.
3. **[docs/spikes/P4-rust.md 2절] 사실 오류: "레포에 커밋된 `Cargo.lock` 자체가 bincode 2.0.1 을 고정 … 상류가 lock 만 갱신하고 소스는 안 고침".** 상류 `9d1509f` 에는 `Cargo.lock` 이 **없다** (라이브러리 크레이트, `git ls-files` 에 없음). 시도 1 의 `cargo build` 가 lock 을 새로 썼고, `Cargo.toml` 의 `bincode = "2.0.0-rc.3"` 를 cargo 가 semver 규칙대로 stable 2.0.1 로 해석한 것이다. 시도 2 의 `--locked` 는 자기가 방금 쓴 lock 을 잠근 것이라 아무것도 증명하지 않는다. 이 오진이 권고 (b) "rust-toolchain 으로 1.73 고정이 가장 재현성 높다" 로 이어지는데, **2023 년 cargo 도 오늘 crates.io 를 보면 똑같이 2.0.1 을 고른다** — (b) 단독으로는 bincode 문제를 못 고친다. 올바른 재현 수단: 우리 래퍼 크레이트에 rc.3 을 핀한 `Cargo.lock` 을 **커밋**하고 `--locked` 로 빌드 (린트 문제는 별개 — 4절). 문서를 고쳐라. 코드 아닌 문서지만 P4 계획의 근거이므로 이번 라운드에 정정.

## MINOR (다음 페이즈로 미뤄도 됨)

1. [packages/preflop/test/validate.test.ts:162] `console.log(JSON.stringify(issues))` 디버그 잔류 ("eslint 없는 프로젝트라 그대로 찍어 본다"). 지워라.
2. [web/index.html:6] `/charts` 에서도 `<title>` 이 `GGTO — Range`. `ChartsPage` 마운트 시 `document.title` 설정.
3. [web/src/pages/ChartsPage.tsx] reach 모드에서 우측 패널이 전략 패널 그대로 (자인). P3 에서 패널을 모드별로 갈라라.
4. [tools/chart-gen/data/equity169.json] MC 최대 오차 실측 0.34%p (4σ 꼬리). 결정 영향 ≤ 1.3e-3bb 라 지금은 감수. 정확 표(쌍당 슈트 정규형 1~7회 hvh, ~20분) 는 P4 이후 개선 항목으로 스펙에 적어 뒀다.
5. [tools/chart-gen/src/chart.ts] CFR+ 잔차(0.999813) 는 결함이 아니지만, **P3 채점의 "혼합" 정의는 min 빈도 ≥ 0.01** 이어야 한다 (≠ 0/1 로 정의하면 순수해가 혼합으로 보인다). P3 스펙에 반영 예정.
6. [packages/server/scripts/smoke.mjs] 항목명 `GET /api/charts → 200 { sets: [] }` 인데 시드가 있으면 6개가 온다. 이름을 `200 + 배열` 로.
7. 300줄 초과 3파일 (jsonShape 331 / validate 310 / ChartsPage 328). 자인. 다음 페이즈에서 손대는 김에.
8. [packages/server/src/routes/charts.ts] `?seq=R10` (비정규 올인, D10) 이 404 MissingNode. 임포터가 비정규 seq 를 절대 넣지 않으므로 결과는 맞지만, 사용자에게 "없다" 보다 "R10 은 A 로 써라" 가 낫다. 선택.

## UNCERTAIN (개발 에이전트가 증명해야 할 것)

1. **postflop-solver `expected_values()` 의 기준점이 "현재 노드 이후" 인가 "루트 이후" 인가.** 스파이크의 증거(Σ_players EV = starting_pot)는 **루트 노드**에서 잰 것이라 둘을 구분하지 못한다 (루트에서는 두 정의가 일치). P4 스파이크 보강: OOP 벳 뒤 IP 노드 같은 **내부 노드**에서 `cache_normalized_weights` 후 두 플레이어 EV 합을 재라. 노드 팟(양쪽이 그때까지 넣은 전부)과 같으면 노드 기준(3.3 과 동일, 변환은 `/bb` 뿐), starting_pot 이면 루트 기준(노드 이전 투입을 더해 줘야 함). P4 스펙은 이 결과에 따라 변환식을 확정한다.
2. **P4 래퍼 크레이트가 `windows-sys`(raw-dylib) 를 끌어오지 않는가.** DCFR 실패 원인은 `clap → windows-sys` 였고 `postflop-solver` 는 그 경로가 없어 통과했다. 우리 래퍼(stdio JSON-lines)는 `serde_json` 정도만 쓰면 되지만, `cargo tree -i windows-sys` 가 비어 있음을 P4 에서 확인해야 한다. 비어 있지 않으면 MSYS2 binutils 가 전제 조건이 된다.

## 4. 요청 A·B 판정

- **요청 A (`Math.fround` 범위)**: **현행 유지.** 문언대로 모든 숫자. 의도는 "해시 입력의 f32 접기" 이고 저장값은 f64 그대로라 왕복은 항등이다 (6.4 테스트가 고정). `0.05000000074505806` 은 해시 입력에서만 보이는 값이고 해시는 불투명하다. f32 ULP 아래에서만 다른 두 문서가 같은 해시를 받는 것은 포커에서 의미 없는 차이이므로 오히려 바람직하다. 지금 바꾸면 얻는 것 없이 content_hash 전부가 바뀐다. 스펙 5.4 에 명문화했다.
- **요청 B (Hono `+`)**: **수용.** 실측 결과를 스펙 8 에 기록했고 `queryParam` 통일 + 회귀 가드를 확인했다. 단 같은 함수의 `URIError` 가 MAJOR 2 다.

## 5. 설계 변경 9건

| # | 판정 | 근거 |
|---|---|---|
| 1 | 200k 샘플 **수용** | 50k 에서 게이트 초과 실측은 타당 (타이가 있어 분산이 큼). 200k 의 꼬리 오차 0.34%p 도 확인. 스펙 7.1 갱신 |
| 2 | 대각선 정확 0.5 **수용** | 클래스 h vs h 의 매치업 집합은 순서쌍 교환에 대칭이고 eq(a,b)+eq(b,a)=1 이므로 평균은 정확히 0.5. MC 노이즈를 넣을 이유가 없다 |
| 3 | 상태 기계 수용 여부 **수용** | 실증: `R2/R2.5/R3/R9.5/A` 수용, `R10/R1.5/B2/X` 거부. `legalActions` 의 금액 후보 열거가 단일값인 것은 P0 설계이고, 차트 검증에는 "적용 가능한가" 가 맞는 질문. 스펙 6.2-3 교체 |
| 4 | 디렉터리 인자 **수용** | Windows npm 글로브 부재는 사실. 이름순 정렬로 결정적 |
| 5 | `opts.source` 의미 **수용** | D15 방향. 단 `runImport` 는 항상 `'file'` 을 넘기므로 이 검사는 chart-gen 직접 호출에서만 산다 — 괜찮다 |
| 6 | reach 한 열 디코드 **수용** | zstd 는 어차피 전체 해제; 변환만 줄인 것. 벤치 101.6ms |
| 7 | 툴팁 제거 **수용** | P1 R2 MINOR 5 의 첫 번째 선택지. 상태줄이 같은 문자열. 스펙 9 갱신 |
| 8 | CFR+ 5,000 **수용** | 실측 exploitability 1e-7 급, 4배 반복 대비 L∞ < 0.01 테스트 있음 |
| 9 | `.claude/launch.json` **수용** | 내 브라우저 검증에 그대로 썼다 |

## 6. 알려진 한계 7건

| 항목 | 판정 |
|---|---|
| DCFR 샘플 없음 → 어댑터 없음 | 수용 (6.3 규칙 그대로). `fixtures/README.md` 의 표가 정확하다 |
| 외부 시드 0 | 수용 (P2 게이트 정의) |
| 구조/도메인 결함 분리 보고 | 수용. 모양이 틀린 파일에서 도메인 에러를 뿜으면 오히려 소음 |
| CFR+ 평균 잔차 | 수용. |EV|>0.05 인 클래스의 잔차 최대 1.2e-5 실측. MINOR 5 (P3 정의) |
| `chart_set.id` 비-AUTOINCREMENT | **수용 + P3 반영 확정.** 스펙 4.3 에 "영구 식별자 = `content_hash`" 명시. P3 기록 테이블은 `content_hash` 를 저장하고 `id` 는 API 핸들. 지금 스키마를 바꾸지 않는다 (DB 는 산출물이라 바꿔도 싸지만, 바꿀 이유가 없다) |
| 300줄 초과 3파일 | 수용 (MINOR 7) |
| reach 모드 우측 패널 | 수용 (MINOR 3) |

## 7. P4 스파이크 판정

- **워크어라운드 2개가 P4 를 위험하게 만드는가 — 아니다, 단 문서가 틀렸다 (MAJOR 3).**
  - ① bincode rc.3 핀: 원인은 상류 lock 이 아니라 `"2.0.0-rc.3"` 요구의 semver 해석. 해결은 **우리 크레이트의 커밋된 `Cargo.lock` + `--locked`**. rc.3 은 yanked 가 아니다 (`cargo update --precise` 성공). 위험: 낮음. 포크해서 `Cargo.toml` 을 `=2.0.0-rc.3` 로 바꾸는 것도 동등.
  - ② `-A dangerous_implicit_autorefs`: 2023 코드가 1.98 의 deny-by-default 린트에 걸린 것. 동작은 당시 컴파일러와 동일하고 린트는 잠재적 UB 패턴 경고이지 miscompile 이 아니다. 위험: 낮음. 정공법은 포크에서 3곳 수정 (AGPL, 배포 없음 — D2 의 프로세스 경계 유지).
  - **P4 스펙에 반영할 것**: (1) 래퍼 크레이트에 `rust-toolchain.toml`(stable 1.98 고정) + 커밋된 `Cargo.lock` + 빌드 스크립트에 `RUSTFLAGS` 또는 포크 패치 — 셋 다 레포 안에 명시적으로. (2) `cargo tree -i windows-sys` 빈 것을 CI 게이트로 (UNCERTAIN 2). (3) EV 기준점은 내부 노드 프로브로 확정 (UNCERTAIN 1). (4) `--no-modify-path` 스크래치 설치를 영구 설치로 — `CARGO_HOME` 위치를 P4 스펙이 정한다. (5) DCFR 은 쓰지 않는다 (검증 이력 없음 + 빌드 실패; 7.2 표의 "조건부 가능" 을 "보류" 로).
- EV 단위 해소 주장: 논리는 맞다 (Σ EV = starting_pot 은 "회수 − 노드 이후 투입" 정의를 특정한다). 단 루트 측정이라 UNCERTAIN 1.

## 8. 새 테스트 175개 품질

- **chart-gen 21**: 동어반복 아님. `nashConvOf` 가 w(h,v)·지불식을 core 에서 다시 유도해 파일 전략의 NashConv 를 잰다 (생성기 행렬이 틀리면 잡힌다). "혼합 클래스는 무차별" 테스트는 균형 정의를 반대 방향에서 확인하고 `mixedSeen ≥ 6` 으로 공허 통과를 막는다. EV 정의식 재계산 2종, 4배 반복 수렴, 결정성, AA/KK 순수, 단조, 72o 0%. 에퀴티 표: 기준 4개, 대칭 28,561 셀, sha256, 시드 충돌 0.
- **preflop 45**: 검증 실패 11종이 각각 `path`/`reason` 까지 단언. 블롭 테스트가 코덱을 우회해 `DataView` 로 읽는다. 왕복 바이트 동일 2종. `id` 재사용을 **테스트로 고정**한 것은 좋다 (성질을 숨기지 않음).
- **server 44 (+13)**: `queryParam` 8 케이스, 404/400 코드, `%2D` 동치. 빠진 것: `%zz` (MAJOR 2).
- **web 57 (+16)**: `chartGrid.test.ts` 의 3.5 집계가 손 계산 (1.25/1.75) 으로 단순 평균(2/3)과 다름을 못 박는다 — D14 관점에서 핵심 테스트. `ChartsPage.test.tsx` 는 실제 생성기 산출물(`fixtures/hu-pushfold-10bb.json`, `data/charts` 와 sha256 동일)을 core 로 전개.
- **chart-import 8**: 자식 프로세스 실행. 단 `dist` 전제 (MAJOR 1).

## 9. R2 에서 확인할 것

MAJOR 1~3 수정 + MINOR 1 (한 줄). R2 리뷰는 fresh clone `ci`, `%zz` 400, 스파이크 문서 정정만 본다. 통과 시 APPROVED + `docs/specs/P3.md` 작성. P3 스펙에 들어갈 결정(미리 고지): 스팟 = (chart_set `content_hash`, seq, hero 콤보), `graded_by` = `has_ev ? 'ev' : 'frequency'` (D8), 혼합 정의 = min 빈도 ≥ 0.01, EV loss = max_a EV[a][c] − EV[chosen][c] (3.3 기준이라 폴드 0 과 직접 비교 가능), 히어로 콤보 샘플 = `reach_hero` 가중 (3.4), 기록 테이블은 `content_hash` 참조.
