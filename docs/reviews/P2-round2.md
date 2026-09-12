# P2 리뷰 — 라운드 2

리뷰어: ggto-architect. 날짜: 2026-09-11. 대상: R1 MAJOR 1~3 + MINOR 1 수정분, 벤치 게이트 판정. 스펙 `docs/specs/P2.md` (본 라운드에서 **R3 개정** — 10절, DoD 1, 1절 데이터 경로, 개정 이력).
스크래치: 세션 스크래치패드 `fresh/`, `fresh-ci.log`, `fresh-ci2.log`, `rethrow.mjs`, `cpu-vs-wall.mjs`, `loadprobe.mjs`, `semver-repro/`, `gitign/`, `server.log`, `arch-p2/` (R1 스크립트 재실행).
**측정 환경: 리뷰 내내 사용자 게임 중** (`OP.GG` ×4, `Riot Client`, `League of Legends`, `LeagueClientUxRender`). `Get-CimInstance` LoadPercentage 시작 83, 이후 31~85 를 오갔다. 6코어.

## VERDICT: CHANGES_REQUIRED

CRITICAL 0, **MAJOR 2 (신규 #4, #5)**, MINOR 3 (신규), UNCERTAIN 0. R1 MAJOR 1~3 + MINOR 1 은 **전부 수정 확인**. 남은 MAJOR 는 `.gitignore` 한 글자와 (스펙 개정에 따른) 벤치 게이트 구현이며, R3 는 그 둘만 본다. R3 통과 시 APPROVED + `docs/specs/P3.md`.

## 검증한 것 (실행 근거)

| 항목 | 방법 | 결과 |
|---|---|---|
| **fresh clone `ci` #1** | 소스만 tar 복사(`node_modules`/`dist`/`data`/`.git` 제외) → `npm install`(exit 0, LoadPercentage 51→49) → `npm run ci` (`fresh-ci.log`) | **exit 1** — chart-gen `equityTable.test.ts`/`pushFold.test.ts` 가 `ENOENT tools/chart-gen/data/equity169.json`. **내 `--exclude=data` 가 그 파일까지 뺀 것** — 개발 에이전트 결함이 아니다. 단 이것이 실제 `git clone` 이 하는 일과 정확히 같다는 것이 아래 MAJOR 4 |
| **fresh clone `ci` #2** | `equity169.json` 복원 후 `npm run ci` (`fresh-ci2.log`, LoadPercentage 49→39) | **exit 0.** core 125 / preflop 45 / server 45 / web 57 / chart-gen 21 / chart-import 8 = **301** (보고와 일치). chart-import CLI 8/8 (`pretest` 가 `build:tools` 를 돌림 — MAJOR 1 해소). preflop bench importSet 10.1 / getNode **145.5** / reach **120.3** ms, core bench 5/5, smoke 9/9 |
| **MAJOR 2 — 실제 HTTP** | 메인 레포 `packages/server/dist/main.js` 를 7777 에 띄우고 (dist 16:19 > src 16:04, `percent-encoding` 문자열 존재 확인) curl 20 URL (`server.log`) | `?seq=%zz` / `range?seq=%zz&pos=SB` / `range?seq=&pos=%zz` / `?seq=%` / `?seq=%E0%A4%A` → **전부 400 BadRequest** "not valid percent-encoding". `node?seq=A&pos=%zz` → 200 (요청한 키만 디코드). 서버 로그에 **스택 0줄** (ExperimentalWarning 뿐) |
| **MAJOR 2 — `URIError` 외 재throw** | `rethrow.mjs`: dist 의 `queryParam` 을 import, `globalThis.decodeURIComponent` 를 `class Boom extends Error` / `TypeError` 던지게 바꿔 호출 | `%zz` → `HttpError 400 BadRequest`. Boom → **`Boom` 그대로 전파** (`PROPAGATED`), TypeError → `TypeError` 그대로. 삼키지 않는다 |
| **MAJOR 2 — 정상 쿼리 회귀** | 같은 서버, 15 URL | `node`(루트/`seq=`/`A`) 200 2×1326 + reach 1326, `A%2DC`=`A-C` 404 MissingNode, `A+C`/`X1` 400 ActionSyntaxError, `range?pos=SB` 합 773.44 / `pos=BB` 합 1326 / `pos=UTG` 400 unknown position / `pos` 없음 400 required, `/charts/99/node?seq=%zz` → **404 NotFound** (id 검사가 쿼리 디코드보다 먼저 — 순서 타당) |
| **R1 `api-check.mjs` 재실행** | API `strategy`/`ev` vs `node:sqlite` 직접 SELECT + `zstdDecompressSync` (코덱 우회), 16 seq 엣지 | **불일치 0**, 히스토그램 동일, reach(A,SB) 58.33%. `%zz` 행이 500 → **400 BadRequest** 로 바뀐 것 외 R1 과 동일 |
| **시드 불변** | `data/charts/*.json` 6개를 R1 백업(`arch-p2/data.bak`) 과 `cmp`; DB `chart_set.content_hash` 6행을 백업 DB 와 `diff`; `npm run seed` 재실행 | 6 파일 **바이트 동일**, 해시 6/6 동일 (`00ffb320…`, `dbf5816f…`, `6c98832e…`, `b02b94d5…`, `0dc9ff95…`, `875bc4a2…`), seed **6/6 SKIP** (`skipped:true`, `same content_hash`) |
| **MINOR 1** | `grep console.log packages/preflop/test/*.ts` + `validate.test.ts:157-165` 읽음 | 0건. `issues.map((i) => i.path).sort()` 가 `['nodes[0].strategy.AKs','nodes[1].strategy.72o']` 를 단언 |
| **MAJOR 3 — 상류 lock 부재** | 내 R1 클론 `spike/pfs` (`9d1509fe…`): `git ls-files \| grep -i cargo`, `.gitignore` | `Cargo.toml` 만. `.gitignore` = `/target`, `Cargo.lock`. 문서 2.1-1 과 일치 |
| **MAJOR 3 — semver 원인 독립 재현** | `Cargo.toml`+`src` 만 새 디렉터리에 복사 → 스크래치 cargo 1.98.1 로 `cargo generate-lockfile` (`semver-repro/`) | `Adding bincode v2.0.1 (available: v3.0.0)`, lock 에 `bincode 2.0.1` / `bincode_derive 2.0.1`. `Cargo.toml` 에 `rust-version`/`resolver` 없음 (edition 2021) — MSRV 인지 해석이 개입하지 않으므로 최대 버전 선택. 문서 2.1-2 와 일치 |
| **MAJOR 3 — crates.io** | `crates.io/api/v1/crates/bincode/versions` | `3.0.0` 존재(yanked 아님, rust_version 1.85), `2.0.1` 존재(1.85), `2.0.0-rc.3` 존재(yanked 아님). 문서의 `(available: v3.0.0)` 는 실제 출력 |
| **MAJOR 3 — 권고안 실동작** | 개발 에이전트 `spike/locked/` 에서 lock sha 기록 → `RUSTFLAGS=-A dangerous_implicit_autorefs cargo build --locked --release --example basic` → lock sha 재확인 | lock 에 `bincode 2.0.0-rc.3`/`bincode_derive 2.0.0-rc.3`. 빌드 exit 0, **lock sha `6d3a616b…` 불변**, `basic.exe` 4,967,473 B (R1 과 동일 크기) |
| **MAJOR 3 — 직교성** | 같은 디렉터리, `RUSTFLAGS` 없이 `touch src/lib.rs` 후 `--locked` 빌드 | `error: implicit autoref creates a reference to the dereference of a raw pointer` ×3. lock 만으로는 린트를 못 넘는다 — 문서의 "직교" 주장 실증 |
| **MAJOR 3 — `cargo tree -i windows-sys`** | 같은 디렉터리 | **`error: package ID specification "windows-sys" did not match any packages`, exit 101.** "비어 있음" 이 아니라 에러다 — MINOR 2 |
| **`.gitignore` 실증** | 임시 `git init` + 레포 `.gitignore` 복사 + `git check-ignore -v` | `.gitignore:3:data/  tools/chart-gen/data/equity169.json` — **무시된다.** MAJOR 4 |
| 변경 범위 | mtime > 15:40 (R1 리뷰 후) 파일 목록 | `package.json`, `charts.ts`, `charts.test.ts`, `validate.test.ts`, `P4-rust.md` (+ 내 `P2.md`/`P2-round1.md`). 보고 범위 밖 변경 없음 |
| **벤치 (부하 하)** | `perf.mjs` ×5, 각 실행 직전 LoadPercentage | 55 / 85 / 55 / 66 / 59 에서 getNode 183.9 / 186.3 / 166.0 / 165.9 / 162.0, reach 131.5 / 133.7 / 125.9 / 122.8 / 121.7 — **5/5 통과** (개발 에이전트 실패는 90~100 구간) |
| **`process.cpuUsage()` 프로토타입** | `cpu-vs-wall.mjs` ×6 (LoadPercentage 31~53) | wall 144~153 / 106~110 로 안정, **cpu 94 / 110 / 140 / 141 로 15.6ms 양자화** (Windows 스케줄러 틱). 정규화 수단 부적합 |
| **`os.cpus()` 델타 프로토타입** | `loadprobe.mjs` ×4: 1.5s 단일 스레드 연산 전후 `times` 합산 | 52.1 / 55.6 / 57.8 / 68.1 % (자기 자신 ≈16.7%p 포함) vs 같은 시각 CIM 35 / 38 / 36 / 52. 포터블하고 벤치 구간 자체를 잰다 |

## 1. R1 MAJOR 1~3 + MINOR 1 — 전부 해소

- **MAJOR 1**: `pretest` = `build:libs && build:tools`. fresh copy `ci` exit 0, CLI 8/8. 해소.
- **MAJOR 2**: 3 엔드포인트 400, 깨진 시퀀스 5종 400, `URIError` 외 예외는 원형 그대로 전파, 정상 쿼리 15 URL 회귀 없음, 스택 로그 0. 회귀 테스트가 단위 2 + 엔드포인트 3 을 실제 `app.request` 로 돈다. 해소.
- **MAJOR 3**: 내가 지적한 세 가지 — (1) 상류 lock 부재 (2) `^2.0.0-rc.3` semver 해석 (3) 툴체인 1.73 고정이 bincode 를 못 고침 — 가 2.1 절에 전부 들어갔고, 각각 `git ls-files`/`.gitignore`/GitHub API, `cargo generate-lockfile`, 논증으로 뒷받침된다. 내가 **독립 재현**한 결과가 전부 문서와 일치한다 (표). 권고안(rc.3 핀 lock 커밋 + `--locked`)이 실제로 빌드되고 lock 이 불변임을 확인했고, lock 없이 `RUSTFLAGS` 만 빼면 린트 3건이 그대로 나므로 "직교" 도 맞다. 시도 2 의 해석("아무것도 증명 못 한다")도 정정됐다. 새로 틀린 서술은 못 찾았다. 단 세부 부정확 2건이 MINOR 2·3. 해소.
- **MINOR 1**: 해소.

## 2. 벤치 예산 판정 — **스펙 10절 R3 로 개정. 예산 수치는 그대로, 집행을 부하로 조건화.**

사실:
- 같은 코드의 getNode 가 LoadPercentage 9 에서 137ms, 55~85 에서 162~186ms, 90~100 에서 304~510ms. 부하가 3.7배까지 늘린다. **포화 상태에서는 어떤 유한 예산도 플레이키하다.**
- 개발 에이전트 제안 (a) 600ms 의 근거 "zstd 2배 저하는 여전히 잡힘" 은 **틀렸다**: 유휴 137 × 2 = 274 < 300 이라 **현행 300 도 2배 회귀를 못 잡는다.** 600 은 4배 회귀(548)까지 통과시킨다. 예산 인상은 게이트의 유일한 목적을 없앤다. 기각.
- 제안 (b) `ci` 에서 제거: 벤치는 `check` 로 결과 정확성(12 노드, 유한값)도 단언하고, 매 `ci` 로그의 수치가 이 프로젝트의 유일한 성능 이력이다. 사람이 유휴 때 돌리는 것은 에이전트가 사용자의 게임 시간을 통제할 수 없으므로 실행되지 않는 규칙이다. 기각.
- 부하 정규화 후보 두 가지를 실측했다. `process.cpuUsage()` 는 Windows 에서 15.6ms 양자화 (94→141 로 튐) — 불가. `os.cpus()` 델타는 포터블·인프로세스·벤치 구간 자체를 잰다 — 채택.

결정 (스펙 10절 R3, 원문 참조): 스크립트가 `os.cpus()` 로 실행 구간의 부하를 재서 JSON `load`/`enforced` 로 찍고, 정확성 `check` 는 항상 exit 1, **예산 초과는 `load ≤ 0.60` 일 때만 exit 1**, 그 위는 `OVER (not enforced: load NN%)` + exit 0. `--strict` 는 무조건 집행 (리뷰어·DoD). runs 3→5. core/preflop 벤치가 하네스 하나를 공유. 예산 500/300/300 불변, 단 "≥2.2배 회귀만 잡는다" 를 명시. DoD 1 의 `Get-CimInstance` 수동 보고 폐지 — 스크립트 `--strict` 출력의 `load ≤ 0.40` 줄로 대체. 임계 0.60 은 내 데이터(측정치 52~68% 에서 wall ≈ 유휴+10%) 기준의 보수값이고 이력이 쌓이면 올린다.

이 구현은 R3 에서 한다 (MAJOR 5). 개발 에이전트가 DoD 1 을 자기 머신에서 만족시킬 수 없는 상태를 P3 까지 끌고 가지 않는다.

## CRITICAL

없음.

## MAJOR (승인 전 수정 필요)

4. **[`.gitignore:3` `data/`] `tools/chart-gen/data/equity169.json` 이 무시된다.** `git check-ignore -v` 실증: `.gitignore:3:data/	tools/chart-gen/data/equity169.json`. 접두 슬래시 없는 `data/` 는 모든 깊이의 `data` 디렉터리에 매치한다. 스펙 7.1 "결과 파일을 커밋", DoD 7 "`equity169.json` 커밋" 이 이 설정으로는 불가능하고, 실제 `git clone` 은 내 fresh #1 과 똑같이 `ci` exit 1 (chart-gen 테스트 2 파일 ENOENT) + `npm run seed` 실패가 된다 — R1 MAJOR 1 과 같은 실패 모드다. 지금 레포에 `.git` 이 없어 아직 터지지 않았을 뿐이다. 수정: `data/` → **`/data/`** (루트 한정). 스펙 1절에 반영해 뒀다. R3 검증: `git init` 임시 디렉터리에서 `git check-ignore` 가 `data/ggto.db` 만 잡고 `tools/chart-gen/data/equity169.json` 은 안 잡는 것.
5. **[`packages/preflop/bench/perf.mjs`, `packages/core/bench/*`] 스펙 10절 R3 구현.** 위 2절. 요구: 공유 하네스, `os.cpus()` 부하 측정, JSON `load`/`enforced`, `check` 실패 무조건 exit 1, 예산 초과는 `load ≤ 0.60` 또는 `--strict` 일 때만 exit 1, runs 5. 예산 수치 불변. R3 검증: 부하 하에서 `npm run ci` exit 0 + JSON 에 `load` 존재, `--strict` 로 강제 실패 재현(예산을 1ms 로 낮춘 임시 실행 또는 `check` 결함 주입은 리뷰어 스크래치에서).

## MINOR (다음 페이즈로 미뤄도 됨)

1. (R1 MINOR 2~8 이월 — 그대로.)
2. [`docs/spikes/P4-rust.md` 3절 끝] "`cargo tree -i windows-sys` 가 **비어 있음**을 CI 게이트로" — 실측: 패키지가 그래프에 없으면 빈 출력이 아니라 `error: package ID specification "windows-sys" did not match any packages` + **exit 101** 이다. 게이트는 "exit ≠ 0 이고 stderr 에 `did not match any packages`" 를 통과로, exit 0 (역의존 트리 출력) 을 실패로 정의해야 한다. P4 스펙에서 잡는다.
3. [`docs/spikes/P4-rust.md` 5절] `cp Cargo.lock <our-repo>/tools/<wrapper>/postflop-solver.lock` 뒤 바로 `cargo build --locked` — `--locked` 는 크레이트 디렉터리의 **`Cargo.lock`** 만 읽는다. 저장용 이름으로 복사한 파일을 빌드 전에 `Cargo.lock` 로 되돌리는 단계가 절차에 없다 (2절 권고 첫 항의 "래퍼 크레이트의 커밋된 `Cargo.lock`" 방식이면 이 문제는 자연히 없다 — 래퍼가 path/git 의존으로 postflop-solver 를 가리키고 래퍼의 lock 이 그래프 전체를 핀한다). P4 스펙에서 방식을 하나로 고정한다.

## UNCERTAIN

없음 (R1 UNCERTAIN 1·2 는 스파이크 문서에 P4 과제로 기록됐고 P4 에서 해소한다).

## 3. R3 에서 확인할 것

MAJOR 4 (`.gitignore` 한 글자) + MAJOR 5 (벤치 하네스). R3 리뷰는 `git check-ignore`, fresh copy `ci`, 벤치 JSON `load`/`enforced`, `--strict` 강제 실패, R1 회귀(시드 해시 6/6 불변) 만 본다. 통과 시 APPROVED + `docs/specs/P3.md`. P3 스펙 결정은 R1 9절 그대로 (스팟 = `content_hash`+`seq`+콤보, `graded_by = has_ev ? 'ev' : 'frequency'`, EV loss = `max_a EV − EV[chosen]`, `reach_hero` 가중 샘플링, 혼합 = min 빈도 ≥ 0.01, SRS 샘플러·리크 분석·세션 리포트) + P2 이월 MINOR 2~8 + 본 라운드 MINOR 2·3 (P4 스펙 항목).
