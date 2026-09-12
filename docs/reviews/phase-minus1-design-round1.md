# Phase -1 (설계 검증) — Round 1 리뷰

리뷰 대상: `C:\workspace\GGTO\DESIGN.md` (코드 없음)
리뷰어: ggto-architect
날짜: 2026-09-11

## VERDICT: CHANGES_REQUIRED

설계의 골격(프리플랍=데이터 / 포스트플랍=연산, 1326 계산 / 169 표시, 캐시 1급, 트레이너가 종착지)은 유지한다.
그러나 (1) 스택 전제(Rust)가 이 환경과 맞지 않고, (2) 캐시 키가 되는 액션 시퀀스 문자열 문법이 그 자체로 모호하며, (3) f16 정밀도 주장이 수치적으로 틀렸고, (4) P3 트레이너의 채점 규칙이 P2 데이터로는 실행 불가능하다. 이 네 가지가 고쳐지기 전엔 P0 착수 외의 어떤 페이즈도 시작하면 안 된다. P0는 본 리뷰와 함께 작성한 `docs/specs/P0.md`로 즉시 착수 가능하다 (P0는 아래 결정 중 어느 것에도 의존하지 않도록 스펙을 잘라냈다).

---

## 검증한 것 (실행 근거)

| 항목 | 방법 | 결과 |
|---|---|---|
| 환경 | `cargo`/`rustc`/`rustup`/`wasm-pack`/`cl`/`gcc`/`clang` 탐색 | 전부 NOT FOUND. `/usr/bin/link`은 coreutils link이지 MSVC 링커가 아님. `Program Files (x86)\Microsoft Visual Studio\2017` 디렉터리는 비어 있고 `VC\Tools\MSVC` 없음. Windows Kits 10 SDK만 존재 |
| 하드웨어 | `Get-CimInstance Win32_OperatingSystem/Processor` | RAM 15.9GB (free 9.7), i5-9400F 6C/6T, C: free 208GB |
| Node 24.14 내장 기능 | `node -e` | `Float16Array` = function, `Math.f16round` = function, `zlib.zstdCompressSync` = function, `node:sqlite` DatabaseSync 동작 (ExperimentalWarning 출력), `SharedArrayBuffer`/`worker_threads` 사용 가능 |
| f16 오차 | `Math.f16round` | 99.987 → 100.0 (오차 0.013), 12.8 → 12.796875 (0.0031), 3.41 → 3.41015625. 64~128 구간 ULP = 0.0625 |
| wasm-postflop 배포 형태 | GitHub releases 페이지 fetch | **"There aren't any releases here"**. 릴리스 0개, 사전 빌드 wasm 없음 |
| wasm-postflop package.json | raw fetch | `"private": true`, 스크립트 `wasm:range/tree/solver-st/solver-mt` 가 `wasm-pack` + Rust **nightly** 호출. npm publish 불가 패키지 |
| wasm-postflop README | raw fetch | 빌드 요구: `rustup install nightly`, `rust-src`, `wasm32-unknown-unknown`, `cargo install wasm-pack`. "As of October 2023 ... suspend development" |
| npm 레지스트리 | `registry.npmjs.org/-/v1/search?text=postflop` | 관련 패키지 0개 (bitval 1개, 무관) |
| crates.io | `crates.io/api/v1/crates/postflop-solver` | **404**. 크레이트 미공개 → git 의존성으로만 사용 가능 |
| postflop-solver Cargo.toml | raw fetch | v0.1.0, license `AGPL-3.0-or-later`, deps: once_cell, regex, rayon(opt, default), bincode 2.0.0-rc.3(opt, default), zstd 0.12(opt, **비기본**). `rust-version` 미지정. `custom-alloc` 만 nightly |
| desktop-postflop releases | fetch | v0.2.7 (2024-10-01), "This is the last release I will be making" |
| wasm-postflop.pages.dev | index/bundle grep | 해시 이름의 webpack 번들 하나 + `.module.wasm` 동적 로딩. 추출은 가능하나 버전 고정/재현 불가 |
| 플랍 동치류 | `scratchpad/flops.js` (24 슈트 순열 전수) | **22,100 → 1,755** 확인. 클래스 크기 분포 {4: 299, 12: 1170, 24: 286}, 합 22,100. 턴 270,725 → **16,432**. 리버 2,598,960 → **134,459** (`river.js`, 19s) |
| 콤보/핸드클래스 | 동일 스크립트 | 1326 콤보, 169 클래스, 분포 {6: 13, 4: 78, 12: 78} |
| 핸드 평가기 검증 | `scratchpad/evalcheck.js` | 5장 전수 2,598,960 → 카테고리 분포 [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40] 정확 일치. 휠 < 6-high 확인 |
| 에퀴티 정답값 (전수 열거) | `scratchpad/equity.js` | 아래 표 참조. 스펙에 박은 수치는 전부 이 열거 결과 |

### 전수 열거로 확정한 에퀴티 (P0 테스트 정답값)

프리플랍은 레인지 평균 (충돌 콤보 제외, tie는 절반 배분), 각 매치업당 C(48,5)=1,712,304 보드 전수.

| 매치업 | 히어로 에퀴티 | 매치업 수 | 콤보별 최소~최대 |
|---|---|---|---|
| AA vs KK | **81.946%** | 36 | 81.26 ~ 82.64 |
| AKs vs 22 | **49.893%** | 24 | 49.70 ~ 50.08 |
| AKo vs 22 | **47.351%** | 72 | 46.96 ~ 47.74 |
| AKo vs QQ | **43.242%** | 72 | 42.84 ~ 43.65 |
| AKs vs QQ | **46.049%** | 24 | 45.88 ~ 46.21 |
| 72o vs AA | **11.800%** | 72 | 11.02 ~ 12.58 |
| JTs vs AA | **21.160%** | 24 | 20.60 ~ 21.72 |
| AA vs AKs | **87.859%** | 12 | 87.86 ~ 87.86 (tie 1.256%) |
| AsAh vs KsKd (특정) | 81.946% | 1 | — |
| AsAh vs KsKh (특정) | 82.637% | 1 | — |
| AsAh vs KdKc (특정) | 81.256% | 1 | — |

플랍/턴 (특정 콤보, 전수):

| 상황 | 히어로 에퀴티 | 근거 |
|---|---|---|
| AhKh vs 2c2d on QhJh2s | **33.838%** (335/990) | 손으로 재검산: 2h·페어링 하트는 빌런 쿼드/보트 → 335 정확 |
| AsAd vs KsKd on Kh7c2d | **8.586%** (85/990) | 2아웃 87보드 − A+K 쿼드 2보드 = 85 |
| AsKs vs QhQd on JsTs2c | **56.061%** (555/990) | — |
| AsKs vs QhQd on JsTs2c9d | **29.545%** (13/44) | — |
| 5s4s vs AhAd on 3c2d7h | **23.838%** (236/990) | — |

**주의**: `.claude/agents/ggto-architect.md` 에 적힌 "AKs vs 22 ≈ 46.0% / 54.0%" 는 **틀렸다**. 실제 49.9/50.1 이다. 46.0/54.0 은 **AKs vs QQ** 의 값이다 (라벨 오류). AKo vs 22 도 47.4 이지 46.0 이 아니다. 이 수치를 그대로 두면 정답 구현을 리뷰에서 반려하게 된다. 에이전트 정의 파일은 설정이므로 내가 고치지 않는다 — 오케스트레이터가 수정하라. (AA vs KK 81.9, AKo vs QQ 43.2 는 맞다.)

---

## 쟁점 1 — 스택 최종 판정: **하이브리드 (TypeScript 본체 + P4 한정 Rust CLI 데몬)**

### 오케스트레이터 잠정안에 대한 판정: 결론은 동의, 근거 하나는 기각

> "wasm-postflop이 이미 사전 빌드된 WASM을 제공하므로 Rust 툴체인 없이도 통합 가능하다"

**사실이 아니다.** 검증 결과:
- GitHub releases 0개. npm 미공개 (`private: true`). crates.io 미공개.
- 빌드하려면 rustup **nightly** + `rust-src` + `wasm32-unknown-unknown` + `wasm-pack` 이 필요하다. 이건 stable rustup보다 더 무거운 요구사항이다.
- 유일한 "사전 빌드" 산출물은 `wasm-postflop.pages.dev` 에 배포된 해시 이름의 webpack 번들 내부의 `.module.wasm` 뿐이다. Vue 앱 glue 코드와 엉켜 있고, 버전 고정도 재현도 안 된다. 의존성으로 삼을 수 없다.

따라서 "Rust 설치 없이 전 페이즈 완주"는 **불가능**하다. P4에서는 어떤 경로든 Rust 툴체인이 필요하거나, 아니면 솔버를 TS로 새로 써야 한다.

### 세 가지 선택지 비교

| 선택지 | 비용 | 얻는 것 | 판정 |
|---|---|---|---|
| **A. 전부 TypeScript (솔버도 TS 자작)** | DCFR + 슈트 동형 + 번칭 + 압축 저장을 TS로 재구현. 6코어 i5, SIMD 없음, worker_threads 병렬화 수동. 현실적으로 Rust 엔진 대비 10~30배 느림 | 툴체인 0 | **기각.** 검증된 엔진이 AGPL로 있는데 학습용도 아닌 앱에서 다시 쓰는 건 DESIGN 1의 "직접 CFR 구현 안 함" 결정과 정면 충돌 |
| **B. DESIGN.md 원안 (전부 Rust: Axum + rusqlite + rust-embed)** | rustup + (MSVC면 VS Build Tools ~수 GB) + Axum/tokio/rusqlite 학습·컴파일 시간. ggto-dev 에이전트 정의는 이미 TS 전제(`npm run typecheck`, Float32Array) | 단일 프로세스, FFI 0 | **기각.** P0~P3 연산은 1326 float 배열 조작이라 TS로 충분 (아래 근거). Rust 전환은 P4 이전 3개 페이즈 전체를 비싸게 만들면서 얻는 게 없다 |
| **C. 하이브리드: TS(Node 24) 본체 + P4에서 Rust CLI 데몬** | P4 시작 시 rustup stable 설치 (GNU 호스트면 VS 불필요). `ggto-solver-cli` 소형 크레이트 하나 | P0~P3, P5~P6 전부 TS. 솔버는 프로세스 경계 뒤 → AGPL 경계와 `Solver` 인터페이스 추상화가 자연스럽게 일치 | **채택** |

### 채택안 상세 (DESIGN.md 1~2절을 이걸로 교체하라)

- **언어/런타임**: TypeScript strict, Node 24 (ESM). npm workspaces 모노레포: `packages/core`, `packages/server`, `packages/trainer`, `packages/preflop`, `web/`, `tools/`.
- **서버**: Node HTTP (Fastify 또는 Hono — 개발 에이전트 선택, 단 SSE 지원 확인). 포트 7777 유지.
- **DB**: `node:sqlite` (Node 24 내장, 네이티브 빌드 불필요 — 검증 완료. ExperimentalWarning은 감수). 저장소 접근은 얇은 인터페이스 뒤에 두어 `better-sqlite3` 로 교체 가능하게.
- **압축**: `node:zlib` zstd (검증 완료). 별도 패키지 불필요.
- **해시**: `node:crypto` sha256. blake3 의존성 불필요.
- **프론트**: DESIGN 원안 유지 (Vite + React 19 + TS + Zustand + TanStack Query + Tailwind + Canvas 격자).
- **솔버 (P4)**: Rust 크레이트 `solver/ggto-solver-cli` 하나만. `postflop-solver = { git = "...", rev = "<커밋 고정>" }`, default features (bincode, rayon). **`zstd` feature는 켜지 마라** — C 컴파일러가 필요해진다. 압축은 Node 쪽 zstd로. 실행 형태는 **일회성 CLI가 아니라 상주 데몬**: Node가 child_process로 띄우고 stdio JSON-lines RPC (`solve`, `progress` 이벤트, `cancel`, `load_game`, `get_node`, `unload`). 이유: 5.3의 노드 단위 lazy 조회를 위해서는 솔브 결과(수백 MB~GB)가 Rust 프로세스 메모리에 올라가 있어야 하고, 매 요청마다 bincode 파일을 다시 읽는 건 불가능하다. 데몬이 로드된 게임을 LRU(메모리 상한)로 관리한다.
- **Rust 설치 경로**: `rustup-init.exe --default-host x86_64-pc-windows-gnu` (MSVC 링커 없음 확인됨 → GNU 호스트가 VS Build Tools 없이 동작하는 유일한 경로). postflop-solver 기본 feature 의존성(once_cell, regex, rayon, bincode)은 전부 순수 Rust라 C 컴파일러 불필요. **이건 UNCERTAIN 항목이다** — P4 착수 전 스파이크로 `cargo build --release --example basic` 성공을 증명해야 한다. 실패하면 VS Build Tools C++ 워크로드(MSVC) 설치가 대안.
- **TS로 P4~P5에서 실제로 부딪히는 벽** (하이브리드에서 해소되는지 명시):
  - 솔브 연산 자체: Rust 데몬으로 해소.
  - 결과 메모리(GB): Rust 데몬 메모리로 해소. Node는 노드 하나(수십 KB)만 받는다.
  - wasm32 4GB 힙 상한: wasm을 쓰지 않으므로 무관. (memory64는 postflop-solver가 쓰지 않는다.)
  - 1326×1326 연산(레인지 vs 레인지 에퀴티, 플랍 이후): 런아웃당 1326 평가 + 정렬 → 990 × ~15k ops, TS로 수백 ms. 문제 없음. 프리플랍 레인지 vs 레인지는 1.7M 보드 × 1326 이라 TS 전수는 불가 → 몬테카를로 (P0 스펙에 명시).
  - UI 스레드: 서버가 집계하므로 프론트는 1326 float 디코드만 한다. DESIGN 1의 "TS 풀스택이면 UI가 멈춘다"는 근거는 틀렸다 — UI는 한 번에 노드 하나만 본다.

### 라이선스 (DESIGN.md에 명시할 것)

- `postflop-solver`, `wasm-postflop`, `desktop-postflop` 모두 **AGPL-3.0-or-later**. Cargo.toml에서 직접 확인.
- 개인 로컬 사용(배포 없음, 제3자 네트워크 서비스 없음)에는 AGPL 의무가 발동하지 않는다.
- 단, GGTO를 배포하거나 남에게 네트워크로 열면 솔버와 링크된 부분은 AGPL이 된다. 솔버를 **별도 프로세스 + 별도 Cargo 프로젝트**로 격리하는 것이 이 경계를 명확하게 유지하는 방법이고, 하이브리드안이 이걸 자연스럽게 만족한다. DESIGN 9 "솔버 크레이트에 종속" 항목에 이 사실을 추가하라.
- 개발 중단(2023-10) + 마지막 릴리스(2024-10). `rev` 고정 + `rust-toolchain.toml` 로 툴체인 고정 필수.

---

## 쟁점 2 — DESIGN.md 결함

### CRITICAL

1. **[3.3] 액션 시퀀스 문자열의 구분자 `.` 가 소수점 `.` 와 충돌한다.**
   `"F.F.R2.5.F.F.C3R11.C"` 를 `.` 로 토크나이즈하면 `R2.5` 가 `R2`, `5` 로 쪼개진다. 이 문자열은 캐시 키·URL·DB 유니크 컬럼이다. 파싱이 모호하면 키가 모호하다. 또 `C3R11` 이 "콜 3 후 레이즈 11"인지 무엇인지 정의가 없다.
   → 액션 구분자를 `-` 로, 스트리트 구분자는 `/` 유지. 액션 토큰은 `F | X | C | B<amt> | R<amt> | A`, 금액은 정규 소수 표기(후행 0 금지, `2.5`, `11`, `0.5`). 액션은 **발생 순서대로 한 토큰씩**, 누가 행동하는지는 게임 상태 기계가 결정하므로 문자열에 포지션을 넣지 않는다. 예: 6max UTG F, HJ F, CO R2.5, BTN F, SB F, BB R11, CO C → `F-F-R2.5-F-F-R11-C`. 파서는 **정규형만** 받아들이고(대소문자, `R2.50`, 빈 토큰 거부) `format(parse(s)) === s` 를 보장한다. 정확한 문법은 `docs/specs/P0.md` 4.7에 확정해 두었다.

2. **[6.2 + 4.2 + 8] P3 트레이너는 "EV loss로만 채점"하는데, P2에서 확보 가능한 공개 프리플랍 차트에는 EV가 없다.**
   4.1 스키마도 `ev BLOB` 을 nullable("있으면")로 두고 있다. 즉 설계 스스로 EV 부재를 인정하면서 채점은 EV 전제다. P3가 "매일 켜는 앱"이 되는 마일스톤인데 실행 불가능한 규칙이다.
   → 6.2에 **EV 없는 노드의 채점 규칙**을 명시하라. 권장: `ev` 가 NULL이면 빈도 기반 판정으로 강등하되 결과에 `graded_by: 'ev' | 'frequency'` 를 반드시 붙이고, 빈도 기반은 "선택 액션의 GTO 빈도 ≥ 임계(예: 10%) 면 Acceptable, 0% 면 Mistake" 처럼 **정오 이분법이 아닌** 규칙으로. 리포트에서 두 종류를 섞어 합산하지 않는다. 이건 "빈도 일치 채점"이 아니라 "EV가 없을 때의 명시적 폴백"이며, 반드시 라벨링된다는 점이 조건이다.

### MAJOR

3. **[9 리스크표, 4.1, 5.3] "f16 오차 ~0.001bb" 는 틀렸다.**
   IEEE f16은 유효숫자 ~3.3자리. `Math.f16round(99.987) = 100.0` (오차 0.013), 64~128 구간 ULP 0.0625bb. 두 EV의 차(EV loss)는 최악 0.06bb 오차 → Perfect 임계 0.05bb와 같은 크기. **EV는 f32로 저장/전송하라.** 비용: 노드당 5×1326×4B = 26KB (zstd 후 더 작음). 전략(0~1)은 f16도 무방하지만 통일해서 f32로 가는 게 단순하다. 참고: postflop-solver의 "압축 모드"는 IEEE f16이 아니라 u16/i16 고정소수점 + 스케일이며 **엔진 내부 저장용**이다. 결과 getter는 f32를 돌려준다. DESIGN의 "f16" 은 그 내부 포맷과 API 전송 포맷을 혼동한 것이다.

4. **[5.3] base64 f16 전송.** Node 24 / 현행 Chrome·Firefox·Safari 는 `Float16Array` 를 네이티브 지원한다 (Node에서 검증). 따라서 "JS에 f16이 없다"는 반박은 2026년 기준 무효이나, 3번에 의해 어차피 f32다. base64-in-JSON은 33% 팽창 + 이중 파싱이므로 블롭은 `application/octet-stream` 바이너리 엔드포인트로 보내고, 메타데이터만 JSON으로. (당장 구현 단순성을 위해 base64를 쓴다면 MINOR로 격하 가능하되, 포맷을 f32 LE로 명시.)

5. **[4.1] 프리플랍 스키마 부족분.**
   - `chart_set` 에 **`positions TEXT` (JSON 배열, 액션 순서)** 가 없다. `table_size=6` 만으로는 9max/8max 포지션 명명·순서를 정할 수 없고, 액션 시퀀스 해석 자체가 이 순서에 의존한다.
   - 스트래들·앤티 모델 없음: `blinds TEXT` (JSON `[{pos, amount}]`, 스트래들은 여기 추가 항목), `ante_mode TEXT ('none'|'per_player'|'bb_ante')` 추가.
   - `resolution TEXT ('169'|'1326')`: 공개 차트는 거의 169 해상도다. 169→1326 균등 전개 후 저장하되, 원본 해상도를 기록해야 "콤보별 분해" UI가 가짜 정보를 보여주지 않는다.
   - **EV 기준점 정의 없음.** "Fold 0.00bb" 로 표시하려면 "EV = 노드 시점 이후의 기대 스택 변화 (이미 넣은 칩은 매몰)" 로 정의를 박아야 한다. 솔버/차트 출처마다 기준이 다르다. 임포터가 이 기준으로 변환한다.
   - 도달 레인지(reach range)가 없다. 트레이너의 콤보 출제 확률과 포스트플랍 솔브의 입력 레인지 둘 다 이걸 요구한다. 루트부터 경로상 전략을 곱해 파생하면 되지만, **파생 규칙과 그 API(`GET /api/charts/{set}/range?seq=...&pos=...`)** 가 설계에 없다. 7절에 추가하라.
   - `UNIQUE(chart_set_id, action_seq)` 가 이미 인덱스를 만든다. `idx_pf_lookup` 은 중복. (MINOR)
   - 멀티웨이/스퀴즈/콜드콜/BvB: 1번 항목의 "발생 순서 토큰 + 상태 기계" 방식이면 전부 표현된다. 스키마 자체는 충분하나, 상태 기계(다음 액터, 팟, 합법 액션)가 core에 있어야 임포터가 `hero_pos`/`pot_bb`를 검증할 수 있다. P0 스펙에 넣었다.

6. **[6.2] EV loss 채점 규칙의 구멍.**
   - 임계값이 절대 bb 고정(0.05/0.3/1.0). 6bb 팟과 200bb 팟에서 같은 잣대는 틀리다. **팟 대비 %** 를 기본으로 하고 bb는 병기하라 (예: Perfect < 1% pot, Minor < 3%, Mistake < 8%, 그 외 Blunder — 값은 제안이지 확정 아님).
   - 미수렴 솔브에서 빈도 0 액션의 EV가 혼합 액션보다 **높게** 나오는 CFR 아티팩트가 흔하다. 그러면 "최적 액션 EV − 내 액션 EV" 가 음수가 된다. 규칙: baseline = 모든 액션 EV의 max, loss = max(0, baseline − chosen), 그리고 솔브의 exploitability 상한(예: 0.5% pot)을 채점 자격 조건으로 명시.
   - 콤보 출제 확률: `hero_combo` 는 그 노드의 **히어로 도달 레인지 × 카드 제거** 로 샘플해야 한다. 균등 샘플이면 이미 폴드했을 핸드를 출제한다. 6.3의 "실전빈도" 도 손으로 정하는 게 아니라 도달 확률에서 계산된다고 명시하라.

7. **[5.1] 캐시 키에 레인지 순열이 빠져 있다.** "보드 동형 정규화 → canonical config" 라고만 되어 있는데, `SuitMap` 을 **두 레인지에도 동일하게 적용**한 뒤 해시해야 한다. 보드만 정규화하고 레인지는 원본이면 Ks7h2h + (AsKs 100%) 와 Kd7s2s + (AsKs 100%) 가 같은 키를 받는다 — 다른 게임이다. 또 `accuracy` 는 해시에서 빼고 메타데이터에 두어 "캐시된 정확도 ≥ 요청 정확도" 면 히트로 처리하라.

8. **[3.4] "슈트 비대칭이면 정규화 불가 → 원본 그대로" 는 과하게 보수적이고 구현도 애매하다.** 올바른 규칙: 두 레인지를 모두 불변으로 두는 슈트 순열의 부분군(stabilizer)만 사용해 그 안에서 최소 보드를 고른다. 대칭 레인지면 24개 전부(=1,755), 완전 비대칭이면 항등 순열 하나(=원본), 부분 대칭이면 그 사이. "포기" 분기가 없어지고 항상 같은 코드 경로다. P0 스펙에 이 정의로 박았다.

9. **[7] 빠진 API/기능.**
   - 프리플랍 라인 → 도달 레인지 (5번). 포스트플랍 솔브의 입력 레인지가 프리플랍 차트와 연결되지 않으면 탐색기·트레이너 스팟이 전부 손으로 레인지를 넣는 도구가 된다.
   - 노드 응답에 **콤보별 에퀴티** (`equity: f32[1326]` × 2). 5.3의 `equity: {oop: 0.54}` 는 집계값만이고, 격자의 "에퀴티 모드"와 EV 해석에 콤보별 값이 필요하다. postflop-solver가 제공한다.
   - 레이크: postflop-solver는 `rake_rate`/`rake_cap` 을 지원한다. 캐시 100bb에서 레이크는 전략을 바꾼다. 솔브 config에 포함하고 해시에 넣어라. 10.2 "레이크 모델" 결정과 연결.
   - 레인지 편집기: 5.4 UI에 `[범위 편집]` 이 있는데 어디에도 스펙이 없다. 파서/포매터(P0)만 있으면 클라이언트 텍스트 편집으로 시작할 수 있다. P5 스펙에 넣어라.

### MINOR

10. [1] "TS 풀스택: 1326 × 트리노드 순회를 JS로 하면 UI가 멈춤" — 근거가 틀렸다 (UI는 노드 하나씩 본다). 스택 교체와 함께 삭제.
11. [9] "전략 블롭을 Web Worker에서 디코드" — 1326 float 디코드는 마이크로초 단위. 불필요. 삭제.
12. [5.2] 세마포어 2 + 16GB RAM: 동시 잡의 **예상 메모리 합 ≤ 8GB** 같은 실제 게이트가 필요하다. 개수 세마포어만으론 OOM을 못 막는다.
13. [3.1] `Card(u8)`: rank = card/4, suit = card%4 는 유지 (TS에서도 `card >> 2`, `card & 3`). `Combo(u16)` 인덱스 공식이 미정 — P0 스펙에서 `hi*(hi-1)/2 + lo` 로 확정.
14. [4.3] 169 격자 배치 규칙(수티드가 우상단, 오프수트가 좌하단, 행/열 0=A)이 문서에 없다. P0 스펙에 확정.

---

## 쟁점 3 — 로드맵 순서

P0 → P1 → P2 → P3 → P4 → P5 → P6 순서 자체는 맞다. "P4 전에 앱이 자립"하는 논리는 유효하다. 다만 세 가지를 바꿔라:

1. **P0 범위에 액션 시퀀스 파서/포매터 + 프리플랍 상태 기계를 포함**한다 (DESIGN 2의 ggto-core 책임에 이미 "액션 트리 타입"이 있다). 이게 캐시 키라서 P2 이후에 바꾸면 전부 마이그레이션이다.
2. **P2 착수 조건**: `ggto-json` 차트 포맷 정의 + 출처 명시된 시드 차트(최소 6max RFI 6포지션) 확보. 데이터가 없으면 P2·P3는 스텁으로 흐른다. 10.3 항목을 "P2 게이트"로 승격.
3. **"P4-스파이크"를 P2 기간 중에 병행**: rustup(GNU 호스트) 설치 → `postflop-solver` 클론 → `cargo build --release --example basic` 성공 확인. 30분짜리 일이지만 실패하면 P4 계획(MSVC 설치 or 다른 경로)이 바뀌므로 P3 끝나고 알면 늦다.
4. P1은 작으므로 그대로 두되, "169 격자가 뜬다"의 데이터는 P0의 파서 출력(예: `"22+,A2s+,KTo+"`)이어야 한다. 하드코딩 격자로 통과시키지 않는다.

---

## CRITICAL (요약)
1. [DESIGN 3.3] 액션 시퀀스 구분자 `.` ↔ 소수점 충돌. 캐시 키 모호. → 문법 교체 (P0 스펙 4.7 문법으로).
2. [DESIGN 6.2/4.2/8] EV 없는 프리플랍 차트로 P3 EV-loss 채점 불가. → 라벨링된 폴백 규칙 명시.
3. [DESIGN 1/2] Rust 전제가 환경과 불일치 + "사전 빌드 wasm" 전제가 사실이 아님. → 하이브리드 스택으로 1~2절 재작성.

## MAJOR (요약)
3~9번 항목 (f16 정밀도/전송 포맷, 프리플랍 스키마 보강, 채점 규칙 구멍, 캐시 키에 레인지 순열, stabilizer 정규화, 빠진 API).

## MINOR (요약)
10~14번 항목.

## UNCERTAIN (증명 필요)
- **rustup GNU 호스트로 postflop-solver 기본 feature 빌드가 이 PC에서 C 컴파일러 없이 성공하는가.** 의존성 목록상 순수 Rust지만 실제 빌드로 증명해야 한다. P2 기간 중 스파이크. 실패 시 VS Build Tools(C++ 워크로드) 설치로 전환.
- `node:sqlite` 가 Node 24.14에서 ExperimentalWarning을 내는데, BLOB 바인딩/트랜잭션/WAL이 P2 요구를 충족하는지는 P2에서 실제 스키마로 증명. 인터페이스 뒤에 두면 교체 비용은 작다.
- postflop-solver의 노드 EV/전략/에퀴티 getter가 "현재 플레이어 관점 f32" 를 어떤 단위(칩? 팟 대비?)로 주는지 — P4 스파이크에서 examples 실행 결과로 확인. 6.2 EV 기준점 정의와 맞춰야 한다.

## 다음 단계
VERDICT가 CHANGES_REQUIRED이므로 DESIGN.md 개정이 필요하지만, **P0는 위 결정에 의존하지 않도록 스펙을 잘라냈으므로 즉시 착수 가능**하다. `docs/specs/P0.md` 를 ggto-dev에게 그대로 넘겨라. DESIGN.md 개정(1, 2, 3.3, 3.4, 4.1, 5.1, 5.3, 6.2, 7, 9절)은 P0 진행과 병행하고, 개정본을 Round 2로 다시 검토한다.
