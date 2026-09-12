# P3 리뷰 — 라운드 1

리뷰어: ggto-architect. 날짜: 2026-09-12. 대상: 커밋 `57e7184` (P3 전체 — 이전 세션 산출물 + 이번 세션 신규분: `equityTable.test.ts` 전수 단언, `web/test/TrainerPage.test.tsx` 13건, `ChartsPage.test.tsx` reach 패널, DESIGN/DECISIONS 갱신, 스크린샷 6장). 스펙 `docs/specs/P3.md` — **본 라운드에서 R2 소폭 개정** (3.2 `facingJam` 식, 5.3 간격 상한·문항 시드 혼합 규칙, 12 DoD 1 fresh clone 절차 + `.gitattributes`, 문서 끝 개정 이력).
스크래치 (세션 스크래치패드): `gate35.mjs`, `grade100.mjs`, `mixed-api.mjs`, `mixed-service.mjs`, `sampler-hist.mjs`, `sampler-chi.mjs`, `seed-overlap.mjs`, `srs-overflow.mjs`, `equity30.mjs` (+`equity30.log`), `latency.mjs`, `mobile-shot.mjs`, `heavy.sh` (`ci.log`, `bench-strict.log`, `fresh-*.log`), `fresh/` (origin 클론), `data/` (리뷰 전용 `GGTO_DATA_DIR`, 포트 7778 서버), `server.log`.
측정 환경: 6코어, 리뷰 중 백그라운드 부하는 내 스크립트뿐 (`bench:strict` 외부 부하 7~16%).

## VERDICT: CHANGES_REQUIRED

CRITICAL 0, **MAJOR 3**, MINOR 8, UNCERTAIN 1. 포커 도메인 로직(채점·3.5 게이트·샘플러 비례·정확 에퀴티 표·답 유출 차단)은 전부 내 방식으로 재현했고 **틀린 것이 없다**. 막는 것은 (1) SRS 간격이 무한히 자라 `due_at` 이 2^53 을 넘으면 `node:sqlite` 읽기가 던져 **세션이 영구히 멈추는 것**, (2) 문항별 rng 시드가 `seed XOR index` 라 **인접 시드 세션이 같은 스팟 집합을 뽑는 것**, (3) Windows 새 클론에서 `npm run seed` 뒤 `npm run ci` 가 **CRLF 로 빨간불**이 되는 것. 셋 다 수정이 작다 (각각 상한 1줄 + 테스트, 혼합 함수 3줄 + 테스트, `.gitattributes` 1줄 + renormalize).

## 검증한 것 (실행 근거)

| 항목 | 방법 | 결과 |
|---|---|---|
| **`npm run ci`** | 루트에서 (`ci.log`) | `CI_EXIT=0`. 테스트 core 131 / preflop 45 / server 69 / web 90 / trainer 71 / chart-gen 23 / chart-import 8 = **437**. smoke 16/16 (트레이너 5항목 포함, 임시 `GGTO_DATA_DIR`) |
| **`npm run bench:strict`** | 루트 (`bench-strict.log`) | `BENCH_STRICT_EXIT=0`. `load 23% (외부 7%)` core / `26% (9%)` preflop / `33% (16%)` trainer — 전부 **ENFORCED (--strict)**, 예산 내. trainer: next()+answer() ×1000 (기록 1만 행) 2060ms / 6000, grade ×10000 0.9ms, report 36.6ms |
| **fresh clone** | `git clone https://github.com/Sijun52/ggto.git` → `npm install` → `npm run ci` (`fresh-*.log`) | install exit 0, **`FRESH_CI_EXIT=0`** (437, smoke 10/10 — 시드 없는 경로). 이어서 `npm run seed`: **6초**, 6개 `skipped:false`, `content_hash` 6/6 이 메인 DB 와 **동일** (`deb0595b…`, `d646c8a2…`, `5622f2ee…`, `9e09d8de…`, `f30fc450…`, `67311975…`), `data/charts/*.json` 6개 메인과 **바이트 동일**. **그러나** 그 클론에서 `vitest run test/fixtures.test.ts` → **1 failed** (`hu-pushfold-10bb.json drifted from data/charts`): `git ls-files --eol` = `i/lf w/crlf` — `core.autocrlf=true` 인 이 PC 에서 픽스처가 CRLF 로 체크아웃되고 시드는 LF 로 쓴다. `.gitattributes` `*.json text eol=lf` 를 넣고 다시 체크아웃하니 **바이트 동일** 로 복구됨 → MAJOR 3 |
| **3.5 실데이터 게이트 (독립)** | `gate35.mjs`: `@ggto/preflop` 을 쓰지 않고 `node:sqlite` + `zstdDecompressSync` + `DataView` f32 LE 로 블롭 직접 해독 | 12 노드, `freq ≥ fround(0.01)` 쌍 **15,988** (f64 0.01 로 세도 15,988 — 경계 차이 없음), 최악 EV loss **1.070e-4 bb** (20bb root `F` c=792, freq 0.158), 혼합 콤보 **76**, 전략 행 합 ≠ 1 인 콤보 0. 개발 보고 (15,988 / 1.070e-4 / 76) 와 **일치** |
| **3.3 채점 = 스펙 수식 (API 대조)** | `grade100.mjs`: 포트 7778 실서버, 100문항 세션. 매 스팟을 블롭에서 직접 읽어 `best = max ev`, `loss = best − ev[chosen]`, verdict 경계, argmax, mixed, chosenFreq 를 손으로 계산 → API `grade` 와 비교 | **maxDelta 0, 불일치 0/100** (verdict·bestAction·mixed·chosenFreq 전부). 12 노드 전부 출제됨, 키 100개 전부 유일, 끝나면 `done + report.totals.attempts 100` |
| **혼합 스팟 저빈도 → Perfect (D8)** | `mixed-service.mjs`: 시드 6개의 혼합 콤보 **76개 전부**에 대해 `TrainerStore.setPending` 으로 pending 을 그 키로 강제 → `service.answer` 에 **저빈도 액션** | **76/76 Perfect**, `mixed:true` 76/76, 최대 loss 1.07e-4 bb. 예: 10bb root 43s `F=29.2% A=70.8%` → F 선택 → Perfect loss 0; 10bb `A` BB `F=59.6% C=40.4%` → C → Perfect 5.3e-5. 빈도 일치 채점의 흔적 없음 (`grade.ts` 는 argmax ev 만 본다, 빈도는 `chosenFreq` 표시용) |
| **답 유출 (브라우저, 직접 관찰)** | Browser 도구 1280×720, `window.fetch` 래핑 후 3문항 세션 완주 | 답 전 요청 = `POST /api/trainer/session` (44 B), `GET /api/trainer/next` (523 B, `strategy`/`"ev":`/`reach` 없음, **가장 긴 배열 길이 2**). `strategy`·`ev`·`reach` 는 `POST /api/trainer/answer` 응답(45,851 B, 1326 배열)에서 **처음** 나타남. 세션 내내 `/api/charts/*/node|range` 호출 **0**. 키보드 `1` 로 답한 스팟도 answer POST 1건뿐 (중복 없음) |
| **13절 grep `ev` 거짓 양성** | `grade100.mjs` 에서 `/next` 응답 전문에 `"ev"` 와 `"ev":` 를 따로 grep | `"ev"` **100/100 매치** — 전부 `"gradedBy":"ev"` 값. `"ev":` 키 형태 **0/100**. 개발 에이전트의 사전 고지가 맞다. 13절 문구는 "키 형태 `\"ev\":` 부재 + 1326 길이 배열 부재" 로 읽는다 (R2 개정에 반영) |
| **샘플러 (합성 3노드)** | `sampler-hist.mjs` / `sampler-chi.mjs`: HU 100bb 합성 셋 (root SB `F/R2.5` 빈도 h/168, `R2.5` BB 3액션, `R2.5-R8` SB) 를 `:memory:` 저장소에 임포트, `drawSpotKey` 2만/20만 회 | 노드 빈도 0.387/0.390/0.223 vs 기대 `mass×(1+0.5·mixedMass)` 비례 0.386/0.389/0.225. reach 0 콤보 출제 **0회**. `R2.5-R8` (SB reach = root 레이즈 빈도) 20만 회: 클래스별 χ² **143.8 / df 165**, reach 5분위 질량비 0.987~1.035 (±5% 이내). 같은 시드 2회 → 25키 **동일**, 다른 시드 → 다름 |
| **문항 시드 혼합 (발견)** | `seed-overlap.mjs`: 시드 s 와 s+1 세션(50문항) 의 스팟 **집합** 교집합 | **5000∩5001 = 46/50, 5000∩5002 = 48, 1∩2 = 48, 2∩3 = 50/50** (순서만 다르고 집합이 같다). 먼 시드 (7, 123456, 99999999, 2^30) 는 0~1/50. 원인: `service.ts:87 drawSeed` 가 `(seed ^ C) ^ index` 로 시작 → `drawSeed(s, i) ≡ drawSeed(s ^ i, 0)` → MAJOR 2 |
| **SRS 간격 폭주 (발견)** | 리뷰 서버에 인접 시드 세션 16개(5000~5015)를 돌리자 같은 84개 스팟이 **16회씩** 복습됨 → `server.log` 에 `RangeError: Value is too large to be represented as a JavaScript number: 10444497534716632 at TrainerStore.getSrs` **1,198,492줄**, 세션 17·20 은 pending 이 남은 채 영구 정지. `srs-overflow.mjs` 로 결정적 재현 | Perfect ×16: reps 16, ease **4.10**, interval **120,864,680일**, `dueAt 1.04e16 > 2^53`. 그 행을 `recordAnswer` 로 저장한 뒤 `getSrs` **throw**, `dueSpots` **throw** (`srsCounts` 는 통과). `answer` 가 500 → pending 이 지워지지 않음 → `next` 는 같은 스팟만 반환 → **트레이너 전체가 막힌다** → MAJOR 1 |
| **정확 에퀴티 표** | `equity30.mjs`: 시드 20260912 로 30쌍 무작위, **궤도 축약 없이** 겹치지 않는 콤보 순서쌍 전부를 core `equityHandVsHand` 전수 (쌍당 12~144회 × C(48,5)) | **최대 편차 4.71e-7** (< 1e-6, 파일 반올림 5e-7 이내), 대칭 `1 − t[j][i]` 위반 0. 예 `J6o vs J7o` 108쌍 0.3613246 vs 표 0.361325. `equityTable.test.ts` 의 AA vs KK 단언도 같은 방식(36쌍 전수) — MC 표였다면 1e-3 규모로 벌어져 통과 못 한다 |
| **DoD 6 (20문제 완주)** | `data/trainer.db` 를 `node:sqlite` 읽기 전용으로 | session 1: count 20 / answered 20 / finished, attempt **20** (`graded_by` ev 20), srs_state **20**, verdict Perfect 11 · Minor 3 · Mistake 5 · Blunder 1, 평균 0.19929 bb → bb/100 **19.93** (보고와 일치). mixed 0/20 (혼합 콤보는 12×1326 중 76 = 0.48% 라 정상) |
| **세션/30d 리포트 (브라우저)** | 3문항 세션 리포트 화면 텍스트 | 총계 3/3 mean **0.624** = (0 + 1.871 + 0)/3, open 2 (Perfect 1 Blunder 1), vs_jam 1, bySet 3행. 30d 탭이 `GET /api/trainer/report?days=30` 호출 |
| **2절 grep 게이트** | `packages/trainer/src` import / server SQL / web `@ggto/trainer` / `any`·`@ts-ignore`·`TODO`·빈 catch / 핸드 리터럴 / 169 계산 / `Math.random` | **전부 0** (`Math.random` 은 주석 1건). `web/src` 핸드 리터럴은 `DEFAULT_RANGE_TEXT` 하나 |
| **10절 이월 표** | 파일 직접 확인 | 10.0 정확 표 ✓ (`mode:'exact', samples:null`, sha `3fb85cb1…`, 시드 재생성 해시 위 표) · 10.1 `usePageTitle` 3페이지 ✓ · 10.2 `ReachPanel` + 테스트 ✓ · 10.3 ✓ · 10.4 smoke 항목명 ✓ · 10.5 `jsonShape`/`validate`/`ChartsPage` 분할 ✓ (단 `service.ts` 341줄 신규 초과 — MINOR 3) · 10.6 `charts.ts:82` `use "A" for all-in (D10)` ✓ · 10.8 `benchHarness.test.ts` `P2 10.2`/`10.3`/`R3 MINOR 1`, `loadExternal` JSON ✓ |
| **11절 문서** | diff 읽음 | DESIGN 1절 저장소 행 두 파일 ✓, 6.4 → "P3.md 4절이 대체" ✓, 로드맵 P3/P6 ✓, D16·D17 ✓ |
| **새 의존성** | `packages/trainer/package.json` | `@ggto/core`, `@ggto/preflop` 만. 루트 `package-lock` 변경 없음 |
| **신규 테스트 동어반복 여부** | `TrainerPage.test.tsx` 13건 읽음 | 동어반복 아님: fetch 를 URL 목록·응답 원문으로 검사, `drawGrid` 를 모킹하지 않고 `fillRect` 횟수 (169 = 배경만, 답 후 169 + `buildChartCells` 로 시드에서 센 레이어 수), 43s 는 실제 시드 픽스처. `gradeFromFixture` 는 **가짜 서버 응답용** 스펙 수식 복제이고 실제 채점기는 trainer 테스트 + 내 `grade100` 이 본다. `ChartNodeView` 공유 테스트의 소스 문자열 검사는 취약하지만 틀리진 않다 |
| **HTTP 지연** | `latency.mjs` (keep-alive fetch) | health 0.8ms, pool 3.5ms, node 1.3ms, `next` 0.6ms, **next+answer 4.1ms** (파일 DB). curl 로 잰 100/200ms 는 Windows 루프백 연결 비용이었다 — 문제 없음 |
| **모바일 (요구 1)** | headless Chrome CDP 375×812 DPR2 `mobile:true` (`mobile-shot.mjs`) + Browser 도구 `preset: mobile` | `docs/reviews/assets/mobile-*.png` 9장. 결과는 `docs/specs/P3M.md` 1절. 요지: 격자 520px 고정 때문에 **layout viewport 가 562px 로 넓어져 전체가 0.67배 축소** (innerWidth 562), 답 버튼 28px, 답 후 verdict·"다음" 이 화면 밖, 30d 표 7열 충돌 |

## 1. 채점 — 맞다 (P3 의 관문)

`grade.ts` 는 `best = argmax_a ev[a][c]` (빈도 0 액션 포함), `loss = max(0, best − ev[chosen])`, 경계 `< 0.05 / 0.3 / 1.0` 그대로다. 빈도는 `chosenFreq`·`mixed` 표시에만 쓰인다. 76개 혼합 콤보 전부에서 저빈도 쪽이 Perfect (표), 100 무작위 API 채점이 내 손계산과 1e-6 이내(실제로는 0) 일치, 3.5 게이트가 독립 해독으로 재현됐다. `MIX_EPS_F32 = fround(0.01)` 로 f32 경계를 맞춘 것도 확인했다 (f64 0.01 과 세어도 15,988 로 같았지만 그것은 이 시드에 경계값이 없어서다 — 판단은 옳다).

## 2. 발견 3건의 근거

- **MAJOR 1 (SRS 폭주 → 정지)**: `srs.ts` 는 `ease += 0.1` 에 상한이 없고 `interval = round(interval × ease)` 에도 상한이 없다. 16회 연속 Perfect 면 interval 1.2e8 일, `due_at` 1.04e16 ms. `srs_state.due_at INTEGER` (STRICT) 에 정수로 저장되고, `node:sqlite` 는 2^53 초과 정수를 **읽을 때 throw** 한다 (`readBigInts` 미사용). `getSrs` 가 `answer()` 안에 있으므로 `answer` 가 500 이고, 트랜잭션 전이라 pending 은 그대로 → 사용자는 그 스팟에서 영원히 못 나간다. 실사용에서 도달하려면 같은 스팟을 16번 Perfect 로 봐야 하는데, 정상 시드는 무작위라 드물지만 (a) MAJOR 2 처럼 시드가 관련되면 즉시 (내가 그렇게 밟았다), (b) due 큐는 복습할수록 그 스팟을 다시 내므로 장기적으로 반드시 자란다. 상한이 없는 것이 결함이다.
- **MAJOR 2 (문항 시드)**: `drawSeed` 첫 두 줄 `h = seed ^ C; h = imul(h ^ index, M)` — XOR 은 결합·교환이 되므로 `(seed ^ C) ^ index = ((seed ^ index) ^ C)`. 즉 세션 s 의 i번째 문항 rng = 세션 `s^i` 의 0번째 문항 rng. s 가 짝수면 s+1 세션의 문항 j=i^1 과 정확히 같은 rng → 같은 노드·같은 콤보. 테스트 `다른 시드면 키 열이 갈린다` (시드 1 vs 2) 는 **순서**만 비교해 통과했다. 서버가 주는 시드는 `randomInt(0, 2^31)` 이라 사용자는 보통 못 느끼지만, 스펙 5.3 의 "시드 → 결정적" 은 "다른 시드 → 독립" 을 전제한 것이고 벤치·테스트·재현 스크립트는 전부 인접 시드를 쓴다.
- **MAJOR 3 (CRLF)**: 표. 개발 에이전트의 fresh clone `ci` 는 `data/charts` 가 없을 때 돌아 `fixtures.test` 두 번째 케이스가 **건너뛰어져** 통과했다. 사용자의 "다른 PC" 절차 (`clone → install → seed → ci`) 에서는 빨간불이다. 레포에 `.gitattributes` 가 없고 이 PC 는 `core.autocrlf=true` 다.

## 3. 스펙을 넘어선 것 — 판정

- **`facingJam` 을 `currentBet ≥ stack` 으로** (스펙 3.2 는 `stack − contributions[hero]`): 개발 에이전트가 옳다. `currentBet` 은 "to" 금액이라 히어로 투입분이 이미 들어 있고, 균등 스택 프리플랍에서 `allIn` 이 비어 있지 않으면 `currentBet = stack` 이다. 시드 전 노드에서 두 식이 동치임을 테스트로 고정했다. **스펙 R2 로 3.2 를 고친다** (개선).
- **답 후 콤보 패널 표시** (`hidePanel={!revealed}`): 8.2 는 우측에 채점 박스만 두었다. 유용하지만 1280×720 에서 `w-96` 두 개가 격자 옆에 안 들어가 **답 버튼·채점 박스가 격자 아래로 밀려 화면 밖**(y=805 vs 뷰포트 720) 으로 간다 — 개발 스크린샷은 1500px 이라 안 보였다. P3M 이 트레이너 배치를 통째로 다시 잡으므로 거기서 고친다 (MINOR 1, P3M DoD 에 회귀 게이트).
- **커버링 인덱스 `idx_attempt_cat(category, created_at, graded_by, ev_loss_bb)` + `idx_attempt_session`**: 수용. 접두가 스펙과 같고 이유가 실측이다.
- **`GET /api/trainer/pool`**: 스펙에 없는 엔드포인트. 세션 폼이 "풀에 있는 카테고리만" 보여주려면 필요하다. 수용, R2 7절 표에 등재.

## CRITICAL

없음.

## MAJOR (승인 전 수정 필요)

1. [`packages/trainer/src/srs.ts:63`] `intervalDays = Math.round(base.intervalDays * base.ease)` 와 `ease` 갱신에 **상한이 없다** → 16회 Perfect 에 `dueAt = 1.04e16 > Number.MAX_SAFE_INTEGER` → [`store.ts:98 getSrs`]·`dueSpots` 가 `node:sqlite` `ERR_OUT_OF_RANGE` 로 throw → `answer` 500, pending 유지, **세션 영구 정지**. 재현: `applyReview` Perfect ×16 (`srs-overflow.mjs`), 실서버 로그 1,198,492줄. 고칠 것: (a) 스펙 R2 5.3 대로 `interval = min(interval, 365)` (ease 는 그대로 — 간격이 막히면 폭주하지 않는다), (b) 테스트 `P3 5.3 Perfect ×100 후 dueAt ≤ MAX_SAFE_INTEGER 이고 store 왕복이 던지지 않는다`, (c) 기존 DB 에 이미 그런 행이 있으면 읽을 때 죽지 않도록 `getSrs`/`dueSpots`/`leechSpots` 가 `due_at` 을 `MIN(due_at, ?)` 로 클램프해 읽거나 `readBigInts` 후 변환 — 사용자 DB 를 지우라고 할 수는 없다.
2. [`packages/trainer/src/service.ts:87` `drawSeed`] `(seed ^ 0x9e3779b9) ^ index` 는 XOR 선형이라 `drawSpot(seed, i) ≡ drawSpot(seed ^ i, 0)`. 인접 시드 세션의 스팟 집합이 46~50/50 겹친다 (`seed-overlap.mjs`). 고칠 것: seed 를 먼저 비선형 해시(splitmix32 한 스텝 등)로 섞은 뒤 index 와 결합하고 다시 섞어라. 테스트: 시드 s 와 s+1 (s = 1, 2, 5000 등 3쌍) 50문항 스팟 **집합** 교집합 ≤ 5, 그리고 기존 "같은 시드 → 같은 열" 유지. 기존 세션의 재현성은 어차피 DB 상태 의존이라 깨져도 된다 (기록에 영향 없음).
3. [레포 루트] `.gitattributes` 없음 + `core.autocrlf=true` 환경 → 새 클론에서 `packages/trainer/test/fixtures/*.json`·`web/test/fixtures/*.json` 이 CRLF 로 나오고 `npm run seed` 는 LF 로 쓰므로 `fixtures.test.ts` "바이트 단위로 같다" 가 **실패** (fresh clone 에서 재현, `*.json text eol=lf` 로 복구 확인). 고칠 것: `.gitattributes` 에 `* text=auto eol=lf` (또는 최소 `*.json text eol=lf`), `git add --renormalize .` 커밋, 그리고 DoD 1 의 fresh clone 절차를 R2 대로 `clone → install → seed → ci` 로 (리뷰어가 Windows 기본 설정에서 돌린다).

## MINOR (다음 페이즈로 미뤄도 됨)

1. [`web/src/pages/TrainerPage.tsx:262` `hidePanel={!revealed}`] 답 후 콤보 패널(`w-96`) 이 트레이너 우측 열(`w-96`) 과 같이 격자 옆에 들어가려면 ≥ ~1340px 가 필요해 1280×720 에서 답 버튼(y 765)·채점 박스(y 805)·"다음"(y 845) 이 **화면 밖**이다. P3M 에서 콤보 패널을 접힘 토글로 바꾸고 "답 후 verdict 가 스크롤 없이 보인다 @1280×720" 를 회귀 게이트로 건다.
2. [`TrainerPage.tsx:290`] 출제 화면 안내문 "정답/오답이 아니라 EV 손실로 채점합니다" — 스펙 0.3 "화면 어디에도 '정답/오답' 이란 말이 없다" 의 문자적 위반. 부정문이라도 그 단어를 쓰지 마라 (예: "빈도가 아니라 EV 손실로 채점합니다"). 테스트의 `not.toContain('오답')` 은 답 후에만 검사해 이걸 못 잡는다 — 출제 화면에도 걸어라.
3. [`packages/trainer/src/service.ts`] 341줄 (P2 R1 MINOR 7 기준 300 초과). `report()`/`parseFilter`/`drawSeed` 를 빼면 된다.
4. [`web/test/fixtures/hu-pushfold-10bb.json`] 시드 산출물 복사본인데 trainer 쪽과 달리 `data/charts` 와의 바이트 대조가 없다. 하나의 픽스처 디렉터리를 두 테스트가 읽게 하거나 같은 가드를 붙여라.
5. [`packages/server/src/app.ts` 에러 로깅] 500 마다 스택 전체를 찍는다. 클라이언트가 재시도 루프에 들어가면 (MAJOR 1 상황) 로그가 분당 수만 줄이다. 같은 메시지는 N회 후 억제하거나 한 줄로.
6. [`packages/trainer/src/pool.ts:118` `mass`] `Σ reachHero / 1326` 은 스펙 5.2 그대로지만 (HU 시드는 두 노드 다 1), `vs_jam` 노드의 실전 빈도는 상대의 잼 빈도를 곱해야 맞다. 6-max 차트가 들어올 때 w1 정의를 "히어로 reach × 상대 라인 확률" 로 바꿀지 스펙에서 정한다 (P6 스펙 항목, 지금 작업 없음).
7. [`docs/specs/P3.md` 13절] "응답 전문에 `ev` 문자열 없음" 은 `gradedBy:"ev"` 때문에 거짓 양성 — R2 에서 `"ev":` 키 형태 + 1326 배열 부재로 고쳤다 (개발 에이전트 판단이 맞다).
8. [`web/src/components/GradeBox.tsx` VERDICT_CLASS] 칩 대비: Perfect `emerald-50/600` 3.58, **Minor `amber-50/500` 2.07**, Mistake 3.35, "다음" `sky-50/600` 3.84 — 14px 텍스트의 WCAG AA 4.5 미달. `slate-500` 본문 4.24, `slate-600` 2.66 도 미달. P3M 에서 팔레트를 고친다 (P3M 5절).

## UNCERTAIN (개발 에이전트가 증명해야 할 것)

1. **답 처리 중 프로세스 kill (13절)**: `store.test` 는 CHECK 위반으로 트랜잭션 중간에 던져 롤백을 확인하지만 실제 프로세스 종료는 아무도 돌리지 않았다. `BEGIN IMMEDIATE … COMMIT` 구조상 맞다고 보지만, R2 보고에 `recordAnswer` 의 INSERT 와 UPDATE 사이에서 `process.kill` 되는 자식 프로세스 테스트 1건 (attempt·srs_state·answered 가 **함께 없다**) 을 추가하거나, 못 하는 이유를 적어라.

## 다음 페이즈 진행 가능 여부

승인 전이다. R2 는 MAJOR 1~3 (+ MINOR 2 는 한 줄이니 같이) 만 고치면 된다 — 도메인 로직은 손대지 마라. R2 에서 나는 (1) Perfect ×100 왕복, (2) 인접 시드 집합 교집합, (3) Windows 기본 설정 fresh clone `clone → install → seed → ci`, (4) `mixed-api.mjs` 를 인접 시드가 아닌 무작위 시드로 다시 돌려 API 경로의 혼합 스팟 Perfect 를 확인한다. **P3 승인 뒤 순서는 P3M → P4** 다: 사용자가 주로 휴대폰으로 쓴다면 지금 UI 는 그 전제를 만족하지 않고 (P3M 1절), P4/P5 가 만들 탐색 UI 도 같은 반응형 기반 위에 올라가야 두 번 만들지 않는다. P3M 은 UI 전용이고 도메인 코드를 건드리지 않으므로 P4 스파이크 결과와 독립이다.
