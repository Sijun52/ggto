# P4 리뷰 — 라운드 1

대상: 브랜치 `p4-solver` = `7f91e55` (`ed79f76` 이월 정리 → `7f91e55` P4). `main` = `7f1000e`.
리뷰어: ggto-architect, 2026-09-16. 스펙: `docs/specs/P4.md` (이 라운드에서 `line` 문법 개정 — 아래 "스펙 판정").

## VERDICT: CHANGES_REQUIRED

CRITICAL 0 · MAJOR 6 · MINOR 12 · UNCERTAIN 2. 도메인 계산(EV 기준점·역순열·해시 건전성)은 맞다.
승인을 막는 것은 **라우트 계약 셋**(턴/리버 라인의 `board` 소실, 해시-쿼리 불일치 무검증, 재솔브·삭제 뒤
조회 데몬의 낡은 결과)과 **큐가 슬롯 하나를 놀리는 것**, `config_json` 스펙 이탈, 역순열 **방향**을 못 잡는 테스트다.

---

## 검증한 것 (실행 근거)

| 무엇 | 명령 | 결과 |
|---|---|---|
| `ci` (Rust 를 PATH 에서 뺀 셸, `GGTO_SOLVER_BIN` 은 없는 경로) | `npm run ci` | **exit 0**, 72.6s. core 131 / preflop 45 / server 164 / solver 65 (+9 skip) / trainer 100 / web 111 / chart-gen 23 / chart-import 8 = **647 passed, 9 skipped**. 벤치 4 스위트 전부 `ok:true` (`@ggto/solver` 407ms / 500). smoke 16/16 |
| `ci:solver` | `npm run ci:solver` | **exit 0**, 55.8s. 게이트 `exit=101 verdict=absent` (`did not match any packages`). cargo test daemon 3 + solver 10. 통합 9. bench: cold 18ms, node mean 0.511ms p99 0.867ms, runouts 2ms, estSeconds ratio 0.68/0.38/0.65 |
| fresh clone (스크래치패드, `git clone --branch p4-solver`) | `cargo build --locked --offline --release` | **exit 0**, 35.9s, **네트워크 없이** 빌드. `cargo tree -e normal --depth 1` = base64 0.22.1 / postflop-solver@9d1509fe / serde 1.0.229 / serde_json 1.0.151 (1절 표와 동일). `cargo tree -i windows-sys` → exit 101 absent. `Cargo.lock` bincode/bincode_derive `2.0.0-rc.3`. 컴파일 경고 0 |
| fresh clone TS | `npm ci` → `npm run seed` → `npm run ci` (Rust 없이) | 6.4s / 12.8s / **exit 0** 102s. 테스트 수 위와 동일 |
| 3.5 프로브 | `cargo run --release --example evprobe` | 스펙 3.5-R 표와 **숫자까지 동일** (`exploitability 0.904920`, 다섯 노드 SUM = node_pot, 오차 +0.0000, vs starting_pot +0/+150/+525/+300) |
| 3.5 독립 프로브 (리뷰어 작성, 플랍 `Ks7h2h` simple, 457MB, 150 iter, 세 스트리트 관통) | 임시 example (삭제함) | 루트·플랍 bet·bet-raise·bet-call chance·**턴 카드 뒤**·턴 X-B·**리버 카드 뒤** 7개 노드 전부 `Σ_players ev = node_pot` 오차 +0.00000. `total_bet_amount` 가 스트리트를 넘어 **누적**임을 확인 (리버 노드 bets `[3150,3150]`, pot 8300). 각 핸드에서 `Σ_a strategy[a]·ev_detail[a] = expected_values` 오차 0.00000 — 액션별 EV 도 같은 기준점. 보드 카드 콤보의 `normalized_weights` 0 |
| 캐시 키 공격 (`scratchpad/attack.mjs`, dist 사용) | 사이징 3 프리셋 + raise 만 다름 + 스트리트 하나만 다름 / rake pct·cap / pot 0.01 / stack 0.01 / compressed / pot↔stack 맞바꿈 / oop↔ip 맞바꿈 / `QQ:0.5` | **전부 갈라짐**. `potBb 20.004` = `20` (칩 단위 같은 게임) 같음. 전 콤보 ×0.5 스케일 같음. 보드 카드 콤보(`AsKs`, Ks 보드)만 추가 → 같은 해시 (제거 후 같은 게임 — 옳다) |
| 해시 건전성 무작위 | 5 보드 × 24 순열 × 8 레인지 텍스트 × 2 팟 × 2 사이징, 580 유효 설정 | **같은 해시 ⇒ 같은 정규 JSON, 충돌 0**. (정의상 성립: 해시 = sha256(정규보드, 정규 제거후 레인지 hex, pot, stack, sizings, rake, compressed) 이고 이 7-튜플이 게임을 완전히 기술한다) |
| `JSON.stringify(v, keys)` 버그 재현 | `JSON.stringify({sizings:{flop:{bet:'33%'}},v:1}, ['v','sizings','flop'])` | `{"v":1,"sizings":{"flop":{}}}` — **`bet` 이 실제로 사라진다**. `stableStringify` 는 보존 |
| 역순열 (스펙 14절) — 실제 데몬 + 서버 라우트 (`scratchpad/route.mjs`) | 같은 해시를 `Ks7h2h` / `Kd7s2s` 로 조회 | `AhKh@Ks7h2h ev = 22.2597` = `AsKs@Kd7s2s ev = 22.2597` **MATCH**, `AhKh@Kd7s2s = 15.2920` DIFFER. `evAvgBb` 합 20.0000 = 팟 |
| 뮤턴트 6종 (solver vitest) | M3 단순평균 / M10 removeBoard 먼저 / M4 TooLarge 제거 → **잡힘**. M1 `inv = perm` (역순열 방향) → **65/65 통과 (살아남음)**. M2 레인지 perm 미적용 → 통과 (**동치 뮤턴트** — perm ∈ stab(R) 이면 perm(R)=R 이라 행동이 같다. 테스트 결함 아님). M8 소문자 액션 허용 → 통과 (데몬이 막으므로 MINOR) |
| 큐 pump (`attack.mjs` 6절) | 7.5GB 잡 + 1GB 두 개, 동시 2, 상한 8GB | 큰 잡 종료 +50ms: `s1 running, s2 queued`, running mem 1GB — **슬롯 하나가 논다** (MAJOR 4) |
| 라우트 계약 (`route.mjs`, 실제 데몬) | `node?line=X-X/Qc` | `street: turn` 인데 `board: Ks7h2h` (**Qc 소실**). `runouts?line=X-X/Qc/X-X` 도 board 3장 (MAJOR 1) |
| | `node?...&board=Ad5d5c&oop=AsKs&ip=QhQd` (해시는 Ks7h2h 솔브) | **200**, `board: Ad5d5c` 로 답함 (MAJOR 2) |
| | 0.5% 솔브 → node → 0.1% 로 재솔브(REPLACE, 340 iter, expl 0.095%) → node | 전략 `max|diff| = 0.000000` (**낡은 결과**). 데몬 재기동 뒤 `max|diff| = 0.3397`. DELETE → 10 iter 재솔브 → node: 600 iter 결과 그대로 (MAJOR 3) |
| 레이아웃 게이트 (Chrome) | `npm run check:desktop` / `check:mobile` | exit 0 / exit 0 (88 PASS, 0 FAIL). 태블릿 768/800/829 reach: 겹침 프레임 0, `lastBadAtMs: null` |
| 잔여 프로세스 | `Get-Process ggto-solver-cli` / `netstat` | 0개 / 7791·7777 LISTEN 없음 (TIME_WAIT 만) |
| 계층 grep | `child_process` import, 데몬 메서드 이름, `Float64Array` | daemon/ 밖·`postflopCli.ts` 밖·solver src 에 없음 |

---

## 개발 에이전트의 "기존 코드 버그 3개" 판정

| # | 판정 | 근거 |
|---|---|---|
| 1 `canonicalize` 를 `removeBoard` 뒤에 부르면 동형 보드가 다른 해시 | **진짜다. 수정도 옳다.** 단, "기존 코드" 가 아니다 — `config.ts` 는 이 페이즈의 새 파일이다 | stab(R\|B₁) 과 stab(R\|B₂) = q·stab(R\|B₁)·q⁻¹ 는 다른 부분군이라 다른 대표를 고른다 (캐시 미스, 오답 아님). 원 레인지의 stabilizer 는 보드와 무관하므로 두 보드가 같은 군에서 최소화된다. 건전성: 해시 입력은 `(B*, R\|B* 정규화)` 이고 `p(R)\|p(B) = p(R\|B)` 이므로 같은 해시 ⇒ 같은 게임. **뮤턴트 M10 (옛 순서 복원) 이 `hash.test` 2개를 깨뜨림** — 회귀 방지가 실제로 된다 |
| 2 `JSON.stringify(v, keys)` allowlist 로 `sizings.flop.bet` 이 빠져 `simple` = `standard` | **진짜다 (위 재현). 심각도: 출하됐다면 CRITICAL** — 다른 게임을 같은 캐시로 답한다. 역시 새 파일(`hash.ts`) 안의 페이즈 내 버그이고 자기 테스트가 잡았다. `stableStringify` 수정 옳음 (중첩 키 보존·정렬 확인) | 공격 스크립트에서 세 프리셋·raise 만 다름·스트리트 하나만 다름 모두 갈라짐 |
| 3 `suitStabilizer` 사상표 | **옳다. 유일한 기존 코드 변경.** `r∘p = r ⇔ r∘p⁻¹ = r` 이므로 `r[map[i]] == r[i]` 검사는 옛 `permuteRangeSuits` 비교와 동치. core 131 통과, `canonicalBoard x22100` 12.9ms 불변, solver 벤치 407ms | MINOR 1: `comboIndex` import 가 주석에만 쓰이고 코드에서는 안 쓰인다 |

## 스펙 반박 판정 — `line` 문법

**개발 에이전트가 맞다.** 스펙 0절 2·5.4·10절의 `b33.c` 는 내가 DESIGN 3.3 의 낡은 예시를 그대로 옮긴 것이고 D3(구분자 `-`, phase-minus1 CRITICAL 1)·core `formatAction`(`B6.6`) 과 정면으로 모순이었다. 포스트플랍에서는 `B6.6` 처럼 소수 금액이 **실제로** 나오므로 `.` 은 토크나이즈 불가능하고, `b33` 퍼센트 표기는 geometric/all-in 과 `Bet(chips)` 대응을 잃는다. **P4.md 0절 2·5.4·10절을 이 라운드에서 개정했다** (5.4 에 문법 정의 추가: 카드 세그먼트 포함 → core `parseActionSequence` 의 상위집합이며 파서가 `line.ts`·`lines.rs` 둘이라는 사실 명시). `DESIGN.md` 3.3 과 279행은 아직 낡았다 (MINOR 2).

## 설계 변경 8건

| # | 변경 | 판정 |
|---|---|---|
| 2 | `node` 에 `evAvgBb: [oop, ip]` | **수용.** 근거 타당 — `ev` 는 행동 플레이어 값뿐이라 상대 EV 가 없다. 실제 데몬에서 합 = 팟 확인. 단 도달 질량 0 인 라인에서는 `0/0 = NaN` 이 serde 로 `null` 이 된다 (MINOR 11) |
| 3 | `estimate` 에 `maxIterations` | **수용** (추정은 iteration 에 비례) |
| 4 | 벤치 두 프로세스 | **수용.** 하네스가 자기 기여 상한을 `1/ncpu` 로 잡는 이상 rayon 자식과 같은 프로세스에서 잴 수 없다 |
| 5 | 공유 하네스 async | **수용.** core/preflop/trainer 벤치 수치·`ok:true`·exit 0 을 두 머신(작업 트리·fresh clone)에서 확인 |
| 6 | grep 게이트를 크레이트 이름으로 | **수용.** `trainer/spotKey.ts` 의 "postflop spot keys" 는 도메인 어휘다. 막을 것은 구현 누수이고 그 식별자는 크레이트 이름이다 |
| 7 | `Stalled` 를 `stallMs` 주입으로 | **수용.** 타이머가 첫 progress 뒤 무장되므로 fake timer 로는 못 잡는다는 설명이 맞다 |
| 8 | `drawSeed.ts` 신규 | **수용** (12절 의도 = 분리; 파일 이름은 자유) |

## 알려진 한계 8건

| # | 판정 |
|---|---|
| 1 보드만 정규화 | **수용 — 오답이 아니다.** 580 무작위 설정에서 같은 해시 ⇒ 같은 정규 JSON. 단 규모를 적어 둔다: `AsQs/JhJd` 의 24 동형 표기가 **12개 해시**로 갈라진다 (stab = {id}). 슈트를 지목한 레인지에서는 사실상 정규화가 없다. 개선안(MINOR 12): 24 순열 전체에서 `(perm(B) 정렬, perm(oop) hex, perm(ip) hex)` 의 사전순 최소를 대표로 — 결정적·완전. `not.toBe` 로 고정한 테스트는 그때 뒤집는다 |
| 2 `node`/`runouts` 쿼리 없으면 정규 보드 | **P5 계약으로 확정하되 MAJOR 2 를 먼저 고친다**: 쿼리가 있으면 `configHash(buildConfig(query)) === :hash` 를 검증(불일치 400 `HashMismatch`), 없으면 정규 보드 + `perm` 항등을 명시적으로 응답에 표시(`board` 는 정규). P5 는 `SolveListItem.boardCanonical` 로 목록에서 열고, 사용자가 표기를 고르면 쿼리를 붙인다 |
| 3 취소 하한 = `solve_step` 1회 (플랍 1.4s) | **스펙 위반은 아니다 (5.1 은 stdin close → 2s → kill 을 정의) 지만 8.3 "500ms 안에 프로세스 소멸" 을 큰 트리에서 못 지킨다.** `.part` 는 스텝 끝에만 쓰이므로 스텝 중 kill 은 안전하다 → `cancel` 응답이 500ms 안에 없으면 즉시 kill (MINOR 5). 취소 테스트를 턴으로 바꾼 것은 수용하되, 플랍 wide 스팟에서 "kill 경로로 500ms" 를 통합 테스트에 남겨라 |
| 4 `evictFor` 가 `.part` 뒤 | **수용 (MINOR 6)**: "저장" 을 "인덱스 반영" 으로 읽어도 인덱스 총량 ≤ cap 은 성립. 디스크 과도 초과 상한은 메모리 게이트(≤8GB/.part) 다. 4.2 문구에 이 사실을 적어라 |
| 5 `compressed:true` 미측정 | **UNCERTAIN 1** — 아래 |
| 6 P3M UNCERTAIN 1 재현 실패 | **수용.** 솔직한 보고이고 게이트(`check:mobile` 태블릿 3폭 × 5 검사) 가 이 머신에서 0 프레임으로 통과했다 |
| 7 `data/solves` 313MB | 무관 (gitignore). 수동 CLI 실행 잔여물 |
| 8 rustup `--no-modify-path` | 수용. `cargoBin()` 이 `~/.cargo/bin` 을 본다 (이 리뷰의 PowerShell 세션에도 cargo 가 PATH 에 없었고 스크립트는 돌았다) |

---

## CRITICAL

없음.

## MAJOR (승인 전 수정)

1. **[`packages/server/src/routes/solve.ts:325`, `:349`] 턴/리버 라인의 응답 `board` 에서 딜된 카드가 사라진다.** `res.board = formatCards(cfg.boardOriginal)` 가 `toNodeResponse` 가 만든 `board`(정규 보드 + 딜된 카드, 역순열 완료) 를 **플랍 3장으로 덮어쓴다**. 실측: `node?line=X-X/Qc` → `street: "turn"`, `board: "Ks7h2h"`; `runouts?line=X-X/Qc/X-X` → board 3장, cards 48. DESIGN 5.3 예시(`board: "Ks7h2hQc"`)·스펙 2절("응답의 board 는 원본 슈트") 위반 — P5 가 턴 노드에 플랍 보드를 그린다. 고치는 법: 원본 순서를 지키고 싶으면 `boardOriginal` + `permuteBoardString(node.board.slice(6), inv)` 로 딜된 카드를 이어 붙여라. `tools/solve/main.mjs:248` 도 같은 덮어쓰기다. 테스트: `X-X/Qc` 라인의 `board.length === 8` 과 마지막 카드가 요청 표기로 역순열됐는지.

2. **[`routes/solve.ts:114-136` `permFor`] `:hash` 와 쿼리 설정의 일치를 검증하지 않는다.** 쿼리에서 `buildConfig` 로 얻은 `perm` 을 **다른 게임**의 1326 배열에 적용해 `board: Ad5d5c` 로 200 을 답했다 (실측). 정직한 클라이언트만 가정한 API 다 — P5 에서 레인지를 고친 뒤 옛 해시로 조회하면 슈트가 뒤섞인 배열을 원본이라고 표시한다. `configHash(cfg) === hash` 가 아니면 400 (`HashMismatch` 또는 `BadRequest`). 비용은 `buildConfig` 0.4ms. 쿼리가 없을 때의 계약(정규 보드)은 응답에 `perm: [0,1,2,3]` 같은 표지를 두고 P5 문서에 적어라.

3. **[`solver/ggto-solver-cli/src/serve.rs:96-105` + `packages/solver/src/cache.ts:209,249`] 재솔브(REPLACE)·DELETE 뒤 조회 데몬이 낡은 `.bin` 을 계속 답한다.** `load` 가 해시로만 멱등이라 파일이 바뀌어도 재로드하지 않는다. 실측: 0.5% 솔브를 0.1% 로 재솔브(인덱스 expl 0.095%, 340 iter) 한 뒤 `node` 전략 diff 0.000000, 데몬 재기동 후 diff 0.34; DELETE → 10 iter 재솔브 후에도 600 iter 결과. **사용자가 요청한 정확도와 다른 결과를 그 정확도라고 준다** — P6 채점의 EV 가 인덱스와 다른 솔브에서 나온다. 스펙 4.2 는 DELETE 에 `unload` 먼저를 명시했고 REPLACE 도 같은 이유다. 고치는 법 둘 중 하나: (a) `SolveCache.commit`/`remove` 전에 `ResultHandle`/`Solver` 를 통해 `unload(hash)` (캐시가 솔버를 모르므로 라우트/큐 `onSaved` 에서), (b) 데몬 `load` 가 `(size, mtime)` 을 기억하고 다르면 재로드. (b) 가 데몬 크래시·CLI 경로까지 덮으므로 권장, (a) 도 병행. 통합 테스트: 재솔브 뒤 `node` 전략이 바뀐다.

4. **[`packages/solver/src/queue.ts:243-253` `#pump`] 한 번에 잡 하나만 시작한다.** 큰 잡(7.5GB) 하나가 도는 동안 1GB 둘이 메모리 게이트에 걸렸다가 큰 잡이 끝나면 **하나만** 시작되고 다른 하나는 다음 종료까지 `queued` 다 (실측 `s1 running, s2 queued`, running mem 1GB, 슬롯 1 유휴). 스펙 5.2 "동시 2" 위반. `#pump` 를 `while` 로 — 슬롯과 메모리가 허락하는 한 계속 뽑는다. 테스트: 위 시나리오에서 큰 잡 종료 뒤 두 잡이 동시에 `running`.

5. **[`routes/solve.ts:221`, `tools/solve/main.mjs:191`] `config_json` 이 정규 JSON(3.3-2) 이 아니라 `{board, pot, stack}` 이다.** 스펙 4.1 은 "정규 JSON — 재현·목록용". 레인지가 없으니 행만으로 게임을 재현할 수 없고, 나중에 고치면 섞인 행을 마이그레이션해야 한다. `ticketFor(cfg).canonicalJson` 이 이미 있다 — 그걸 넣어라 (11KB/행, 무시 가능). 캐시 테스트에 `JSON.parse(row.configJson).oop.length === 1326*8` 한 줄.

6. **[`packages/solver/test/view.test.ts:78`, `hash.test.ts:154-161`, `integration.test.ts:184-195`] 역순열의 *방향*을 어떤 테스트도 못 잡는다.** 뮤턴트 `const inv = perm` (view.ts) 이 65/65 통과. 단위 테스트의 `PERM = [0,1,3,2]` 는 **involution**(s↔h) 이라 perm 과 inverse 가 같고, 왕복 테스트는 어느 쪽이 순/역이든 항등이며, 통합 테스트는 집합 비교다. 스펙 8.1 은 "AsKs 값이 perm 적용 후 AdKd 자리로 갔다가 돌아온다" 를 요구했다. 3-cycle (`[1,2,0,3]`) 로 `toNodeResponse` 를 검사하고, 통합 테스트에 리뷰어가 돌린 `AhKh@Ks7h2h == AsKs@Kd7s2s` 를 넣어라 (현재 코드는 맞다 — `route.mjs` 로 확인 — 그러나 회귀를 못 잡는다).

## MINOR (다음 페이즈로 미뤄도 됨)

1. `packages/core/src/isomorphism.ts:14` — `comboIndex` 미사용 import (주석에서만 언급).
2. `DESIGN.md` 3.3 (`"b33.c/b75.r225.c/x.x"`, `"F.F.R2.5…"`)·144행·279행(`line=b33.c/b75`) 이 여전히 `.` 문법이다. D3·5.3 개정과 맞춰라.
3. `queue.ts` — `failed`(Stalled/kill 중 저장) 경로에서 `.part` 를 지우지 않는다 (다음 기동의 `repair()` 까지 남는다). `#run` catch 에서 `rmSync(outPath, {force:true})`.
4. `routes/solve.ts:192` — 같은 해시가 이미 큐/실행 중인데 `confirm:true` 로 다시 오면 `estimateOnly` 가 프로세스를 하나 더 띄운다. `queue.byHash(hash)` 먼저.
5. 취소: `cancel` 응답이 500ms 안에 없으면 kill (한계 3). `.part` 는 스텝 끝에만 쓰이므로 안전.
6. 4.2 문구: `evictFor` 는 인덱스 반영 전에 돈다 — 디스크 과도 초과 ≤ 메모리 게이트. 스펙에 적어라 (한계 4).
7. `hash.ts` — 해시 입력에 `solver` id(`postflop-solver@9d1509fe`) 가 없다. 상류 커밋을 올리면 `.bin` 포맷이 바뀌어도 해시가 같아 `load` 가 `NotLoaded` 로 터진다. `v: 1` 을 올리거나 solver id 를 넣어라.
8. `bench/integration.mjs:114` — "콜드 스타트 + load 300MB < 3s" 를 4.9MB 파일로 쟀다 (18ms). 9절 표의 300MB 는 안 잰 것이다. 플랍 스팟(322MB) 으로 재라.
9. `line.ts` ACTION_RE 소문자 허용 뮤턴트가 산다 (`b33.c` 는 `.` 때문에 걸린다). `assertCanonicalLine('x')` 한 줄.
10. 스펙 3.5 "`cargo test` 가 evprobe 를 부른다" — 부르지 않는다. 성질 테스트 `p4_3_5_…` 가 대신하고 그게 더 낫다. 스펙 문구를 고쳐라 (내가 고치지 않았다 — 개발 에이전트가 3.5 를 이미 개정 중).
11. `nodes.rs:103` — 도달 질량 0 인 노드에서 `evAvgBb` 가 NaN → JSON `null`. P5 가 `null` 을 다루거나 데몬이 0 과 `reachable:false` 를 주도록.
12. 한계 1 개선안: 24 순열 전체에서 `(board, oop, ip)` 결합 최소 대표. `hash.test` 의 `not.toBe` 고정을 그때 뒤집는다.

## UNCERTAIN (개발 에이전트가 증명할 것)

1. **`compressed: true` 경로가 실제로 동작하는가.** 해시에 들어가는 옵션인데 실행된 테스트가 0 이다. 통합 테스트 하나: `compressed:true` 로 솔브 → `.bin` 저장·`load`·`node` 성공, `evAvgBb` 합 = 팟, `estimate.memoryBytesCompressed` 와 피크 RSS 비.
2. **조회 데몬의 2GB LRU 가 무엇을 세는가.** `serve.rs` 는 **파일 크기**를 합산한다. 실측(322MB `.bin` ↔ 0.63GB 추정, 4.9MB ↔ 9.8MB) 로는 로드된 게임의 메모리가 파일의 ~2배로 보인다. `GGTO_SOLVER_LOADED_BYTES=2GB` 가 RSS 4GB 를 뜻한다면 5.1 의 "2GB" 와 다르다. `--serve` 에 파일 합 1GB 를 로드하고 `WorkingSet64` 를 재서 배수를 적고, 상한을 파일 기준으로 둘지 RSS 기준으로 둘지 스펙에 적어라.

---

## `main` 머지 가능 여부

기술적으로 fast-forward 가능(`main` 이 `p4-solver` 의 조상)하지만 **MAJOR 1~6 이 남아 있으므로 머지하지 않는다.** R2 에서 위 여섯이 닫히고 `ci`·`ci:solver` 가 다시 exit 0 이면 fast-forward 한다.

## 다음 페이즈 진행 가능 여부

아니다. R2 를 기다린다. R2 보고에는 (a) MAJOR 1~6 각각의 테스트 이름, (b) UNCERTAIN 1·2 의 실측 숫자, (c) 이 문서 5.4 개정에 맞춘 `DESIGN.md` 3.3 정리를 포함하라. P5 스펙은 R2 APPROVED 뒤에 쓴다 — `node`/`runouts` 계약(MAJOR 2 의 해시 검증 + 쿼리 없을 때 정규 보드) 이 그 스펙의 첫 절이 된다.
