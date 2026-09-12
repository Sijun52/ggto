# P0 (`@ggto/core`) — Round 2 리뷰

리뷰 대상: `C:\workspace\GGTO\packages\core` (R1 MAJOR 1·2 + MINOR 수정 재제출)
계약: `docs/specs/P0.md` (R1 개정본 → 본 리뷰와 함께 R2 개정)
이전 라운드: `docs/reviews/P0-round1.md`
리뷰어: ggto-architect, 2026-09-11

## VERDICT: APPROVED

R1 의 MAJOR 1(올인 정규형)과 MAJOR 2(커넥터 `+`)는 소형 스택 트리 전수와 13×13×3 전수로 각각 해소를 확인했다. 개발 에이전트의 반박 5건은 4건 수용, 1건(반박 2) 값은 수용하되 근거 문장은 틀렸음을 기록한다. CRITICAL 0, MAJOR 0. MINOR 5건은 P1 이후로 미룬다.

---

## 검증한 것 (실행 근거)

전부 직접 실행. 스크립트는 `scratchpad/r2/` 에 있다 (`tree.mjs`, `connector.mjs`, `bench-cmp.mjs`, `subpath/`, `verify1-patched.mjs`, `verify2-patched.mjs`).

| 항목 | 명령 / 스크립트 | 결과 |
|---|---|---|
| 타입체크 | `npm run typecheck` | exit 0 |
| 빠른 스위트 | `npm test` | 10 파일 121 테스트 통과, 3.10s (R1: 11 파일 114) |
| 느린 스위트 | `npm run test:slow` | 2 파일 3 테스트 통과, 12.06s |
| 벤치 | `npm run bench` (build 포함) | `ok:true`. parseRange×1000 8.4ms / removeBoard 체인×1000 16.9ms (예산 200) / exact 플랍 188.5ms (5000) / hvh 프리플랍 112.6ms (5000) / canonicalBoard×22100 13.7ms (3000) |
| R1 verify1 재실행 | `r1/verify1.mjs` 원본 | `AKs+` 에서 **의도된** throw 로 중단 (R1 MAJOR 2 의 변경점). 케이스 표에서 커넥터 6개(`AKs+ T9s+ 76s+ JTo+ 32s+ 32+`)만 제거한 `verify1-patched.mjs` → **VERIFY1 ALL OK** (169 히스토그램, 파서 전개 17케이스, 악성 입력 26종, 포매터 정규형, 카드 제거 경계, 액션 문자열 20k 왕복+충돌 0, 플랍 1,755 클래스 대표원 일치, stabilizer) |
| R1 verify2 재실행 | `r1/verify2.mjs` 원본 | `st('R100')` 에서 **의도된** throw 로 중단 (R1 MAJOR 1). "같은 상태 다른 문자열" 5줄만 지운 `verify2-patched.mjs` → **VERIFY2 ALL OK** (평가기 1M 쌍 교차검증 불일치 0, `evaluate5` 중복 → `CardSyntaxError` 확인, hvh 10케이스 정수 일치, range-vs-range 3케이스 perCombo 오차 ≤ 2.9e-8, MC, 상태 기계 30 시퀀스) |
| **상태 기계 트리 전수** | `r2/tree.mjs` | 아래 표 |
| **커넥터 전수** | `r2/connector.mjs` | 13×13×3 = 507 개 `XY sfx? +` 전부: 커넥터 36개 전부 `RangeSyntaxError`(메시지에 "connector"), 비커넥터 키커 런 198개 전부 콤보 수 = `(X−Y) × {s:4, o:12, 없음:16}` 일치, 페어 13개 `(12−X+1)×6` 일치, 역순/페어+sfx 전부 throw. bad 0 |
| `MAX_AMOUNT` 왕복 | 같은 스크립트 | 무작위 2자리 금액 200,000개 (1e0~1e9 로그 균등) `parse(format)` 항등 0 실패. `999999999.99` 통과, `1e9` 통과, `1e9+0.01` throw, 파서 `R1000000000.01` throw, `R1e9` throw |
| 핫 경로 성능 비교 | `r2/bench-cmp.mjs` (R1 시점 dist 복사본 vs 현재 dist, 3회) | 아래 표 |
| `./internal` 서브패스 | `r2/subpath/` — node_modules 정션 + `tsc -p` (NodeNext) + `node check.mjs` | tsc exit 0 (`@ts-expect-error` 붙인 `import { evaluateMasks } from '@ggto/core'` 가 실제로 에러 → 공개 진입점에서 빠짐 확인). `import.meta.resolve('@ggto/core/internal')` = `.../packages/core/dist/internal.js`. internal 키 = `COMBO_HI_TABLE, COMBO_LO_TABLE, HAND_CLASS_COMBOS_TABLE, HAND_CLASS_OF_COMBO_TABLE, evaluateMasks`. 공개 키에 `*_TABLE`/`evaluateMasks` 없음 |
| `@types/node` | `npm ls @types/node` | 24.13.4 설치 (package.json `^24.9.2`) |
| MINOR 2/6 문서화 | `format.ts:14-16`, `parse.ts:13` | 있음 |
| `test/perf.test.ts` | `ls test/` | 삭제됨. `equity.test.ts:93,251` 의 5,000ms 상한 assert 는 남아 있음 |

### 상태 기계 트리 전수 (`tree.mjs`)
각 노드에서 후보 토큰 **전부**(`F X C A`, `R<a>`/`B<a>` a ∈ step 격자 0..stack+2step)를 적용해 성공 집합을 얻고, 스펙 4.8 을 내가 독립적으로 옮긴 기대 집합과 비교. 성공한 서로 다른 토큰의 후속 상태(actionsTaken 제외 스냅샷)가 같으면 dup. `legalActions` 의 kind 집합과 성공 집합의 kind 집합 비교.

| config | 노드 | 성공집합≠기대 | 노드 내 중복 후속상태 | legalActions 불일치 | 포트-상태 충돌 그룹 (actionsTaken 제외) | 전체-상태 충돌 (actionsTaken 포함) |
|---|---|---|---|---|---|---|
| HU stack 3, step 0.5 | 35 | 0 | 0 | 0 | 5 | 0 |
| HU stack 6, step 1 | 143 | 0 | 0 | 0 | 31 | 0 |
| 3max stack 4, step 1 | 403 | 0 | 0 | 0 | 76 | 0 |
| 3max stack 2.5, step 0.5 | 133 | 0 | 0 | 0 | 21 | 0 |
| 6max stack 3, step 1 | 12,863 | 0 | 0 | 0 | 2,371 | 0 |
| HU SB1/BB2 stack 5 | 23 | 0 | 0 | 0 | 3 | 0 |

포트-상태 충돌 예: `R2-C` vs `C-R2-C`, `R5-A-C` vs `R2-A-C`, `R3-A-C-F` vs `R3-C-A-F-C`. 전부 서로 다른 히스토리다 (반박 1 참조).

### 핫 경로 성능 (best-of-3/5, ms, 3회 반복 중 대표값)
| 워크로드 | R1 dist | 현재 dist |
|---|---|---|
| exact full-vs-full 플랍 | 173~178 | 171~174 |
| hvh AsAh vs KsKd 프리플랍 | 108~110 | 110~116 |
| MC 200k | 119~121 | 112~116 |
| `evaluate7` ×200k (중복 검사 추가된 편의 API) | 22~24 | **29~31** |

결론: `evaluateMasks` 를 직접 쓰는 세 경로는 노이즈 범위. `evaluate7` 만 +30% — 핫 경로가 아니므로 수용 (R1 MINOR 1 의 전제 그대로).

---

## 반박 판정

### 반박 1 — "서로 다른 문자열이 같은 포트-상태" 는 결함이 아니다: **수용.**
포커 이론상 맞다. `C-R2-C` (SB 림프, BB 레이즈, SB 콜) 와 `R2-C` (SB 레이즈, BB 콜) 는 팟·스택·포지션이 같아도 **다른 인포셋**이다: SB 의 레인지가 림프-콜 레인지 vs 오픈 레인지로 다르고, BB 도 레이즈 레인지 vs 콜 레인지로 다르다. 같은 노드로 합치면 포스트플랍 입력 레인지가 틀린다.
캐시 키 계약은 **"히스토리 ↔ 문자열 전단사"** 이지 "포트-상태 ↔ 문자열" 이 아니다. `pf_node.action_seq` 는 히스토리 키다. R1 MAJOR 1 이 지적한 것은 **같은 노드에서 같은 결정**(UTG 가 100 을 넣는 레이즈)에 두 문자열(`R100`, `A`)이 붙는 것 — 이건 히스토리 자체가 하나인데 문자열이 둘인 경우라 진짜 위반이었다. 트리 전수에서 이 유형은 0 이고, 남은 충돌은 전부 히스토리가 다르다 (전체-상태 충돌 0).
스펙 4.8 에 "키 계약" 항목으로 명문화했다. 포트-상태 기준 동일성이 필요한 소비자(포스트플랍 솔브 캐시)는 P4 에서 별도 키를 쓴다.

### 반박 2 — `MAX_AMOUNT = 1e9` 공개 export: **값·export 수용, 근거 문장은 틀림.**
"1e9 위로 가면 `String(x)` 가 지수 표기" 는 사실이 아니다. `String(9e20)` = `"900000000000000000000"`, 지수 표기는 **1e21** 부터다. 진짜 경계는 2자리 반올림 `Math.round(x*100)/100` 의 정확성 조건 `x*100 < 2^53` → x < 약 9.007e13 이다. 즉 1e9 는 기술적 경계가 아니라 여유 있게 고른 값이고, 그 자체는 문제없다 (100bb 캐시는 물론 칩 단위 토너먼트도 1e9 안). 200k 무작위 왕복 0 실패로 값의 안전성은 확인했다. 공개 상수로 두는 것은 P1 서버 입력 검증이 같은 값을 써야 하므로 타당하다. 코드 주석(`action.ts:56-60`)의 근거를 고쳐라 — MINOR 3.

### 반박 3 — `bet` 에 풀스택 금지 선반영: **수용, 단 도달 불가 명시.**
`bet` 분기 전체가 프리플랍에서 도달 불가다 (`validateConfig` 가 블라인드 ≥ 1개를 요구 → `currentBet > 0` → 첫 줄에서 throw). 따라서 추가한 규칙뿐 아니라 그 아래 전체가 P0 테스트로 커버되지 않는 코드다. 이건 R2 이전부터 그랬고, 규칙 자체는 4.8 정규형 원칙과 일관되며 비용 0 이라는 주장도 맞다. 요구: 분기 상단 주석에 "프리플랍 도달 불가, P4 포스트플랍 상태 기계가 상속" 한 줄 (MINOR 4). 스펙 4.8 에 적었다.

### 반박 4 — `test/perf.test.ts` 삭제: **수용.**
R1 에서 내가 DoD 를 `npm run build && npm run bench` 로 옮겼으므로 게이트는 사라진 게 아니라 이동한 것이다. `npm test` 안에도 `equity.test.ts` 의 5,000ms 상한 두 개가 남아 있어 10배급 회귀는 잡힌다. 이 레포엔 아직 CI 정의가 없다 (git 레포도 아님). 루트에 `npm run ci` = typecheck → test → build → bench 집계 스크립트를 두면 "bench 를 빼먹는" 실수를 막는다 — MINOR 5, P1 에서 루트 스크립트 정리할 때 같이.

### 반박 5 — `src/internal.ts` 분리: **수용, 동작 확인.**
위 표. 테스트의 `../src/internal.js` import 는 vitest 가 `.js → .ts` 로 해석하고, `tsconfig.build.json` 이 `src/**/*.ts` 를 포함하므로 `dist/internal.js`/`.d.ts` 가 나온다. `package.json` `exports["./internal"]` 이 NodeNext tsc 와 plain node 양쪽에서 해석된다.

---

## CRITICAL (승인 불가)
없음.

## MAJOR (승인 전 수정 필요)
없음.

## MINOR (다음 페이즈로 미뤄도 됨)

1. **[preflopState.ts:56-73 `validateConfig`] 포스트 블라인드 ≥ stack 인 config 를 거부하지 않는다.** 실측 `stack: 0.5, SB 0.5/BB 1`: `legalActions` = `[F]` 만 주는데 `preflopState(cfg, [call])` 은 성공하고 SB 를 allIn 에 넣는다 (`legalActions ⊇ 성공 액션` 계약 위반). `stack: 1` 이면 BB 가 포스트로 이미 올인인데 `allIn` 에 없다. 실사용 config(100bb) 에서는 발생 불가. 고칠 것: 어떤 포지션의 블라인드 합계 ≥ stack 이면 `PreflopConfigError`. P2 임포터가 config 를 외부 파일에서 읽기 전까지.
2. [parse.ts:151-156] 커넥터 에러 메시지의 예시가 입력이 `AKs+` 일 때 `"AKs,...,AKs"` 가 된다. 하이 카드가 A 면 런 예시를 생략하거나 `"${hi}${lo}${sfx}"` 만 안내.
3. [action.ts:56-60] `MAX_AMOUNT` JSDoc 근거 수정 (반박 2). "지수 표기" → "2자리 반올림 정확성 한계 x·100 < 2^53 보다 훨씬 작은 값을 여유 있게 고른 것".
4. [preflopState.ts:196-213] `bet` 분기 상단에 "프리플랍 도달 불가 (블라인드 필수). P4 포스트플랍 상태 기계가 상속" 주석.
5. [루트 package.json] `ci` 스크립트 (typecheck → test → build → bench). P1 에서 워크스페이스가 늘어날 때 같이.
6. [preflopState.ts] `config.stack > MAX_AMOUNT` 이면 합법 레이즈의 `formatAction` 이 throw 한다. `validateConfig` 에서 `stack <= MAX_AMOUNT` 검사 한 줄. 1번과 함께.

## UNCERTAIN (개발 에이전트가 증명할 것)
없음. 반박 5건 전부 직접 재현했다.

## 테스트 품질 (새로 추가된 것)
- `preflopState.test.ts:196-292` 올인 정규형 6종: 기댓값은 전부 스펙 4.8 수치(pot 201.5, minRaiseTo 198.5, kind 목록). 동어반복 없음. 무작위 2,000 시퀀스 테스트는 `checkedStates > 2000`, `sawAllin > 0` 가드로 공허 방지. 단 `legalActions` 만 따라가므로 min-raise 외 사이즈는 안 밟는다 — 그 구멍은 본 리뷰의 `tree.mjs` (후보 토큰 전부)가 메운다. 테스트에 남길 필요는 없다.
- `range.test.ts:242-257` 커넥터 8종 throw + `T8s+`/`A2s+`/`QT+`/`AKs-AQs`/명시 나열 정상. 스펙 수치.
- `fuzz.test.ts:69-105` 커넥터 판정을 생성기의 랭크 문자에서 독립 계산 (`a - b === 1`), `connectorItems > 50` 가드. 구현 참조 없음. 적절.
- `evaluator.test.ts:104-121` 중복 검사: 31/32 경계(두 32비트 마스크 분할점) 케이스 포함. 적절.

## 스펙 개정 (P0.md R2)
개정 이력 R2 항목 참조: 4.8 키 계약·`bet` 도달 불가·config 검증 권고, 4.7 `MAX_AMOUNT`, 4.4 중복 검사 확정, 1절 레이아웃(`internal.ts`, `bench/perf.mjs`), 6절 DoD 6.

## 다음 페이즈 진행 가능 여부
**APPROVED.** P1 착수. 스펙은 `docs/specs/P1.md` (본 라운드에서 작성): TS/Node 24 하이브리드 스택(Phase -1 결정)에 따라 `packages/server` (Hono 또는 Fastify, 포트 7777, `/api/health`, `POST /api/range/parse`, `POST /api/range/equity`, `web/dist` 정적 서빙 + SPA 폴백), `packages/protocol` (타입만), `web/` (Vite + React 19 + Tailwind + TanStack Query + Zustand) 에 `RangeGrid` 컴포넌트. 격자 데이터는 `parseRange` 출력(1326)을 서버에서 받아 브라우저에서 `toHandClassView` 로 집계 — 169 하드코딩 금지는 grep 게이트로 강제한다. P0 MINOR 1~6 은 P1 제출에 같이 포함해도 되고 P2 전까지만 하면 된다.
