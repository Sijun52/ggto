# P2 리뷰 — 라운드 3

리뷰어: ggto-architect. 날짜: 2026-09-11. 대상: R2 MAJOR 4(`.gitignore`)·5(부하 인지 벤치 하네스) + 신규 MINOR 2·3(스파이크 문서) 수정분. 스펙 `docs/specs/P2.md` (본 라운드에서 **R4 소폭 개정** — DoD 1 문구, 1절 `bench:strict`, 10절 JSON 필드, 개정 이력).
스크래치: 세션 스크래치패드 `r3arch/` (`gate3.mjs`, `gate3-{a..f}.{json,err}`, `selfload.mjs`, `probe.mjs`, `src/`(git init 원본), `fresh/`(clone), `fresh-install.log`, `fresh-ci.log`, `fresh-seed.log`, `bench-strict.log`, `hash-after-seed.txt`, `hash-fresh.txt`), `gitign3/`.
**측정 환경: 리뷰 내내 사용자 게임 중** (`OP.GG` ×5, `Riot Client`, `League of Legends`, `LeagueClientUxRender`). `Get-CimInstance` LoadPercentage 79~88. 6코어. **유휴 상태를 만들 수 없었다** — 아래 2절.

## VERDICT: APPROVED

CRITICAL 0, MAJOR 0, MINOR 3 (신규, 전부 P3 이월), UNCERTAIN 0. R2 MAJOR 4·5 와 MINOR 2·3 은 **전부 수정 확인**. R1 회귀(시드 해시) 불변. P3 스펙은 `docs/specs/P3.md`.

## 검증한 것 (실행 근거)

| 항목 | 방법 | 결과 |
|---|---|---|
| **MAJOR 4 — `git check-ignore`** | `gitign3/` 에 `git init` + 레포 `.gitignore` 복사 + 4경로 생성 | `tools/chart-gen/data/equity169.json` **exit 1 (무시 안 됨)**, `data/ggto.db` → `.gitignore:3:/data/`, `data/charts/x.json` → `.gitignore:3:/data/`, `packages/x/data/y.bin` exit 1. `git status --ignored`: `A tools/chart-gen/data/equity169.json`, `!! data/` |
| **MAJOR 4 — 실제 git 경로** | 소스를 `r3arch/src` 에 tar 복사(`node_modules`/`dist`/`.git`/`*.tsbuildinfo` 만 제외 — **`data` 는 제외하지 않음**, R2 의 내 실수 재발 방지) → `git init`/`add -A`/`commit` → `git clone` → `r3arch/fresh` | `git ls-files \| grep data/` = **`tools/chart-gen/data/equity169.json` 한 줄**. 추적 164 파일. 클론에 `equity169.json` **250,324 B** 존재, `fresh/data` **없음** |
| **fresh clone `ci`** | `fresh/` 에서 `npm install` → `npm run ci` (`fresh-ci.log`) | install exit 0 / **`CI_EXIT=0`**. 테스트 core 125 / preflop 45 / server 45 / web 57 / chart-gen 21 / chart-import 8 = **301** (R2 와 동일). smoke 9/9. 벤치 JSON 에 `load`/`enforced` 존재: core `load 0.826, enforced:false` (전부 PASS), preflop **`load 0.599, enforced:true`** getNode 144.3 / reach 93.3 — 임계 바로 아래에서 집행 경로가 실제로 켜진 실행 (예산 내라 exit 0) |
| **fresh clone `seed`** | 같은 클론에서 `npm run seed` (`fresh-seed.log`) | exit 0, 6개 **`skipped:false`** 삽입 (id 1~6). 클론 DB `content_hash` 6행 = 메인 DB 6행 **동일** (`diff` 0). 클론 `data/charts/*.json` 6개 = 메인 파일 **바이트 동일** (`cmp`) |
| **MAJOR 5 — 3분기 + 2 (내 스크립트)** | `r3arch/gate3.mjs`: 하네스 `runCases` 를 그대로 import 하고 **`os.cpus` 만 바꿔** 부하를 결정적으로 만든다 (`user += 1e9` → load 1.0, `idle += 1e9` → load 0.0). 개발 에이전트 `gate-demo.mjs` 는 쓰지 않았다 | (a) 예산 0.0001ms + load 100% + strict 없음 → `OVER (not enforced: load 100%)`, **exit 0**, `enforced:false`. (b) 같은 조건 `--strict` → `FAIL`, **exit 1**, `enforced:true, strict:true`. (c) `check` 가 문자열 반환 + load 100% + strict 없음 → `WRONG RESULT` + `1 correctness failure(s) — always fatal`, **exit 1**. **(d) 예산 초과 + load 0% + strict 없음 → `FAIL`, `budgets ENFORCED`, exit 1** — 개발 에이전트가 재현 못 한 분기. (e) 실제 부하(100%) → OVER exit 0. (f) 예산 내 + load 0% → PASS exit 0, `ok:true` |
| **MAJOR 5 — 집행 코드 경로** | `harness.mjs:116` 읽음 | `const enforced = strict \|\| load <= LOAD_ENFORCE_MAX;` 단일 불리언. exit 판정은 `wrong > 0` → 1 (142행, 부하 무관), `over > 0 && enforced` → 1 (146행). (d) 가 이 경로를 실제로 탔다 |
| **MAJOR 5 — `sampleLoad` 자기 기여** | `r3arch/selfload.mjs`: 실제 `packages/preflop/bench/perf.mjs` 를 dynamic import 하고 `process.on('exit')` 에서 `process.cpuUsage()`(전 스레드 합) / wall 을 찍음. ×3 | wall 5085 / 7024 / 8375 ms, selfCpu 2484 / 2860 / 2782 ms → **벤치 프로세스가 쓴 코어 0.49 / 0.41 / 0.33** = 6코어의 8.1 / 6.8 / 5.5 %p (경합 중이라 1코어를 다 못 받음). 같은 구간 `os.cpus()` 델타 95.6 / 96.2 / 98.8 %. **벤치는 단일 스레드**(GC 헬퍼 포함해도 < 1코어) → 자기 기여 상한 = 1/ncpu = 16.7 %p, 벤치가 무거워져도 이 상한을 넘지 못한다 (무거우면 wall 만 길어진다). 아래 1절 |
| **MAJOR 5 — 병렬 프로브 (실패한 설계)** | `probe.mjs` idle/burn 두 프로세스를 같은 4초 창에 | idle 96.1 == burn 96.1 (×3 동일). **두 프로세스가 같은 시스템 카운터를 읽으니 당연히 같다** — 자기 기여를 분리하지 못하는 설계였다. 위 `cpuUsage` 측정으로 대체 |
| **`bench:strict` 인자 전파** | 루트 `npm run bench:strict` (`bench-strict.log`) | core `node bench/perf.mjs --strict` / preflop `node bench/perf.mjs --strict` 둘 다 `strict:true, enforced:true`. 이번 실행은 우연히 예산 내 (getNode 140.6 / reach 133.4 @ load 96%) 라 exit 0 — 개발 에이전트의 `bench-strict.log` 는 같은 부하에서 375/383 으로 exit 1. 포화 상태의 플레이키함 자체가 R2 결정의 근거였다 |
| **하네스 공유** | `grep -l "function measure\|runCases" packages/*/bench/*.mjs` | `harness.mjs` 에만 정의, `core/bench/perf.mjs`·`preflop/bench/perf.mjs` 는 `runCases` import 만 |
| **MINOR 2·3 (스파이크 문서)** | `docs/spikes/P4-rust.md` 3절 끝·5절·개정 이력 읽음 | 3절: 3분기 판정표 (exit≠0 **이고** `did not match any packages` = 통과 / exit 0 = 실패 / 그 밖의 exit≠0 = 게이트 오류로 중단) + "exit 코드만 보면 세 번째가 통과로 샌다" 명시 — 내 R2 실측(`exit 101`)과 일치. 5절: `cp <our-repo>/.../postflop-solver.lock ./Cargo.lock` 복구 단계 추가 + "래퍼 크레이트 방식이면 복사 단계가 사라진다 — P4 스펙에서 둘 중 래퍼 방식 하나로 고정" 명시 |
| **시드 해시 불변 (메인)** | `npm run seed` → DB `content_hash` 6행을 R1 백업 `bak-hash.txt` 와 `diff --strip-trailing-cr`; `data/charts/*.json` 을 `arch-p2/data.bak/charts/` 와 `cmp` | seed **6/6 SKIP** (`skipped:true`, `same content_hash`), exploitability 3.8e-8 ~ 1.4e-7. 해시 **6/6 동일** (`00ffb320…`, `dbf5816f…`, `6c98832e…`, `b02b94d5…`, `0dc9ff95…`, `875bc4a2…`). 파일 6개 **바이트 동일** (생성기가 파일을 다시 썼는데도) |
| 변경 범위 | mtime > R2 리뷰(16:36) 파일 | `.gitignore`, `packages/core/bench/harness.mjs`, `packages/core/bench/perf.mjs`, `packages/preflop/bench/perf.mjs`, `package.json`, `docs/spikes/P4-rust.md`. 보고 범위 밖 변경 없음 |

## 1. 하네스 판정 — 맞다

- **3분기 + (d)**: 표. 스펙 10절 규칙 2·3 대로. 개발 에이전트의 실증(a)(b)(c) 를 내 방식으로 재현했고, 못 했다는 (d) 는 `os.cpus` 대체로 재현했다 (실제 유휴 머신은 아니지만 `sampleLoad` 아래의 계산은 실제 코드이고 `enforced` 이후 경로는 부하 출처와 무관하다).
- **`sampleLoad` 가 재는 것**: `SPAN_START` 는 하네스 모듈 평가 시점 (preflop 벤치에서는 `core/dist`·`preflop/dist` 로드 **후**, 케이스 구성 전). 종료 스냅샷은 `teardown` 후. 실행 구간을 잰다. 자기 자신 포함 — 스펙 10절 규칙 1 이 명시한 대로.
- **자기 기여로 인한 집행 회피 — 구조적 결함 아님**: 자기 기여는 (사용 스레드 수)/ncpu 로 상한이 잡히고 벤치는 단일 스레드(실측 ≤ 0.49코어)다. 즉 **벤치가 무거워져도 load 는 안 올라간다**; wall 만 길어진다. 유휴 6코어에서 load ≈ 17% → `≤ 0.60` → 집행. 임계 0.60 은 R2 에서 자기 기여를 **포함한** 측정치(52~68%)로 잡은 값이라 일관된다. 남는 문제는 **코어 수 이식성**뿐: 유효 외부 임계 = 0.60 − 1/ncpu 라 4코어 35%, 2코어 10%, 1코어에서는 `--strict` 없이는 영원히 미집행. 개인용 6코어 앱이라 지금은 문제가 아니고, MINOR 1 로 P3 에서 `1/ncpu` 보정.
- **JSON `ok`**: `wrong===0 && over===0` — 집행 여부와 무관한 "사실" 이다. 미집행 OVER 가 있으면 `ok:false` 인데 exit 0 이다. 틀린 게 아니라(로그가 사실을 말한다) 문서화가 없을 뿐. MINOR 3.

## 2. 개발 에이전트가 못 한 검증 2건

- **`load ≤ 0.60` 에서 strict 없이 exit 1**: 나도 유휴를 못 만들었다 (게임 중). 대신 (d) 로 코드 경로를 결정적으로 증명했고, fresh `ci` 의 preflop 벤치가 **실제 `load 0.599, enforced:true`** 로 돌아 예산 내 통과했다 (집행이 켜진 실제 실행 1건). 코드 경로는 단일 불리언이다. **해소로 본다.**
- **DoD 1 의 `load ≤ 0.40` 첨부**: 에이전트도 리뷰어도 사용자의 게임을 끌 수 없다. **에이전트가 통제할 수 없는 조건을 승인 게이트에 두는 것은 틀렸다** — 그런 DoD 는 "실행되지 않는 규칙" 이고 R2 에서 내가 `ci` 제거 제안을 기각한 이유와 같은 이유로 기각돼야 한다. 스펙 R3 문구는 이미 "미집행 보고 + 리뷰어가 유휴 때" 라는 탈출구를 뒀지만 리뷰어도 못 하면 막힌다. **R4 로 고친다**: DoD 1 은 "`--strict` 실행의 `load NN%` 줄을 값과 무관하게 첨부" 이고, `load ≤ 0.40` 기록은 **정보(유휴 기준값 이력)** 이지 승인 조건이 아니다. 집행 경로의 정확성은 하네스 테스트(MINOR 2, P3)가 보장한다. 이번 라운드는 (d) + fresh `0.599` 실행으로 대신한다.

## 3. 스펙을 넘어선 것 — 판정

- **루트 `bench:strict`**: **수용.** DoD 1 이 사람에게 시키는 명령이 바로 이것이고, `npm run bench --workspaces -- --strict` 를 매번 손으로 치는 것보다 낫다. 인자 전파 실증(표). 1절 스크립트 표에 R4 로 등재.
- **JSON 추가 필드 `suite`/`loadThreshold`/`strict`/`withinBudget`/`correct`**: **수용.** 스펙 필드의 상위집합이고 전부 자기 서술적이다 (`suite` 는 두 벤치가 한 로그에 찍히니 필요, `loadThreshold`/`strict` 는 `enforced` 의 근거, `withinBudget`/`correct` 는 `ok` 의 분해). 10절 R4 에 등재.
- **하네스 유닛 테스트 없음**: "스펙 10절 요구가 아니다" 는 맞다. `runCases` 가 `process.exit` 를 부르므로 자식 프로세스 테스트가 된다는 것도 맞다 — 그러나 **필요하다**: 이 게이트가 `ci` 의 exit 코드를 결정하는데 `enforced` 논리를 누가 깨도 아무것도 안 잡는다. 내 `gate3.mjs` 방식(하네스 import + `os.cpus` 대체 + 자식 프로세스 exit 코드) 이면 30줄이다. MINOR 2, P3 필수 항목.

## CRITICAL

없음.

## MAJOR (승인 전 수정 필요)

없음.

## MINOR (다음 페이즈로 미뤄도 됨 — 전부 P3 작업 목록에 있다)

1. [`packages/core/bench/harness.mjs:24`] `LOAD_ENFORCE_MAX = 0.6` 이 코어 수를 모른다. 자기 기여 1/ncpu 가 상수처럼 들어가 있어 유효 외부 임계가 6코어 43% / 4코어 35% / 2코어 10% / 1코어 −7% 다. `load - 1/os.cpus().length` 를 `loadExternal` 로 같이 찍고 임계를 외부 부하 기준(0.43) 으로 바꾸거나, 임계를 `0.43 + 1/ncpu` 로 계산하라. 6코어에서는 결과가 같으므로 지금 값은 유효하다.
2. [`packages/core/bench/harness.mjs`] 게이트 논리 테스트 없음. 자식 프로세스로 (a) 초과+고부하 → exit 0 `enforced:false`, (b) `--strict` → exit 1, (c) `check` 실패 → exit 1, (d) 초과+저부하 → exit 1 을 단언하라. 부하는 `os.cpus` 를 덮어쓰는 래퍼 스크립트로 결정적으로 만든다 (`r3arch/gate3.mjs` 참고). 테스트 이름에 `P2 10.2`/`10.3`.
3. [`packages/core/bench/harness.mjs:128`] JSON `ok` 가 집행과 무관한 사실값이라 `ok:false` + exit 0 이 공존한다. 주석 한 줄 (`ok = 예산·정확성 사실, exit = 집행 결과`) 과 스펙 10절 명시. R4 에 적어 뒀다.

이월 유지: R1 MINOR 2~8, R2 MINOR 2~3 (P3.md 10절).

## UNCERTAIN

없음.

## 다음 페이즈 진행 가능 여부

APPROVED. P2 는 닫는다. 다음은 `docs/specs/P3.md` (트레이너 v1, 프리플랍 전용) — 스팟 = `content_hash`+`seq`+콤보, `graded_by = has_ev ? 'ev' : 'frequency'` (D8), EV loss = `max_a EV[a][c] − EV[chosen][c]`, `reach_hero` 가중 샘플링, 혼합 = min 빈도 ≥ 0.01, SRS 샘플러·리크 분석·세션 리포트, 뷰어 컴포넌트를 마스킹 상태로 재사용 (DESIGN 6.5). 기록은 `data/trainer.db` 별도 파일 (`ggto.db` 는 `seed` 로 재생성되는 산출물이고 기록은 사용자 데이터라 수명이 다르다 — P3.md 4절, DECISIONS D16). **P3 의 첫 작업은 R1 MINOR 4 (정확 에퀴티 표)** 다 — 시드 `content_hash` 가 바뀌는 일은 기록이 쌓이기 전에 끝내야 한다.
