# P3 리뷰 — 라운드 2

리뷰어: ggto-architect. 날짜: 2026-09-12. 대상: 커밋 `989cd65` (R1 MAJOR 1~3 + MINOR 2 + UNCERTAIN 1). 범위는 R1 에서 정한 대로 그 다섯 항목과 회귀만. origin/main 은 `11d264a` (989cd65 + 문서/SVG 5파일, 코드 변경 없음 — `git diff --stat 989cd65 origin/main -- packages web tools` 빈 출력) 이라 fresh clone 은 `11d264a` 로 돌았고 코드는 동일하다.
스크래치: `drawseed-alg.mjs`, `seed-overlap2.mjs`, `srs-e2e2.mjs`, `legacy-db.mjs`, `kill/orderProbe.mjs`+`kill/run.mjs`, `mixed-rate.mjs`, `mixed-api2.mjs`, R1 의 `grade100.mjs`/`gate35.mjs`/`sampler-chi.mjs` 재사용, `fresh-r2b/` (origin 클론 + `summary.log`), `legacy/`·`srv/` (R1 리뷰 서버가 남긴 **폭주 행이 실제로 든** `trainer.db` 사본), `ci-r2.log`, `bench-strict-r2.log`.

## VERDICT: APPROVED

CRITICAL 0, MAJOR 0, MINOR 4 (신규, 전부 테스트 견고성·레거시 정리), UNCERTAIN 0. 세 MAJOR 는 내 방식으로 재현해 닫혔고, 회귀 5종은 R1 과 동일 값이다.

## 검증한 것 (실행 근거)

| 항목 | 방법 | 결과 |
|---|---|---|
| **MAJOR 1 — 실경로 Perfect ×151** | `srs-e2e2.mjs`: 파일 DB, `TrainerStore.setPending` 으로 같은 키를 pending 으로 두고 `service.answer` 에 argmax 액션 151회. 매회 `getSrs` 로 읽어 다음 `now` 를 `dueAt+1s` 로 | throw **0**, 151/151 Perfect, 최종 `{reps 151, ease 17.6, intervalDays 365, dueAt 6410620950000}`. BigInt 로 원시 읽기: `due_at 6410620950000n typeof integer` — 클램프 없이도 안전 범위 |
| **MAJOR 1 — 바인딩 경로** | `node:sqlite` 에 `SELECT typeof(?)` 로 31537000000 / 1.04e16 바인딩, STRICT INTEGER 열에 BigInt·double 삽입 후 `MIN(due_at, ?)` | JS number 는 정수여도 **REAL 로 바인딩**된다 (`typeof(?) = 'real'`). `MIN(due_at, cap)` 은 cap 이 작으면 REAL cap 을, 아니면 INTEGER due_at 을 돌려준다 → 2^53 초과 정수가 JS 로 변환되는 지점이 없다. 같은 연결에서 원시 `SELECT due_at` 은 `ERR_OUT_OF_RANGE` throw 확인 (테스트의 전제가 진짜다) |
| **MAJOR 1 — 진짜 레거시 DB** | `legacy-db.mjs`: R1 리뷰 서버의 `trainer.db` 사본 (srs 248행) 을 새 코드로 연다 | `due_at > 2^53` 행 **27개** (최대 10444497535480156, reps 16, interval 120,864,680), `now+366d < due_at ≤ 2^53` 행 73개. `getSrs`/`dueSpots`/`leechSpots`/`srsCounts` 전부 throw 없음, `getSrs.dueAt === now+365d`. **R1 에서 영구 정지했던 세션 #17 (14/100)·#20 (17/100)** — pending 이 깨진 행이었고 — `next` → `answer` **성공** (14→15, 17→18), 다음 `next` 가 새 스팟. 깨진 행을 pending 으로 강제 후 답 → `interval 1, reps 0`, 원시 읽기 정상 (치유). user_version 은 1 그대로 |
| **MAJOR 2 — 대수** | `drawseed-alg.mjs` (`mix32`/`drawSeed` 를 소스에서 그대로 복사, R1 판 병기) | `drawSeed(s,i)==drawSeed(s^i,0)`: s<2^16 × i<64 = 4,194,304 쌍 중 **65,536 (i=0 자명 경우뿐)**, R1 판은 4,194,304/4,194,304. 세션 간 rng 시드 충돌 (s vs s+1/s+2/s^1/s^2/s^3/s^7, 각 64문항): **0/1,572,864**, R1 판 1,560,576. `mix32` 2^22 연속 입력 충돌 0 (전단사), 눈사태 16.01/32, `drawSeed` 시드 1비트 → 16.02/32. 10만 세션 × 50문항 세션 내 중복 0 |
| **MAJOR 2 — 실측** | `seed-overlap2.mjs`: 실제 서비스, 50문항 스팟 **집합** | 인접 (s vs s+1,2,3,4,8,16; s = 1..8, 100, 101, 5000..5002, 123456, 99999999, 2^30, 2^31−2) **102쌍 평균 0.17, 최대 2**. XOR 인접 (s^1,2,3) 최대 1. 무작위 먼 시드 40쌍 **평균 0.17, 최대 1** — 인접과 무작위가 같다. 같은 시드 두 번 동일 |
| **MAJOR 3 — fresh clone** | `fresh-r2b/run.sh`: `core.autocrlf=true` (시스템 gitconfig, 클론 안에서 `git config --get` 로 확인) → `git clone` → `npm install` → `npm run seed` → `npm run ci` | `git ls-files --eol` 픽스처 8파일 전부 `i/lf w/lf attr/text eol=lf`, `w/crlf` **0**. 시드 산출물 6파일 sha256 = 픽스처 6파일 sha256 **전부 동일**. `INSTALL_EXIT=0 SEED_EXIT=0 FRESH_CI_EXIT=0`, 테스트 131/45/69/99/73/23/8 = **448**, smoke OK. 레포에 `.bat/.cmd/.ps1` 없음 (eol=lf 가 깨뜨릴 파일 없음) |
| **UNCERTAIN 1 — kill 지점** | `kill/orderProbe.mjs`: `DatabaseSync.prototype.prepare/exec` 를 감싸 실행된 SQL 을 기록, `ease` 게터에서 로그를 파일로 쓴 뒤 SIGKILL | 덫 직전 실행 순서 `BEGIN IMMEDIATE → GET pending_key → RUN INSERT INTO attempt` — 주장대로 **attempt INSERT 직후·srs UPSERT 직전**이 맞다. kill 후 `attempt 0 / srs 0 / answered 0 / pending 유지` — 트랜잭션으로 묶여 있다 (새 MAJOR 없음) |
| **UNCERTAIN 1 — 테스트의 변별력** | 같은 프로브를 `throw` 모드로, 그리고 실제 `killRunner.mjs` 를 잘못된 DB 경로로 | Windows 에서 `process.kill(SIGKILL)` 종료코드 **1**, 미처리 예외 종료코드 **1**, `killRunner` 경로 오류도 **1**. throw 모드 카운트도 0/0/0. 테스트는 `status ∉ {0,3}` 만 보므로 **"죽였다" 와 "던지고 롤백했다" 를 구분하지 못한다** → MINOR 1 |
| **회귀 — 채점 100** | `grade100.mjs` (7778 리뷰 서버, 레거시 DB 위에서) | maxDelta **0**, mismatch **0/100**, 12노드, 키 100 유일, done + attempts 100. `/next` 전문 grep: `"ev"` 100/100 (전부 `gradedBy` 값), `"ev":`·`strategy`·`reach`·길이≥100 배열 **0** |
| **회귀 — 혼합 저빈도 Perfect** | `mixed-rate.mjs` 무작위 시드 200세션 × 100 인프로세스; `mixed-api2.mjs` 무작위 시드 API | 2만 문항 중 혼합 98 (0.49%), **98/98 Perfect·mixed**. API 무작위 24세션: 첫 800 에서 0건 (p≈2%, 비율상 우연), 1100 까지 **7건 7 Perfect** (예: 8bb root Qd4c `F 80.9% / A 19.1%` → A → loss 0) |
| **회귀 — 3.5 게이트** | `gate35.mjs` (`data/ggto.db` 직접 해독) | 15,988 / 최악 1.070e-4 bb (20bb root F c=792) / 혼합 76 / 합≠1 0 — R1 과 동일 |
| **회귀 — 샘플러 χ²** | `sampler-chi.mjs` | χ² 143.8 / df 165, 5분위 0.987~1.035 — R1 과 동일 |
| **`npm run ci` (메인)** | `ci-r2.log` | `CI_EXIT=0`, 448, smoke OK |
| **`bench:strict`** | `bench-strict-r2.log`, 다른 작업 없이 | `BENCH_STRICT_EXIT=0`, load 27/22/20% (외부 10/5/4%), 전부 ENFORCED. trainer cycle 2051ms/6000 |
| **MINOR 2** | `TrainerPage.tsx:285` diff + `grep -rn "정답\|오답\|맞았\|틀렸" web/src` | JSX 문구 교체됨. 남은 매치는 `trainer.ts:4`·`GradeBox.tsx:2` 주석 2건뿐 (렌더 안 됨). 테스트 `P3 0.3` 2건은 출제 화면에서 안내문이 렌더됐는지 먼저 확인한 뒤 4단어를 검사 — 빈 화면 통과 아님 |

## 1. 세 수정의 판정

- **MAJOR 1 닫힘.** 상한 위치(두 분기 뒤 한 번)가 맞다: 레거시 `intervalDays 1.2e8` 이 들어와도 `round(1.2e8 × 4.1)` 뒤 365 로 떨어진다 (테스트 `상한 이전에 저장된 비정상 간격` + 내 레거시 DB 치유 실측). `ease` 상한 없음은 스펙대로이고 151회에 17.6 — interval 이 막혀 있으니 무해하다. 읽기 클램프는 SQLite 안에서 끝나고 JS 로는 REAL cap 또는 안전 범위 INTEGER 만 온다. `srsCounts` 는 COUNT 만 읽어 원래 안전했다.
- **MAJOR 2 닫힘.** `mix32(seed)` 를 먼저 통과시켜 index 덧셈이 XOR 과 다른 군에서 일어나므로 항등식이 깨졌고, 실측 교집합이 무작위 쌍 수준(0.17)이다. 개발 에이전트가 제시한 "수정 전 48/50/46/45/48" 은 **테스트에 박혀 있지 않다** — 일회성 측정이다. 테스트는 `≤ 5` 상한만 건다. 그걸로 충분하다: R1 판이 돌아오면 46~50 이라 즉시 걸리고, "수정 전 값" 을 테스트에 넣는 것은 옛 구현을 다시 들여오는 일이다. 반려하지 않는다.
- **MAJOR 3 닫힘.** `autocrlf=true` 새 클론에서 `w/crlf` 0, 시드 = 픽스처 바이트 동일, ci 0. 단 **개발 PC 작업 트리**는 renormalize 뒤 재체크아웃을 안 해 `.claude/agents/*.md`, `docs/assets/agent-loop.svg`, `packages/preflop/test/validate.test.ts` 4파일이 `i/lf w/crlf` 로 남아 있다 (`git ls-files --eol | grep w/crlf`). 인덱스는 LF 라 커밋에 영향 없고 새 클론엔 없다 — `git checkout -- .` 한 번이면 된다 (MINOR 4).

## 2. UNCERTAIN 1 (kill 테스트) 판정

- **결정적인가**: 현재 소스에서는 그렇다 (프로브로 SQL 순서 확인). `this.#db.prepare(...).run(a.spotKey, srs.ease, …)` 는 수신자 식이 먼저 평가되고 인자가 좌→우로 평가되므로 attempt INSERT 실행 뒤·srs 문 `run` 전에 게터가 돈다. 그러나 **구현 순서에 의존**한다: srs UPSERT 가 attempt INSERT 앞으로 가면 덫이 아무 쓰기도 없는 지점에서 터지고 테스트는 조용히 통과한다 (`store.test` 의 롤백 테스트와 같은 것만 증명). 순서 가드가 없다.
- **불변식**: 맞는 것을 검사한다 (attempt·srs_state·answered·pending 이 함께 없거나 함께 있다). 이 넷은 묶여 있어야 하고 (`P3.md` 4절) 묶여 있다 — 새 MAJOR 아님.
- **변별력**: 위 표대로 kill 과 throw 가 같은 종료코드·같은 카운트다. 현재는 `after` 케이스가 "dist 없음/구현 오류" 를 대신 잡아 주지만, `mid` 케이스 단독으로는 아무것도 증명하지 못하는 경로가 있다. 고치는 값이 싸다 (MINOR 1).

## 3. 개발 에이전트가 밝힌 것 — 수용/반려

| 항목 | 판정 |
|---|---|
| 레거시 행 일괄 마이그레이션 안 함, `user_version` 1 유지 | **수용 (조건부, MINOR 3)**. DDL 이 안 바뀌었으니 버전은 1 이 맞다 — 2 로 올리면 P2 4.1 규칙상 업그레이드 경로가 있어야 하는데 없다. "동작상 손해 없다" 는 절반만 맞다: 읽기·답은 살아나지만 `due_at` 이 수천만 일 뒤인 100행 (27 + 73) 은 **SRS 가 다시 잡지 않는다** — 5.2 무작위 추첨으로 우연히 나올 때만 치유된다 (풀 ~7,000 스팟이라 100문항 세션 기준 수십 세션). 사용자 DB 에 그런 행이 있는지는 알 수 없다. 스키마 버전 없이 **멱등 UPDATE 한 줄** (`interval_days = MIN(interval_days, 365), due_at = MIN(due_at, updated_at + 365d) WHERE interval_days > 365`) 을 `TrainerStore` 생성자에서 돌리면 끝난다. 지금 막지 않는다 |
| `kill.test` 자식이 `dist` import, 없으면 throw | **수용 (MINOR 2)**. `npm test` 는 `pretest` 로 빌드하니 ci 경로는 항상 새 dist 다. 그러나 `packages/trainer` 에서 `vitest run` 만 돌리면 **오래된 dist 를 시험하고도 초록**이다 (없을 때만 throw, 낡았을 때는 침묵). `dist/store.js` mtime < `src/store.ts` mtime 이면 throw 하는 한 줄이면 된다 |
| `service.test` leech 테스트 시드 비의존화 | **정당하다**. 옛 판은 `seed: 4` 의 동전이 3연속 앞면인 데 기대고, 아니면 `break` 로 빠져나가 `leeches 1` 단언에서 실패했다 — 시드 혼합 함수를 바꾸면 깨지는 게 당연했다. 새 판은 due 스팟이 나올 때까지 시드 4000+i 를 최대 50개 시도하고 못 찾으면 **throw** (조용히 통과 아님). 핵심 단언 — `leeches 1`, 시드 500~504 **5개 세션 전부** 첫 스팟이 그 leech — 는 그대로다. 회귀를 숨긴 것이 아니다 |
| `getSrs(spotKey, now)` 시그니처 | **수용**. 저장소는 시계를 갖지 않는 설계 ("여기는 SQL 만 안다") 이고 `dueSpots`/`leechSpots` 도 이미 `now` 를 인자로 받는다. 일관적 |
| 스펙 R2 개정·P3M.md·리뷰 에셋이 같은 커밋 | 내용 확인. 코드 diff 와 섞여 있지만 문서는 리뷰어 산출물이라 문제 없음 |

## CRITICAL

없음.

## MAJOR

없음.

## MINOR (P4 이후로 미룬다 — `docs/specs/P3M.md` 13절에 배치)

1. [`packages/trainer/test/fixtures/killRunner.mjs:56`, `kill.test.ts:34`] `mid` 케이스가 **SIGKILL 과 throw 를 구분하지 못한다** — Windows 에서 둘 다 status 1, 카운트도 같다 (`kill/run.mjs`). 그리고 srs UPSERT 가 attempt INSERT 앞으로 옮겨져도 조용히 통과한다. 고칠 것: (a) `a.createdAt` (attempt 문의 마지막 인자) 에도 게터를 두어 `attemptArgsRead = true` 를 세팅하고, `ease` 게터는 그 플래그가 없으면 `process.exit(5)`; (b) `process.on('uncaughtException', () => process.exit(4))`; (c) 게터가 kill 직전에 마커 파일을 쓰고 부모가 마커 존재 + `status ∉ {0,3,4,5}` + `stderr` 에 `Error` 없음을 단언.
2. [`killRunner.mjs:17`] dist 가 **낡았을 때** 침묵. `statSync(dist/store.js).mtimeMs < statSync(src/store.ts).mtimeMs` 면 throw.
3. [`packages/trainer/src/store.ts` 생성자 또는 `schema.ts migrate`] 레거시 폭주 행 멱등 정리 UPDATE (위 3절). 버전 bump 불필요. 리뷰 DB 기준 100행이 SRS 큐에서 사실상 빠져 있다.
4. [개발 PC 작업 트리] `i/lf w/crlf` 4파일 — `git checkout -- .` (커밋 불필요, 새 클론 무관).

## UNCERTAIN

없음.

## 다음 페이즈 진행 가능 여부

**P3 APPROVED. 다음은 P3M (모바일 UX)** — R1 에서 정한 P3M → P4 순서 그대로다. 스펙 `docs/specs/P3M.md` 는 이미 있고 이 라운드에서 갱신만 했다: 시작 조건 충족 표시, 8.1 의 D8 UI 테스트가 P3 R2 에서 이미 들어갔음을 반영, 8.3 의 web 테스트 기준 수 73, 9절 H1 닫힘, **13절 신설 — P3 이월 항목의 P3M/P4 구분** (P3M: R1 MINOR 1·4·8; P4 이후: R1 MINOR 3·5, R2 MINOR 1·2·3; P6: R1 MINOR 6; 닫힘: R1 MINOR 2·7). P3M 은 `web/src` + `tools/shots` + `main.ts` host 한 줄이며 `packages/*` 도메인 코드는 손대지 않는다 — 그래서 trainer 테스트 견고성(R2 MINOR 1·2)과 레거시 정리(R2 MINOR 3)는 P4 첫 커밋으로 미룬다. 개발 에이전트는 P3M.md 8.4 DoD 순서대로 진행하고, 리뷰어는 12절대로 Browser 도구 세 프리셋 × 3 페이지로 검수한다.
