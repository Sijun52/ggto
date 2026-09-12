# P0 (`@ggto/core`) — Round 1 리뷰

리뷰 대상: `C:\workspace\GGTO\packages\core` (src 14파일 2,705줄, test 13파일)
계약: `docs/specs/P0.md` (본 리뷰와 함께 개정됨 — 개정 내용은 P0.md 상단 "개정 이력" 참조)
리뷰어: ggto-architect, 2026-09-11

## VERDICT: CHANGES_REQUIRED

포커 도메인 로직(콤보 인덱싱, 169 매핑, 파서 전개, 카드 제거, 평가기 순위, 에퀴티 전수/MC, 보드 동형, 액션 문자열 왕복)은 전부 독립 스크립트로 재계산해 대조했고 **불일치 0건**이다. CRITICAL 없음.
승인을 막는 것은 두 가지 MAJOR다: (1) 프리플랍 상태 기계가 **같은 상태를 서로 다른 문자열로** 만들고 `legalActions`가 **효과가 동일한 액션 두 개**를 동시에 내놓는다 — 이 문자열이 캐시 키/DB 유니크 컬럼이라 지금 못 박아야 한다. (2) 레인지 파서가 커넥터 `+`(`T9s+`)를 조용히 no-op으로 만든다 — 도구마다 의미가 다른 표기를 조용히 한쪽으로 해석하는 것은 "돌아는 가지만 틀린" 실패 모드라 거부로 바꾼다. 둘 다 스펙 개정을 동반하며 P0.md에 반영했다.

---

## 검증한 것 (실행 근거)

전부 직접 실행. 개발 에이전트 보고는 참고만 했다.

| 항목 | 명령 / 스크립트 | 결과 |
|---|---|---|
| 툴체인 | `node --version`, `npm --version`, `npm ls` | Node 24.14.0, npm 11.9.0, devDeps: @types/node 22.20.2, typescript 7.0.2, vitest 5.0.0. `dependencies` 없음 |
| 타입체크 | `npm run typecheck` | exit 0 |
| 빌드 | `npm run build` | exit 0, `dist/` 생성 (독립 검증 스크립트는 이 dist를 plain node로 import) |
| 빠른 스위트 | `npm test` | 11 파일 114 테스트 통과, 3.15s |
| 느린 스위트 | `npm run test:slow` | 2 파일 3 테스트 통과, 11.47s (7장 133,784,560 분포, 리버 134,459) |
| 금지 패턴 | `grep -rnE "\bany\b\|@ts-ignore\|@ts-expect-error\|TODO\|catch\s*\{\s*\}"` on src | 0건 |
| 계층 경계 | `grep -rnE "node:\|require(\|process\.\|console\.\|window\.\|fetch(" src` | 0건. src는 순수 ESM, 런타임 의존 없음 |
| 독립 검증 1 | `scratchpad/r1/verify1.mjs` (dist import + Phase -1 `equity.js` 참조 구현) | **ALL OK**. 세부는 아래 |
| 독립 검증 2 | `scratchpad/r1/verify2.mjs` | **ALL OK**. 세부는 아래 |
| 쟁점 C-6 벤치 | `scratchpad/r1/bench-node.mjs` (plain node, dist-alias vs dist-noalias), `bench-*.test.mjs` (vitest, 동일 워크로드) | 아래 표 |

### verify1.mjs (구조/파서/문자열/동형)
- 1326 콤보: `comboIndex(a,b) === b*(b-1)/2+a` 전수, 중복 0, `comboCards` 왕복 전수. 169 히스토그램 `{6:13, 4:78, 12:78}`. 1326개 콤보 이름을 내 독립 규칙으로 생성해 `handClassName(handClassOf(i))`와 전부 일치.
- 파서 전개 (콤보 수): `22+`78 `A2s+`48 `KTo+`36 `AJs-A9s`12 `QQ:0.5`6 `QT+`32 `AA+`6 `TT-66`=`66-TT`30 `AhKh`1 `K9s+`16 `A2o+`144 `A2+`192 `32+`16 `AA:0`0 `22+,AA:0`72. `A2s+` 멤버십을 내 `combosOf`와 콤보 단위 대조. 악성 입력 26종 전부 `RangeSyntaxError` (`2s+ AKx AA:1.5 AA:-1 A2s- , "A K" aa 10 AJs-K9s AJs-A9o AKs-AK AhKh-AsKs AA: A AK:0.5.5 AA:1e0 AA+: 22+- Ah AhKhQh AKS AKO 11 "AA:1," ",AA"`). 관대 허용: `AA:1.0`, `AA:.5`, `AA:01`, `" AA , KK "`.
- **발견**: `T9s+`→4, `76s+`→4 (no-op). MAJOR 2 참조.
- 포매터: `formatRange(fullRange())` = `22+,A2s+,K2s+,...,32s,A2o+,...,32o`. `AA:0.33333`→`AA:0.3333`, `AA:0.00004`→`""` (재파싱 오차 4e-5 ≤ 1e-4, 허용).
- 카드 제거: `removeBoard` 를 카드 id 31/32 경계(두 32비트 마스크 분할 지점), 0, 51 에 대해 1326 콤보 전수 대조. `AA`−`As` → 3콤보, 정규화 후 각 1/3. `C(49,2)=1176`. `EmptyRangeError` 확인.
- 액션 문자열: 무작위 20,000 시퀀스 `parse(format(x))` 깊은 동등 + 멱등 + **충돌 0** (다른 구조→같은 문자열 없음). 비정규 입력 23종 전부 `ActionSyntaxError` (`R1.005`, `RNaN`, `R0x1`, `R+1` 포함). `formatAmount` 경계: `1e-7`→`B0`, `0.005`→`B0.01`, `2.675`→`B2.68`.
- 보드 동형: 22,100 플랍을 내 `flops.js` 정규화(24 순열, 정렬, base-64 수치 최소)와 **대표원 단위로** 대조 → 1,755 클래스, 22,100개 전부 같은 대표원. `perm` 전진 적용 = 결과 보드, `invertPerm(perm)` 역적용 = 원본, 전수 확인. 무작위 3~5장 + 무작위 순열 10,000회 정규형 동일. stabilizer: full 24, `AsKs` 6, `AsKs`+`AhKh` 2, `AKs` 24, `AKo` 24, `AsKs,AhKh` 4, 완전 비대칭 1. `canonicalize` 반환 레인지 = `permuteRangeSuits(hero, perm)` 정확 일치, perm ∈ stabilizer, stabilizer 원소를 보드에 적용해도 같은 결과(클래스 함수).

### verify2.mjs (평가기/에퀴티/상태기계)
- **평가기 순위 교차검증**: 같은 보드를 공유하는 무작위 7장 핸드 쌍 1,000,000개에 대해 `sign(evaluate7(a)−evaluate7(b))` 를 내 참조 `eval7` 과 대조 → 순위 불일치 0, 카테고리 불일치 0. 5/6장 200,000쌍 불일치 0. (5장 분포 테스트는 카테고리만 검증하므로 킥커 순서는 이 교차검증이 근거다.)
- **hand-vs-hand 전수**: 스펙에 없는 10케이스 (프리플랍 3, 플랍 4, 턴 1, 리버 2)의 win/tie/total 을 참조 열거와 **정수 단위로 일치**. `AsAh vs KdKc` = 0.81255 (Phase -1 표 81.256%). `AcKc vs AdKd` 프리플랍 tie 1,467,192 / 1,712,304 대칭 확인.
- **range-vs-range exact**: 가중치·중첩 레인지 6케이스 (플랍 4, 턴 1, 리버 1; `AA,KK vs AA,KK` 자기 충돌 포함) 를 참조 구현으로 **쌍마다 전수 열거해 가중 평균** → hero/villain/tie/matchups 전부 1e-6 이내(실측 1e-8 이하), `heroPerCombo`/`villainPerCombo` 1326 원소 최대 오차 2.9e-8, 레인지 밖은 NaN 확인. 불변식 `hero+villain=1`, `heroWin+villainWin+tie=1` 성립.
- **MC 프리플랍**: 스펙 표 8케이스 × 시드 2개(1, 99) 전부 ±0.005 이내. `AA vs AKs` tie 0.01245/0.01268 (정답 0.01256).
- MC `heroPerCombo`: 314콤보 레인지 200k 샘플에서 NaN 0개; `AhKh:0.0001` 같은 극저가중 콤보는 20k 샘플에서 NaN (쟁점 C-2 재현).
- **프리플랍 상태 기계** 30개 시퀀스 출력을 손으로 검산 (레이즈 증분, BB 옵션, 스트래들 옵션, 종료 판정, 9max 첫 액터). 스펙 4.8 필수값 전부 일치. **발견**: `state("R100") === state("A")`, `state("A-C") === state("A-A") === state("R100-C")` 가 참. `legalActions(state("A"))` = `[fold, call, allin]` — call 과 allin 이 동일 상태를 만든다. MAJOR 1 참조.

### 쟁점 C-6 벤치 (같은 워크로드, best-of-5, ms)

| 워크로드 | plain node alias | plain node no-alias | vitest alias | vitest no-alias |
|---|---|---|---|---|
| removeBoard+normalize+view ×1000 (예산 200) | 16.5 / 17.1 | 23.2 / 21.3 | 19.0 / 18.1 | **124.7 / 125.2** |
| removeBoard ×1000 | 4.4 | 7.7 | 5.8 | 54.3 |
| normalize ×1000 (별칭은 `N` 하나뿐) | 5.6 | 5.8 | 5.5 | 33.7 |
| canonicalBoard 22,100 (예산 3000) | 11.4 | 12.6 | 12.7 | 32.5 |
| exact full vs full 플랍 (예산 5000) | 179 | 189 | 184 | 485 |
| hvh AsAh vs KsKd 프리플랍 (예산 5000) | 114 | 114 | 117 | 157 |

결론: vitest(Vite SSR 변환) 안에서만 6~7배 차이가 나고 plain node 에서는 1.3배다. `normalize` 처럼 루프 조건에서 import 상수 하나만 읽는 함수도 vitest 에서 6배 느려지는 것으로 보아 **import 바인딩이 네임스페이스 프로퍼티 로드로 바뀌는 vitest 런타임 아티팩트**가 맞다. 개발 에이전트 주장 사실로 확인. 다만 개발 에이전트가 말한 "plain node 48ms" 는 재현되지 않았다 (21~23ms).

---

## 쟁점 판정

### 쟁점 A — P0.md 4.5 내부 모순: **개발 에이전트 주장 인정. 스펙 결함.**
표의 `0.87859 (tie 1.26%)` 는 내 열거 스크립트의 `(W + T/2)/N` 즉 **에퀴티**이고, 같은 절의 "hero + villain + tie = 1" 은 hero 를 **승률**로 전제한다. 양립 불가가 맞다.
**정본**: `hero`/`villain` = 에퀴티 (`win + tie/2` 의 가중 집계), `tie` = 타이 빈도. 불변식은 `hero + villain = 1` 과 `heroWin + villainWin + tie = 1` (`heroWin = hero − tie/2`). 표가 1차 계약이다 (수치는 전수 열거에서 왔고, 대칭성 행은 내가 쓰면서 정의를 섞은 것이다).
`heroWin`/`villainWin` 필드 추가: **수용**. 불변식을 외부에서 검사 가능하게 만들고 DESIGN 5.3 의 `equity: {oop, ip}` 와도 맞는다. P0.md 4.5 인터페이스와 대칭성 행을 이 정의로 고쳤다.

### 쟁점 B — 4.8 예시 문자열 오타: **개발 에이전트 주장 인정.**
`"F-F-F-F-R3-R10-R22"` 는 UTG,HJ,CO,BTN 폴드 → SB R3, BB R10, SB R22 → toAct **BB**, contributions `{SB:22, BB:10}` 이다 (verify2 D 출력으로 확인). 서술(BTN R3, SB R10, BB R22 → toAct BTN)과 맞는 문자열은 `"F-F-F-R3-R10-R22"` 다. P0.md 를 F 3개로 고쳤고, F 4개 변형은 별도 테스트 항목으로 남겼다 (개발 에이전트가 이미 그렇게 했다).

### 쟁점 C — 개발 에이전트가 남긴 제약
| # | 제약 | 판정 | 근거 |
|---|---|---|---|
| 1 | `exact` 가 보드 1~2장에서 `UnsupportedError` | **수용** | 보드 1~2장은 실제 스트리트가 아니다. C(50,4)=230,300 런아웃 × 1326 은 프리플랍과 같은 자릿수. P0.md 4.5 에 명시 |
| 2 | MC `heroPerCombo` 샘플 0 → NaN | **수용 (문서화 조건)** | 200k 샘플에서 314콤보 레인지 NaN 0개. 극저가중 콤보만 해당. MC 의 콤보별 값은 어차피 추정치이며 P0 소비자가 없다. P0.md 에 "MC 모드의 perCombo 는 추정치, 샘플 0이면 NaN" 명시. 레인지 밖과 구분이 필요해지면 (P5 격자 에퀴티 모드) 그때 `samplesPerCombo` 를 추가한다 |
| 3 | `evaluate5/7` 중복 카드 미검사 | **수용, 단 권장사항** | 핫 경로는 `evaluateMasks` 이지 `evaluate5/7` 이 아니다 (equity.ts 가 그렇게 쓴다). 따라서 `evaluate5/7` 에 52비트 마스크 중복 검사를 넣어도 비용이 없다. `evaluate5(AsAsKsQsJs)` 가 조용히 `Pair` 를 돌려주는 것을 확인했다. MINOR 1 로 기록, 필수 아님 |
| 4 | 페어 런 정규형 `TT-66` | **수용** | 비페어 런 `AJs-A9s` (높은 쪽 먼저) 와 일관. P0.md 3.5 에 명시 |
| 5 | `raise` amount === stack 합법 + 올인 처리 | **반려** | MAJOR 1. 같은 상태에 두 문자열(`R100` ≡ `A`), `legalActions` 에 중복 액션. 스펙 문구 "정확히 스택이면 allin" 은 "A 로 써라" 는 뜻이었다. 아래 수정 지시대로 정규형을 하나로 |
| 6 | 핫 모듈 import 지역 별칭 | **수용** | 벤치로 사실 확인. plain node 에서도 손해가 없고(오히려 25% 이득) 주석으로 이유가 적혀 있다. 성능 게이트는 vitest 아티팩트를 재지 않도록 plain node 벤치로 옮긴다 (MINOR 3, P0.md 5절 개정) |

---

## CRITICAL (승인 불가)
없음.

## MAJOR (승인 전 수정 필요)

1. **[preflopState.ts:207-244, 305-327] 같은 상태에 여러 문자열, `legalActions` 에 효과가 같은 액션 중복.**
   실측: `preflopState(6max, "R100")` 과 `"A"` 가 동일 상태 (toAct HJ, pot 101.5, allIn {UTG}). `"A-C"`, `"A-A"`, `"R100-C"` 가 동일 상태. `legalActions(state("A"))` = `[fold, call, allin]` 인데 call 과 allin 이 같은 결과를 만든다.
   왜 틀렸나: DESIGN 3.3 — 이 문자열은 캐시 키·URL·`pf_node.action_seq` UNIQUE 컬럼이다. 한 상태에 문자열이 둘이면 같은 노드가 두 번 저장되고 캐시가 두 번 빗나간다. 트레이너(P3)는 `legalActions` 를 그대로 버튼으로 내놓으므로 EV 가 완전히 같은 선택지 두 개를 출제하게 된다.
   고칠 것 (P0.md 4.8 에 규칙으로 박았다):
   - `raise` 에서 `amount >= stack − EPS` → `IllegalActionError("raise to the full stack must be written as A")`. (`amount > stack` 은 기존대로 불법.)
   - `allin` 은 **레이즈일 때만** 합법: `stack > currentBet + EPS` 가 아니면 `IllegalActionError("all-in that does not raise must be written as C")`.
   - `call` 은 `currentBet >= stack` 이면 스택 전부를 넣고 `allIn` 에 추가 (지금 동작 유지).
   - `legalActions`: `allin` 은 `stack > currentBet + EPS` 일 때만 넣는다. 어떤 상태에서도 서로 같은 결과 상태를 만드는 액션 두 개가 목록에 있으면 안 된다.
   - 테스트 추가: `st("R100")` throw, `st("A-A")` throw, `st("A-C").allIn` 에 HJ 포함, `legalActions(st("A"))` 의 kind 가 정확히 `[fold, call]`, `legalActions(st("R99.5"))` 는 `[fold, call, allin]` (allin 이 0.5 만큼 레이즈이므로 합법), 무작위 합법 시퀀스 2,000개에서 `legalActions` 각 원소를 적용한 결과 상태들이 서로 다름 (스냅샷 JSON 비교).

2. **[range/parse.ts:170-174] 커넥터 `+` 가 조용히 no-op.**
   실측: `parseRange("T9s+")` → 4콤보 (= `T9s`), `"76s+"` → 4콤보. 스펙 3.5 의 "키커를 하이카드 바로 아래까지" 규칙을 그대로 따른 결과라 구현 잘못은 아니다 — **스펙 결함**이다.
   왜 문제인가: 커넥터 `+` 는 도구마다 뜻이 다르다 (PokerStove/Equilab 계열: `T9s+` = T9s,JTs,QJs,KQs; 키커 규칙: `T9s+` = T9s). 어느 쪽이든 조용히 고르면 한쪽 사용자에게는 틀린 레인지가 된다. 키커 규칙에서는 `+` 가 아무 일도 안 하므로 사용자가 `+` 를 붙였다는 사실 자체가 다른 의미를 기대했다는 신호다. P2 차트 임포트가 이 파서를 쓴다.
   고칠 것 (P0.md 3.5 개정): `XY sfx? '+'` 에서 `Y === X − 1` (커넥터) 이면 `RangeSyntaxError("connector '+' is ambiguous across tools; list hands explicitly (e.g. T9s,JTs,QJs,KQs)")`. **`AKs+`/`AKo+`/`AK+` 도 포함**해 예외 없이 거부한다 (스펙에서 `AKs+ = AKs` 항목 삭제). 테스트: `T9s+`, `76o+`, `32+`, `AKs+` 4종 throw; `T8s+`(원갭) 는 여전히 T8s,T9s = 8콤보; fuzz 테스트의 grammar 조합 생성기는 그대로 두되 커넥터 `+` 가 throw 로 분류되는 것을 확인. `4.3 전개 콤보 수` 테스트와 `4.3 포매터 정규형` 목록에서 `AKs+` 제거.

## MINOR (다음 페이즈로 미뤄도 됨)

1. [evaluator.ts:170-183] `evaluate5/evaluate7` 중복 카드 미검사 → `evaluate5(As As Ks Qs Js)` 가 `Pair` 반환. 두 함수는 핫 경로가 아니므로(에퀴티는 `evaluateMasks` 직접 사용) 52비트 마스크 중복 검사를 넣어도 비용 0. 권장.
2. [range/format.ts:25-31] 가중치 < 0.00005 인 콤보는 포맷에서 사라진다 (`AA:0.00004` → `""`). 스펙 허용 오차(1e-4) 안이지만, 문서화만 해 둔다.
3. [test/perf.test.ts] 성능 테스트가 vitest 런타임 아티팩트를 잰다 (위 벤치). 스펙 5절을 개정했다: 성능 게이트는 `packages/core/bench/perf.mjs` 가 `dist/` 를 plain node 로 import 해 측정하고 `npm run bench` 로 실행, 예산 초과 시 exit 1. vitest 의 perf.test.ts 는 그대로 두어도 되고 지워도 된다 (DoD 에서 제외).
4. [tsconfig.json] `@types/node ^22` 인데 런타임은 Node 24. `performance`/`console` 만 쓰므로 실해는 없다. 24.x 로 올려라.
5. [index.ts] `COMBO_HI_TABLE`, `COMBO_LO_TABLE`, `HAND_CLASS_COMBOS_TABLE`, `HAND_CLASS_OF_COMBO_TABLE`, `evaluateMasks` 가 공개 API 로 나간다. 타입은 readonly 지만 런타임 배열은 변형 가능. JSDoc `@internal` 표기 또는 `index.ts` 에서 별도 `internal` 네임스페이스로 분리. P1 이후 소비자가 생기기 전에.
6. [parse.ts] `AA:01`, `AA:1.0` 같은 비정규 가중치 표기를 관대하게 받는다. 파서는 관대, 포매터는 정규 — 의도된 비대칭이면 3.5 에 한 줄 적어라 (P0.md 에 내가 적었다).
7. [action.ts:58-65] `formatAmount(1e21)` → `"999999999999999900000"` 같은 극단값. bb 단위에서 무의미하므로 방치 가능. 상한(예: 1e9) 검사를 넣으면 깔끔하다.

## UNCERTAIN (개발 에이전트가 증명할 것)
- 없음. 이번 라운드의 쟁점은 전부 직접 재현했다.

## 설계 메모 (P0 결함 아님, P4/P5 스펙에 반영할 것)
- `canonicalBoard`/`canonicalize` 는 4~5장 보드를 **정렬된 집합**으로 정규화한다 (스펙 그대로, 16,432/134,459 는 집합 기준). 턴/리버 솔브의 캐시 키는 플랍 3장과 턴/리버 카드의 **스트리트 구조**를 보존해야 한다 (`Ks7h|2h` 와 `Ks2h|7h` 는 다른 게임 트리). P4 스펙에서 "정렬된 플랍, 턴, 리버 튜플의 사전순 최소" 로 street-aware 정규화를 별도 정의한다. P0 의 함수는 그 구현의 재료로 쓸 수 있다.
- DESIGN.md 3.3 의 액션 문자열 예시(`F.F.R2.5`)는 Phase -1 리뷰 CRITICAL 1 로 이미 폐기됐고 구현은 P0.md 4.7 문법을 따른다. DESIGN.md 개정은 별도 라운드.

## 스펙 준수 / 이탈 목록 (P0.md 에 반영 완료)
| 이탈 | 판정 |
|---|---|
| `RangeEquityResult` 에 `heroWin`/`villainWin` 추가 | 수용 (쟁점 A) |
| `parseRange("")` → 빈 레인지 (스펙 미정의) | 수용. `formatRange(emptyRange()) === ""` 왕복 때문에 필요 |
| `formatActionSequence` 가 빈 스트리트에 throw | 수용. 문자열로 표현 불가 |
| exact 보드 1~2장 → `UnsupportedError` | 수용 (쟁점 C-1) |
| 추가 공개 API (`comboHi/Lo`, `HandClassKind`, `handClassKind/Ranks/FromRanks`, `composePerm`, `permEquals`, `isSuitPerm`, `evaluateMasks`, `handCategoryName`, `formatAction/Street/Amount`, `PreflopConfigError`, `cloneRange`, `HAND_CATEGORY_COUNT`, `*_TABLE`) | 수용. MINOR 5 참조 |
| `"F-F-F-F-R3-R10-R22"` 를 서술 기준으로 해석 | 수용 (쟁점 B). 스펙 오타 |

## 테스트 품질
- 동어반복 없음. 기댓값은 전부 스펙 수치(전수 열거값), 수학적 불변식(전단사, 합=1, 대칭), 왕복 항등, 또는 테스트 내부의 독립 계산(4.5 hand-vs-hand 가중 평균)이다.
- `4.4 5장 전수 분포` 는 카테고리만 검증한다 — 킥커 순위는 이 리뷰의 1M 쌍 교차검증이 근거다. 개발 에이전트 쪽에도 남기려면 `AAKK2 > AAQQK` 류 순위 예제 몇 개로 충분하다 (이미 있음).
- fuzz(20k×2, grammar 5k)와 액션 충돌 5k 는 스펙 7절 요구를 개발 에이전트가 선반영한 것. 유지.
- `4.8 "F-F-F-F-R3-R10-R22"` 두 변형을 모두 못 박은 것은 적절.

## 개발 에이전트에게 보내는 수정 지시 (이 순서대로)
1. `docs/specs/P0.md` 개정본을 다시 읽어라 (상단 개정 이력 R1). 4.8 올인 정규형, 3.5 커넥터 `+` 거부, 4.5 필드 정의, 5절 벤치가 바뀌었다.
2. MAJOR 1: `preflopState.ts` `raise`/`allin` 분기와 `legalActions` 수정 + 위 테스트 6종.
3. MAJOR 2: `range/parse.ts` `+` 분기에 커넥터 거부 + 테스트 4종 + 기존 테스트에서 `AKs+` 제거.
4. MINOR 3 (권장, 이번 라운드에 같이 해도 됨): `packages/core/bench/perf.mjs` + `npm run bench`.
5. `npm run typecheck && npm test && npm run test:slow` 출력 전문을 보고서에 붙여라. 리뷰어가 같은 명령을 다시 돌린다.

## 다음 페이즈 진행 가능 여부
CHANGES_REQUIRED. MAJOR 1·2 가 해소된 Round 2 제출을 검토한 뒤 결정한다. 두 항목 모두 국소 수정(각 20줄 이하 + 테스트)이므로 라운드 2 에서 APPROVED 가 나오면 P1 (서버 뼈대 + RangeGrid, 데이터는 `parseRange` 출력) 착수.
