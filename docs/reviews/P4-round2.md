# P4 리뷰 — 라운드 2

대상: 브랜치 `p4-solver` = `18c2b57` (R1 `7f91e55` → 리뷰 `a0f774b` → R2 `18c2b57`). `main` = `7f1000e`.
리뷰어: ggto-architect, 2026-09-16. 범위: R1 MAJOR 1~6 + UNCERTAIN 1·2 (MINOR 12건은 P5 이월 — `docs/specs/P5.md` 12절에 배치).

## VERDICT: APPROVED

CRITICAL 0 · MAJOR 0 · MINOR 4 (신규, P5 이월) · UNCERTAIN 0. R1 의 MAJOR 6건은 전부 **실제 데몬 + 실제 라우트**에서 수정이 재현됐고, 개발 에이전트가 주장한 뮤턴트 5종을 내가 직접 심어 같은 수로 죽는 것을 확인했다 (R1 에서 65/65 생존했던 `inv = perm` 포함). UNCERTAIN 1 은 개발 에이전트의 실험 **설계**가 틀렸으나 **결론**은 다른 근거로 성립한다 — 스펙 3.4-R 을 내가 다시 썼다. `main` 으로 fast-forward 한다.

이 라운드에서 내가 고친 문서: `docs/specs/P4.md` 3.4-R (재작성)·7절 (R2 실측 + 알려진 구멍), `docs/assets/postflop-explorer-ui.svg` (D3 문법·`perm` 칩). 새로 쓴 것: `docs/specs/P5.md`, `docs/assets/p5-postflop-mobile.svg`. 코드는 건드리지 않았다 (뮤턴트는 전부 `git checkout` 으로 복원, `git status` 청정).

---

## 1. 검증한 것 (실행 근거)

| 무엇 | 명령 | 결과 |
|---|---|---|
| `ci` (Bash, cargo 가 PATH 에 없음, `GGTO_SOLVER_BIN=/nonexistent/…`) | `npm run ci` | **exit 0**, 75.7s. core 131 / preflop 45 / server 173 / solver 78 (+15 skip) / trainer 100 / web 111 / chart-gen 23 / chart-import 8 = **669 passed, 15 skipped** (보고와 일치, R1 647/9 에서 +22/+6). 벤치 4 스위트 `ok:true`. smoke 16/16 |
| `ci:solver` | `npm run ci:solver` | **exit 0**, 56.9s. 게이트 `exit=101 verdict=absent`. cargo 3 + 10. 통합 **15/15**. 벤치: cold 21ms (4.9MB), runouts 2ms, estSeconds ratio 0.68/0.40/0.72 |
| fresh clone (`git clone --branch p4-solver file:///…`) | `cargo build --locked --offline --release` → `npm ci` → `seed` → `npm run ci` (Rust 없이) | 24.3s exit 0 (네트워크 없이) / 6.9s / OK / **exit 0** 90.9s, 테스트 수 위와 동일, 벤치 `ok:true` |
| R1 라우트 공격 재실행 (`scratchpad/route.mjs`, 실제 데몬, 실제 `createApp`) | R1 과 같은 스크립트 | **ALL OK**. `X-X/Qc` → `street turn, board Ks7h2hQc` · `runouts X-X/Qc/X-X` → board 4장 48카드 · `board=Ad5d5c` → **400** · `AhKh@Ks7h2h = AsKs@Kd7s2s = 22.2597`, `AhKh@Kd7s2s = 15.2920` · evAvg 합 20.0000 · 재솔브(0.5%→0.1%, 340 iter) 후 전략 `max|diff| = 0.339713` (R1: 0.000000) · DELETE → 10 iter 재솔브 → `0.535747` (R1: 0.000000) |
| MAJOR 2 수정 뒤 계약 공격 (`scratchpad/route2.mjs`, 실제 데몬) | 아래 2절 | 부분 쿼리 30개 전부 400 · 해시 검증 +0.40ms/req · 보드 순서 보존 · 턴 솔브 리버 라인 5장 · 4-cycle 표기 φ 대응 EV 30/30 일치 (순열 무시 시 18 다름) · 쿼리 없음 → 정규 보드 + `perm` 항등 · **1 FAIL**: 커스텀 `sizings` POST 가 200 (MINOR R2-1) |
| 뮤턴트 5종 (내가 직접 심음, `git checkout` 복원) | M1 `view.ts` `const inv = perm` (2곳) / M2 `queue.ts` `while → if` / M3 `solve.ts` `res.board = formatCards(cfg.boardOriginal)` (2곳) / M4 `solve.ts` 해시 검증 `if (false)` / M5 `serve.rs` `stamp == stamp → true` + `cargo build` + 통합 | **4 / 1 / 3 / 1 / 2 사망** — 보고와 정확히 일치. M5 로그가 `max|diff| = 0.000000` 두 줄로 R1 실측을 재현. M1 이 죽인 4개는 전부 3-cycle 스위트 (`정규 AcKd → 원본 AhKc`, `board·line`, `runouts`, `왕복`) |
| M5 복원 후 | `cargo build --locked --release` → 통합 `-t "MAJOR 3"` | 2 passed. 재빌드 바이너리는 PE 헤더(타임스탬프)만 원본과 다르다 |
| CLI 경로 | `npm run solve -- --board Ks7h2hQc … --max-iter 100 --yes` 두 번 + `--line X-X/9d --json` (`GGTO_DATA_DIR` 스크래치) | 1회차 `solved expl 0.398% · 100 iter`, 2회차 **`cached`**, `--line X-X/9d` → `street river, board Ks7h2hQc9d`. `index.db` 행 `config_json` **21,450B** 정규 JSON (`{"board":"2c7cQdKh","compressed":false,"ip":"0000…`) — MAJOR 5 가 CLI 경로에도 적용됨 |
| UNCERTAIN 1 재실험 (`scratchpad/compressed.mjs`, `evloss.mjs`, 원본 바이너리 사본) | 턴 `Ks7h2hQc` 9 솔브 + 플랍 `Ks7h2h` 9 솔브, 기준 = 비압축 target 0.05% | 3절 |
| 신규 테스트 22개 동어반복 검사 | `view.test` 8 · `queue.test` 2 · `cache.test` 3 · `solve.test` 9 를 읽고 뮤턴트로 확인 | 3-cycle 스위트는 기대 인덱스(`AhKc` vs `AdKh`)를 **손으로** 박았다 — 구현을 베끼지 않았다. `cache.test` 는 `sha256(row.configJson) === hash` 를 단언한다 (행만으로 게임 재현). `queue.test` 두 번째(5GB 둘은 하나씩)는 `while` 이 메모리 게이트를 건너뛰는 회귀를 막는다. 통합 MAJOR 3 스위트는 **훅을 일부러 걸지 않아** 데몬 stamp 만으로 정답을 보증함을 증명한다 (M5 가 그것을 확인) |
| `main` fast-forward 가능 | `git merge-base --is-ancestor main p4-solver` | 참 |
| 잔여 | `ps`, `netstat` | `ggto-solver-cli` 0, 7791/7777 LISTEN 0 |

## 2. MAJOR 2 수정 뒤의 계약 (`route2.mjs` 실측)

| 케이스 | 결과 | 판정 |
|---|---|---|
| 다섯 파라미터 부분집합 30개 (`2^5 − 2`) | 전부 400 | 계약대로 |
| 다섯 전부 | 200 | |
| `sizings=standard` 만 (다섯 없음) | 200, `perm [0,1,2,3]`, 정규 보드 | "쿼리 없음" 으로 취급. 응답이 정규 공간이라 거짓말은 아니나 규칙과 어긋난다 — **MINOR R2-3** |
| `compressed=true` / `=0` / `=1` (비압축 솔브) | 200 / 200 / **400 HashMismatch** | `1` 만 참. `true` 가 거짓으로 읽히는 것은 함정 — **MINOR R2-2** |
| `rakePct=0` (레이크 없는 솔브) | 400 OutOfRange | `buildConfig` 가 pct 0 을 거부. 무해 |
| `potBb=abc` / `board=Ks7hXx` | 400 OutOfRange / 400 BoardSyntax | |
| 같은 집합의 다른 텍스트 (`TT+,AQs+` / `55-99,KJs+`) | 200 | 같은 해시 — 옳다 |
| `oop` 에 보드 카드 콤보 `KsQs` 추가 | **400 HashMismatch** | 제거 후 같은 게임인데 다른 해시. 원 레인지의 슈트 stabilizer 가 `{s 고정}` 으로 줄어 정규 보드가 달라진다 (R1 한계 1 = MINOR 12 의 다른 얼굴). 캐시 미스이지 오답이 아니다 |
| **커스텀 `sizings` 객체로 `POST`** (`confirm` 없이) | **200 `estimated`** | P4.md 3.2 "API 는 프리셋 이름만 받는다" 위반. 이런 행은 `permFor` 가 프리셋만 받으므로 표기 쿼리로 열 수 없다 (항상 400) — **MINOR R2-1**. 정규 모드는 된다 |
| 해시 재계산 비용 | 쿼리 없음 1.86ms → 있음 2.26ms (200회 평균) | +0.40ms. 무시 가능 |
| `board=2hKs7h` + `X-X/Qc` | `2hKs7hQc` | 사용자 순서 보존 + 딜 카드 뒤 |
| 턴 솔브 `Ks7h2hQc` + `X-X/9d` / `runouts X-X` / `runouts X-X/9d/X-X` | `river, Ks7h2hQc9d` / 4장 48카드 / 400 NotChanceNode | |
| 턴 솔브를 `Kd7s2sQh` 표기 + `X-X/9c` | `Kd7s2sQh9c`, line `X-X/9c`; φ=[2,0,3,1] 대응 EV 30/30 일치, 순열 무시 시 18 다름 | 리버 노드에서도 역순열 방향이 맞다 |
| 쿼리 없음 + `X-X/Qc` | `2c7cKdQc`, `perm [0,1,2,3]` | 정규 공간의 카드 세그먼트도 그대로 |
| `X-X/Ks` (보드 카드 딜) | 400 NoSuchLine | |

## 3. UNCERTAIN 1 — `compressed: true` 실험 설계 판정

개발 에이전트: "반복수 200 고정, plain vs packed 루트 EV 차 max 0.0751bb, 6/60 쌍 > 0.05bb → 압축 오차가 채점 임계를 넘을 수 있다."

**설계는 틀렸고 결론은 (다른 근거로) 맞다.**

- 반복수 고정 비교는 결정적이다 — 같은 설정을 두 번 돌리면 1326 배열이 **비트 단위로 같다** (실측 maxΔ 0.0000, 턴·플랍 둘 다). 그러니 0.075bb 는 재현 가능한 숫자다. 그러나 그것이 "압축 오차" 라는 해석은 성립하지 않는다: 같은 200회 **비압축** 솔브를 더 수렴한 비압축 기준(0.05%, 360 iter)과 비교하면 **max 0.2254bb, 10/60 쌍 > 0.05bb** 다. 200회의 두 솔브는 둘 다 미수렴이고, 압축과의 차이는 미수렴 오차의 1/3 이다. 차이의 정체는 양자화가 궤적을 흔든 것이지 저장 정밀도가 아니다.
- 바른 통제: **같은 목표 정확도로 수렴시킨 뒤 고정밀 기준과의 거리**를 모드별로 비교.

| 스팟 | 비교 (기준 = 비압축 0.05%) | maxΔev | meanΔev | >0.05bb |
|---|---|---|---|---|
| 턴 (60 쌍) | 비압축 0.1% | 0.241 | 0.028 | 5 |
| 턴 | 압축 0.1% | 0.211 | 0.027 | 7 |
| 턴 | 압축 0.05% | 0.107 | 0.010 | 2 |
| 플랍 77.6MB (102 쌍) | 비압축 0.1% | **0.060** | 0.018 | 6 |
| 플랍 | 압축 0.1% | 0.229 | 0.042 | 26 |
| 플랍 | 압축 0.05% | **0.222** | 0.036 | **23** |

- 턴에서는 압축이 문제가 아니다. **플랍에서는 압축이 0.05% 까지 수렴해도 0.22bb 떨어진 채 남고 비압축은 0.1% 에서 0.06bb 안으로 들어온다.** 큰 트리에서 i16 리그렛의 양자화 바닥이 실재한다. 이것이 "압축 솔브를 채점에 쓰지 않는다" 의 근거다 — 개발 에이전트의 표가 아니라 이 표다. 스펙 3.4-R 을 그렇게 다시 썼고 P5.md 가 D28 로 못 박는다.
- **P6 에 넘기는 사실** (`evloss.mjs`): 콤보별 EV loss 도 솔브 사이에서 흔들린다 — 턴에서 비압축 0.1% vs 0.05%: maxΔ(evloss) 0.257bb, Perfect(≤0.05bb) 판정 뒤집힘 2/60, 최적 액션이 바뀌는 콤보 3/30. 채점 임계 0.05bb 는 한 솔브 **안의** 비교에서만 의미가 있다. P6 스펙이 채점용 목표 정확도를 이 표로 정한다.

## 4. UNCERTAIN 2 — 조회 데몬 상한 판정

파일 합 기준 유지 + 기본 2GB → 1GB: **수용.** 배수 ×2.1 (327MB) 은 bincode 가 파일을 통째로 읽은 뒤 게임을 만드는 과도 구간과 할당자 미반환으로 설명된다 (재현하지 않았다 — 도메인 정확성과 무관한 자원 상한이고 보수적 방향이다). 16GB 머신: 솔브 게이트 8GB (실측 피크는 추정의 0.4~0.7배) + 데몬 ≤ 2.2GB + 서버·OS ≈ 12GB → 안전. 스펙 5.1 에 기록됨을 확인.

## 5. 설계 변경 8건

| # | 판정 |
|---|---|
| 1 `Solver.invalidate(hash)` | **수용.** 캐시는 솔버를 모르고(2절) 라우트만 둘을 안다. 대안(`ResultHandle` 을 캐시가 들고 있기)은 계층을 더 깬다 |
| 2 `onInvalidate` 등록 메서드 | **수용.** "생성자 옵션이면 `makeApp` 이 훅을 빠뜨린 채 통과했다" 는 실제 겪은 실패이고, 라우트에서 거는 것이 구조적으로 잊을 수 없다. 생성자 옵션도 남아 있다 (CLI 가 쓴다) — 중복이지만 무해 |
| 3 `runouts` 에 `board` | **수용.** chance 노드의 보드는 데몬만 안다. `parseRunouts` 가 없는 `board` 를 throw 로 막는다 |
| 4 `perm` 표지 | **수용.** P5 계약의 근거 (P5.md 1.2) |
| 5 반쪽 쿼리 400 | **수용.** 30개 전수 400 확인 |
| 6 데몬 상한 1GB | **수용** (4절) |
| 7 `FakeSolver` 가 `.bin` 에서 결과 | **수용 — 과하지 않다.** 헤더 JSON 한 줄 + FNV 시드는 "파일이 진실" 계약의 최소 흉내다. 가짜가 솔버 의미(전략·EV 값)를 흉내내기 시작하면 과한 것인데 그렇지 않다. 단 한계를 적어 둔다: 가짜는 `open` 마다 파일을 읽으므로 **데몬의 in-memory 낡음**은 못 잡는다 — 그것은 통합 테스트(M5)의 몫이고 실제로 잡았다. 서버 라우트 테스트가 잡는 것은 "훅이 안 걸렸다" 와 "commit 이 파일을 안 바꿨다" 다 |
| 8 DESIGN 3.3·144·279행 `.` → `-` | **수용.** R1 MINOR 2 닫힘 |

## 6. 알려진 한계 3건

| # | 판정 |
|---|---|
| 훅 fire-and-forget | **수용.** 정답 보증은 stamp (M5 가 증명). 훅은 메모리 조기 회수. 순서 보장을 넣으면 캐시 쓰기가 데몬 생사에 묶인다 — 더 나쁘다 |
| mtime 100ns 충돌 | **수용.** 같은 크기 + 같은 100ns 틱은 실용상 불가능하고, 훅이 2차 방어 |
| MINOR 12 이월 | P5.md 12절에 배치했다 (P5 9건 + P6 2건 + 닫힘 1건) |

---

## CRITICAL

없음.

## MAJOR

없음.

## MINOR (P5 이월 — `docs/specs/P5.md` 12절 R2 MINOR 1~4)

1. **[`packages/server/src/routes/solve.ts` POST] 커스텀 `sizings` 객체를 받아들인다.** P4.md 3.2 77행 "API 는 프리셋 이름만 받는다" 위반 (R1 부터 있었고 내가 놓쳤다). 실측: `{flop:{bet:'33%',raise:'2.5x'},…}` → 200 `estimated`. MAJOR 2 의 수정으로 이런 행은 표기 쿼리로 열 수 없다 (`permFor` 가 `isSizingPreset` 만 허용 → 항상 400). 오답은 아니다 (정규 모드는 된다). P5: `isSizingPreset` 아니면 400 `OutOfRange`; CLI 커스텀 솔브는 정규 모드로만 (P5.md 1.1).
2. **[`solve.ts:151`] `compressed` 쿼리는 문자 `1` 만 참.** `compressed=true` 가 거짓으로 읽혀 압축 솔브에 `HashMismatch` 를 낸다. `1`·`true` 참, `0`·`false`·없음 거짓, 그 외 400.
3. **[`solve.ts:126-136`] `sizings`·`compressed`·`rakePct` 만 있는 쿼리가 "쿼리 없음" 으로 취급된다.** 다섯 파라미터 규칙과 어긋난다. 설정 파라미터가 하나라도 있으면 다섯을 요구하라.
4. `Solver.invalidate` 순서 미보장 — 수용, 문서만 (6절).

## UNCERTAIN

없음.

---

## `main` 머지

`main` (`7f1000e`) 은 `p4-solver` 의 조상이다. **fast-forward 한다** — 이 리뷰·스펙 커밋을 `p4-solver` 에 올린 뒤 `git checkout main && git merge --ff-only p4-solver`.

## 다음 페이즈 진행 가능 여부

가능하다. **P5 = 포스트플랍 탐색 UI**, 스펙은 `docs/specs/P5.md`. 첫 절이 `node`/`runouts` 의 클라이언트 측 계약 (정규/표기 두 모드, `perm` 표지, `line` 조립, 노드 종류는 서버 코드로만 판별)이고, 서버·데몬 변경은 `ChanceNode` 오류 코드 하나와 12절 이월 항목뿐이다. 모바일 375px 한 열이 기본 설계 대상이며 하단 고정 바의 액션 버튼이 P6 트레이너의 답 버튼 자리가 된다. P4 R1 MINOR 12건 + R2 MINOR 4건의 배치는 P5.md 12절. 개발 에이전트는 P5.md 8.4 DoD 와 13절(리뷰어가 돌릴 것)을 읽고 시작한다.
