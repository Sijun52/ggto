# GGTO 설계 문서

> **GGTO** = goldggongchi + GTO. 개인용 GTO 학습/분석 도구.
> 목표: 프리플랍 차트 조회 + 포스트플랍 솔루션 탐색 + 트레이너를, 내 PC에서 로컬 웹앱으로.

> **개정 이력:** Phase -1 리뷰(2026-09-11)에서 원안의 Axum / Rust 본체 / rust-embed / wasm 전제를 폐기하고 하이브리드 스택(TS 본체 + P4 한정 Rust 데몬)으로 확정했다. 1~2절은 P1 R2 승인 시점(2026-09-11)에 그 결정으로 재작성됐다. 4.1 스키마는 `docs/specs/P2.md` 4절이 대체한다. 페이즈별 정본은 `docs/specs/P*.md`, 판정은 `docs/reviews/`.

---

## 0. 설계 원칙

1. **프리플랍은 데이터 문제, 포스트플랍은 연산 문제.** 두 개를 같은 파이프라인에 억지로 넣지 않는다.
2. **솔브는 비싸다 → 캐시가 1급 시민.** 보드 동형(isomorphism) 정규화로 캐시 적중률을 올린다.
3. **레인지는 항상 1326 콤보로 계산, 169 격자로 표시.** 표시 형식을 내부 표현으로 쓰지 않는다.
4. **트레이너가 최종 목적지.** 뷰어는 트레이너의 해설 화면이기도 하다. 데이터 모델을 공유한다.
5. **싱글 유저 로컬 앱.** 인증/멀티테넌시/수평확장은 설계에서 뺀다. 대신 단일 프로세스 성능에 투자.

---

## 1. 기술 스택 (확정 — Phase -1 쟁점 1, P1 R1/R2 로 검증)

| 레이어 | 선택 | 이유 / 검증 |
|---|---|---|
| 언어·런타임 | **TypeScript strict + Node 24 (ESM)**, npm workspaces 모노레포 | Rust 툴체인이 이 PC 에 없고(MSVC 링커 부재), P0~P3 연산은 1326 float 배열 조작이라 TS 로 충분하다. P0 벤치: 풀레인지 vs 풀레인지 플랍 exact 188ms, 플랍 22,100 정규화 14ms |
| 연산 코어 | `packages/core` (`@ggto/core`) — 런타임 의존성 0 | Card/Combo(1326)/HandClass(169)/Range/파서/평가기/에퀴티/보드 동형/액션 문자열/프리플랍 상태 기계. 전부 순수 함수. P0 R2 APPROVED |
| 서버 | **Hono + `@hono/node-server`**, 포트 7777, `127.0.0.1` 바인드 | 단일 프로세스. SSE 는 `streamSSE` (P4). 정적 파일은 `web/dist` 를 직접 서빙 + SPA 폴백. P1 R2 APPROVED |
| 저장소 | **`node:sqlite`** (Node 내장, 네이티브 빌드 없음) + `node:zlib` zstd 블롭 | SQLite 파일 **둘**: `data/ggto.db` 는 차트 — `npm run seed`/`--replace` 로 재생성되는 **산출물**이고, `data/trainer.db` 는 시도·SRS 기록 — 지워지면 안 되는 **사용자 데이터**다 (D16). 기록은 차트를 `content_hash` 로만 참조하므로 파일 간 FK 가 없다. 솔브 결과는 zstd 블롭 파일. 저장소는 `ChartRepository` 같은 인터페이스 뒤 (교체 가능). ExperimentalWarning 감수 |
| 프론트 | **Vite + React 19 + TypeScript + Tailwind v4 + TanStack Query + Zustand**, 169 격자는 Canvas | SSR/SEO 불필요. 빌드 산출물은 서버가 그대로 서빙 (임베드 없음). 라우터 라이브러리 없음 |
| 솔버 (P4~) | **Rust `postflop-solver`(AGPL-3.0) 를 감싼 별도 프로세스 데몬** `solver/ggto-solver-cli`. Node 가 `child_process` 로 띄우고 stdio JSON-lines RPC | 유일한 Rust 코드. 프로세스 경계 = AGPL 경계 = `Solver` 인터페이스 경계. 솔브 결과(GB)는 데몬 메모리에 상주, Node 는 노드 하나씩만 받는다. 툴체인은 `rustup` GNU 호스트 (P2 기간 스파이크로 증명, `docs/specs/P2.md` 11절) |
| 프로토콜 | `packages/protocol` — 타입 전용 + 상수 | 서버/웹이 공유. 1326 배열은 P1~P2 는 JSON number[], P5 솔버 노드부터 octet-stream f32 LE |

**배포 형태**: `npm run build && npm start` → `http://localhost:7777`. Tauri 등 데스크톱 포장은 하지 않는다.

### 대안을 안 고른 이유
- *전부 Rust (원안 Axum/rusqlite/rust-embed)*: P4 이전 3개 페이즈를 전부 비싸게 만들면서 얻는 게 없다. 개발 에이전트도 TS 전제.
- *TS 로 솔버 자작*: 검증된 엔진이 AGPL 로 있는데 재구현은 "직접 CFR 구현 안 함" 결정과 충돌. 속도도 10~30배 손해.
- *wasm-postflop 사전 빌드 wasm*: 릴리스 0개, npm 미공개, nightly + wasm-pack 필요. 의존 불가 (Phase -1 리뷰에서 확인).
- (원안의 "TS 풀스택이면 1326 × 트리 순회로 UI 가 멈춘다" 는 근거는 **틀렸다** — UI 는 한 번에 노드 하나(수십 KB)만 본다. Web Worker 디코드도 불필요.)

### 라이선스
`postflop-solver`/`wasm-postflop`/`desktop-postflop` 은 AGPL-3.0-or-later. 개인 로컬 사용에는 의무가 발동하지 않지만, 배포하거나 네트워크로 열면 솔버와 링크된 부분이 AGPL 이 된다. 솔버를 별도 Cargo 프로젝트 + 별도 프로세스로 격리하는 이유다. 프리플랍 차트 데이터는 출처·라이선스를 `chart_set.source` 에 기록할 수 없으면 넣지 않는다 (4.2).

---

## 2. 아키텍처

```
┌──────────────────────────── 브라우저 (localhost:7777) ────────────────────────────┐
│  React SPA  (web/)                                                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐               │
│  │ Range (P1)   │ │ 차트 뷰어(P2)│ │ 트레이너(P3) │ │ 포스트플랍(P5)│              │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘               │
│         └──────── 공용: RangeGrid(Canvas) / ComboPanel / StrategyBar / EVPanel ────┘│
└──────────────────────────────────│ HTTP JSON (+SSE P4) │────────────────────────────┘
                                   ▼
┌──────────────────────── @ggto/server (Hono, 단일 Node 프로세스) ───────────────────┐
│  routes/range (P1)   routes/charts (P2)   routes/trainer (P3)   routes/solve (P4)   │
│         │                   │                    │                    │             │
│   @ggto/core          @ggto/preflop         @ggto/trainer        @ggto/solver       │
│   (순수 도메인)        (스키마·저장소·        (출제·채점·SRS)      (Solver 인터페이스, │
│                        ggto-json·도달 레인지)                       잡큐, 캐시)      │
│                              │                                        │ stdio RPC   │
│                       data/ggto.db (node:sqlite)          ┌───────────▼───────────┐ │
│                       data/charts/*.json                  │ ggto-solver-cli (Rust)│ │
│                       data/solves/*.bin (zstd)            │ postflop-solver, AGPL │ │
└───────────────────────────────────────────────────────────│ 별도 프로세스·별도 빌드│─┘
                                                            └───────────────────────┘
```

### 워크스페이스 구조
```
GGTO/
├─ package.json               # workspaces: packages/*, web, tools/*
├─ packages/
│  ├─ core/                   # @ggto/core — 순수 도메인 (P0)
│  ├─ protocol/               # @ggto/protocol — API 타입·상수 (P1)
│  ├─ server/                 # @ggto/server — Hono 라우터, 정적 서빙, 진입점 (P1)
│  ├─ preflop/                # @ggto/preflop — 스키마·ChartRepository·ggto-json·reach (P2)
│  ├─ trainer/                # @ggto/trainer — 스팟·채점·SRS (P3)
│  └─ solver/                 # @ggto/solver — Solver 인터페이스, 데몬 클라이언트, 캐시 (P4)
├─ solver/ggto-solver-cli/    # Rust 크레이트. 레포 안의 유일한 비-TS 코드 (P4)
├─ web/                       # Vite + React
├─ tools/
│  ├─ chart-import/           # ggto-json → SQLite CLI (P2)
│  └─ chart-gen/              # 자체 생성 시드 차트 (P2)
├─ data/                      # gitignore. DB + 차트 원본 + 솔브 캐시
├─ docs/specs/P*.md           # 페이즈별 정본 스펙
└─ docs/reviews/              # 리뷰 판정
```

### 계층 규칙 (grep 으로 검사)
- `core` 는 UI/DB/HTTP/파일을 모른다. 런타임 의존성 0. `core/internal` 은 누구도 import 하지 않는다.
- 계산은 1326, 표시는 169. 169 인덱스를 입력으로 받아 **계산**하는 함수는 어디에도 없다.
- 서버에 SQL 없음 (저장소 패키지만). 웹은 `core`/`protocol` 만 import. 솔버는 `Solver` 인터페이스 뒤.
- 액션 시퀀스 문자열(3.3) 이 캐시 키·URL·DB 컬럼이다. 파서/포매터는 core 하나뿐.

---

## 3. 핵심 데이터 모델 (`ggto-core`)

### 3.1 카드와 콤보
```rust
/// 0..52. rank = card / 4, suit = card % 4
pub struct Card(u8);

/// 0..1326. 두 카드 조합의 정규 인덱스 (hi > lo)
pub struct Combo(u16);

/// 0..169. 표시용 격자 인덱스 (AA, AKs, AKo, ...)
pub struct HandClass(u8);
```
**핵심**: 계산은 전부 `Combo`(1326), UI 표시만 `HandClass`(169). 격자 셀 하나는 4~12개 콤보의 가중 평균이며, 셀 안에서 콤보별 전략이 갈리는 경우(예: 스페이드 블로커) 셀을 확대하면 콤보 단위로 보여준다.

### 3.2 레인지
```rust
pub struct Range { weights: [f32; 1326] }
```
- 텍스트 I/O: `"22+,A2s+,ATo+,KJs:0.5"` ← PioSOLVER/GTO+ 호환 문법 파서
- 연산: 교집합, 카드 제거(board removal), 정규화, 에퀴티

### 3.3 액션 시퀀스 (프리플랍/포스트플랍 공통 키)
사람이 읽을 수 있고 파일명으로도 쓸 수 있는 정규 문자열로 고정한다.
```
프리플랍:  "F.F.R2.5.F.F.C3R11.C"   → 포지션 순서대로 . 구분
포스트플랍: "b33.c/b75.r225.c/x.x"  → / 가 스트리트 구분
```
파서/포매터는 `ggto-core`에 두고 프리플랍·포스트플랍·트레이너가 전부 이걸 쓴다. **이 문자열이 캐시 키이자 URL 파라미터이자 DB 컬럼이다.**

### 3.4 보드 동형 정규화 (캐시 적중률의 핵심)
```rust
/// 슈트 순열에 대해 정규 형태로. Ks7h2h == Kd7s2s
pub fn canonicalize(board: &[Card], ranges: &[Range; 2]) -> (Board, SuitMap);
```
- 레인지가 슈트 대칭이면 플랍 22,100개 → **1,755개 전략적 동치류**로 축소
- 정규화된 보드로 솔브하고, 표시할 때 `SuitMap`으로 역변환
- ⚠️ 레인지에 슈트 비대칭이 있으면(드물지만) 정규화 불가 → 그 경우 원본 그대로

---

## 4. 프리플랍 (하이브리드의 "사전계산" 쪽)

### 4.1 스키마
```sql
CREATE TABLE chart_set (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,           -- "6max 100bb 5% rake"
  table_size INTEGER,           -- 6, 9, 2
  stack_bb REAL,                -- 100.0
  game_type TEXT,               -- 'cash' | 'mtt' | 'spin'
  ante_bb REAL DEFAULT 0,
  source TEXT,                  -- 어디서 온 차트인지 (출처 기록 필수)
  imported_at INTEGER
);

CREATE TABLE pf_node (
  id INTEGER PRIMARY KEY,
  chart_set_id INTEGER REFERENCES chart_set(id),
  action_seq TEXT NOT NULL,     -- "F.F.R2.5" (여기까지 진행된 상태)
  hero_pos INTEGER NOT NULL,    -- 액션 차례인 포지션
  pot_bb REAL,
  actions TEXT NOT NULL,        -- JSON: ["F","C","R7.5","R22","AI"]
  strategy BLOB NOT NULL,       -- zstd(f16[n_actions][1326])
  ev BLOB,                      -- zstd(f16[n_actions][1326]), 있으면
  UNIQUE(chart_set_id, action_seq)
);
CREATE INDEX idx_pf_lookup ON pf_node(chart_set_id, action_seq);
```
노드 하나 = `2 bytes × 5 액션 × 1326` ≈ **13KB**, zstd 후 2~4KB. 6max 100bb 전체 트리가 수천 노드여도 수십 MB. SQLite로 충분.

### 4.2 데이터 확보
- **1순위**: 오픈소스/공개 차트(예: 무료 배포되는 6max RFI/3bet 차트)를 CSV/JSON으로 임포트
- **2순위**: 내가 소유한 솔버로 직접 프리플랍 솔브 후 익스포트
- ⚠️ **상용 서비스(GTO Wizard 등)의 솔루션을 스크래핑/추출하지 않는다.** 개인용이어도 ToS 위반이고, 데이터 출처가 불투명하면 앱 자체를 못 믿게 됨. `source` 컬럼을 필수로 둔 이유.
- 임포터는 `tools/chart-import`에 포맷별 어댑터로: `--format piosolver-csv | gtoplus-json | ggto-json`

### 4.3 UI
```
┌──────────────────────────────────────────────────────────┐
│ [6max 100bb ▾]  UTG  HJ  CO  BTN  SB  BB    ← 포지션 탭   │
│ 액션: [Open 2.5] → [Fold] [Call] [3bet 11] ← 브레드크럼   │
├───────────────────────────┬──────────────────────────────┤
│  A K Q J T 9 8 7 6 5 4 3 2│  선택 콤보: AJs               │
│ A■■■■▨▨░░░░░░ │  ─────────────────────────    │
│ K■■■▨▨░░ ...              │  Raise 11    62%   +3.41bb   │
│ Q■■▨▨░ ...                │  Call        31%   +1.02bb   │
│ ... (169 격자, 액션색 누적)│  Fold         7%    0.00bb   │
│                           │  ─────────────────────────    │
│ [빈도] [EV] [콤보뷰]       │  콤보별 분해 (스페이드 블로커) │
└───────────────────────────┴──────────────────────────────┘
```
- 셀 색: 액션별 색을 빈도 비율로 세로 스택 (GTO Wizard 방식)
- 호버 → 툴팁에 콤보 개수/빈도/EV
- 셀 클릭 → 우측 패널에 콤보 4~12개 분해 표시

---

## 5. 포스트플랍 (하이브리드의 "솔브" 쪽)

### 5.1 솔브 잡 파이프라인
```
POST /api/solve  {ranges, board, pot, stacks, bet_sizings, accuracy}
        │
        ├─ 1. 보드 동형 정규화 → canonical config
        ├─ 2. config_hash = blake3(canonical config)
        ├─ 3. 캐시 히트? → 즉시 job_id + status:done 반환
        └─ 4. 미스 → 큐 등록 (tokio 세마포어, 동시 2개)
                │
                └─ postflop-solver: build_tree → allocate → solve_step 루프
                        │ 매 N 이터레이션마다 exploitability 계산 → SSE push
                        └─ 목표 exploitability 도달 or max_iter → 직렬화 → data/solves/{hash}.bin
```

### 5.2 리소스 관리 (여기가 실패 지점 1번)
| 항목 | 설계 |
|---|---|
| 메모리 | `postflop-solver`의 **압축 모드(f16)** 기본 사용. 플랍부터 풀트리는 수 GB → 베팅 사이즈 프리셋을 2~3개로 제한하는 게 UX상 정답 |
| 사전 추정 | 트리 빌드 후 `memory_usage()` 로 필요 메모리 계산 → **솔브 전에 UI에 "예상 메모리 2.1GB / 예상 시간 ~40초" 표시하고 확인받음** |
| 동시성 | 세마포어 2개. 3번째 잡은 큐 대기 (로컬 PC는 RAM이 병목) |
| 캐시 축출 | LRU. `data/solves/` 총량 상한(기본 20GB) 초과 시 오래된 것부터 삭제 |
| 취소 | `solve_step` 루프에서 `CancellationToken` 확인 |

### 5.3 결과 조회 API (전체를 프론트로 보내지 않는다)
솔브 결과는 GB 단위다. **노드 단위 lazy 조회**가 필수.
```
GET /api/solve/{hash}/node?line=b33.c/b75
→ {
    street: "turn",
    pot: 21.5, stacks: [89.2, 89.2],
    actions: ["Check", "Bet 16", "Bet 43"],
    strategy: <base64 f16[3][1326]>,     // 압축해서 ~8KB
    ev:       <base64 f16[3][1326]>,
    ranges:   [<oop 1326>, <ip 1326>],
    equity:   {oop: 0.54, ip: 0.46},
    aggregate: { /* 169 격자용 사전 집계 */ }
  }
```
프론트는 이걸 받아서 격자를 그린다. 노드 이동 시마다 요청 + TanStack Query 캐시.

### 5.4 UI
```
┌──────────────────────────────────────────────────────────────────┐
│ OOP: BB vs BTN 3bet-call    Board: [K♠][7♥][2♥]   Pot 21.5  Eff 89│
├────────────────┬─────────────────────────────────────────────────┤
│  액션 트리      │  ┌─ OOP 전략 (169 격자) ──┐  ┌─ 어그리게이트 ─┐│
│  ▾ Flop        │  │                        │  │ Check   58%    ││
│    ▸ Check     │  │   ■■▨░  누적 색상       │  │ Bet 33  31%    ││
│    ▾ Bet 33 ●  │  │                        │  │ Bet 75  11%    ││
│      ▸ Fold    │  └────────────────────────┘  │ EV: +12.8bb    ││
│      ▾ Call ●  │  ┌─ 런아웃 히트맵 (턴) ────┐  └────────────────┘│
│        ▾ Turn  │  │ 카드별 OOP EV 변화       │                   │
│          ...   │  │ A♠ +2.1  A♥ -0.4 ...    │  [범위 편집] [저장]│
└────────────────┴──┴────────────────────────┴───────────────────┘
```
- 좌: 액션 트리 (브레드크럼 + 클릭 이동)
- 중앙: 169 격자 (OOP/IP 토글)
- 우: 어그리게이트 빈도 + EV
- 하단: **런아웃 히트맵** — 턴/리버 49장 각각에 대한 EV/전략 변화. 이게 실제 학습에서 제일 도움 됨

---

## 6. 트레이너 (최종 목적지)

### 6.1 스팟 정의
```rust
pub struct Spot {
    id: SpotId,
    source: SpotSource,          // PreflopChart{set, node} | Solve{hash, line}
    hero: Player,                // OOP | IP
    hero_combo: Combo,           // 출제된 특정 핸드
    legal_actions: Vec<Action>,
}
```
트레이너는 **프리플랍 차트와 포스트플랍 솔브를 동일한 `Spot`으로 추상화**한다. 그래서 출제/채점/통계 코드가 하나다.

### 6.2 채점: 정답/오답이 아니라 EV loss
```rust
pub struct Grade {
    ev_loss_bb: f32,             // 최적 액션 EV - 내 액션 EV
    optimal_freqs: Vec<f32>,     // GTO 혼합 전략
    verdict: Verdict,            // Perfect(<0.05bb) | Minor(<0.3) | Mistake(<1.0) | Blunder
}
```
- **혼합 전략 처리**: GTO가 60/40으로 섞는 스팟에서 40% 쪽을 골라도 EV loss가 거의 0이면 정답이다. 빈도 일치가 아니라 **EV loss로 채점**하는 게 유일하게 옳다.
- 세션 리포트: 총 EV loss(bb/100 환산), 카테고리별(프리플랍/c-bet/턴배럴/리버블러프) 분해

### 6.3 출제 샘플러 (SRS)
```
가중치 = 실전빈도(w1) × 난이도(w2) × 망각계수(w3) × 리크보정(w4)
```
- **실전빈도**: 그 스팟이 실제로 얼마나 자주 나오는지 (BTN vs BB SRP > UTG vs BB 4bet pot)
- **망각계수**: SM-2 변형. 마지막 정답 이후 경과 시간
- **리크보정**: 그 카테고리의 누적 EV loss가 크면 가중치 상승 → **자동으로 내 약점을 집중 출제**
- leech 스팟(3회 이상 blunder)은 별도 큐로 강제 반복

### 6.4 스키마
`docs/specs/P3.md` **4절이 이 블록을 대체한다** (`data/trainer.db`, `user_version = 1`).
여기 있던 초안은 `category` 값이 임의 문자열이었고 `graded_by`/`mixed`/`content_hash` 가 없어
EV 채점과 빈도 채점을 구분하지 못했다. 구현된 스키마는 P3.md 4절을 정본으로 본다.

### 6.5 UI
출제 화면은 **뷰어와 같은 컴포넌트를 쓰되 전략을 가린 상태**로 렌더 → 답하면 그대로 해설 화면으로 전환(같은 화면에서 마스크만 벗김). 별도 화면을 만들지 않는다.

---

## 7. API 표면

```
# 프리플랍
GET  /api/charts                              → 차트셋 목록
GET  /api/charts/{set}/tree                   → 액션 트리 구조
GET  /api/charts/{set}/node?seq=F.F.R2.5      → 전략/EV 블롭

# 포스트플랍
POST /api/solve                               → {job_id, cached: bool, est_memory, est_secs}
GET  /api/solve/{job_id}/events               → SSE: {iter, exploitability, pct}
DELETE /api/solve/{job_id}                    → 취소
GET  /api/solve/{hash}/node?line=b33.c/b75    → 노드 전략/EV/레인지
GET  /api/solve/{hash}/runouts?line=...       → 런아웃 히트맵
GET  /api/solves                              → 캐시된 솔브 목록

# 트레이너
POST /api/trainer/session      {categories, count}   → session_id
GET  /api/trainer/next?session={id}                  → Spot (전략 마스킹됨)
POST /api/trainer/answer       {spot_key, action}    → Grade + 전체 전략 공개
GET  /api/trainer/report?range=30d                   → 카테고리별 EV loss 추이

# 공용
POST /api/range/parse          {"22+,A2s+"}          → 1326 가중치
POST /api/range/equity         {ranges, board}       → 에퀴티/에퀴티 분포
```

---

## 8. 개발 로드맵

| Phase | 내용 | 산출물 | 크기 |
|---|---|---|---|
| **P0** | `ggto-core`: Card/Combo/Range/파서/에퀴티/보드동형 + 테스트 | 라이브러리 + 단위테스트 | 중 |
| **P1** | Hono 서버 뼈대 + Vite/React 뼈대 + `RangeGrid` 컴포넌트 (**완료**, `docs/reviews/P1-round2.md`) | `localhost:7777`에 169 격자가 뜬다 | 소 |
| **P2** | 프리플랍: 스키마 + 임포터 CLI + 차트 뷰어 | **첫 실사용 가능 기능** | 중 |
| **P3** | 트레이너 v1 (프리플랍 전용): 출제/채점/리포트 + **SRS·리크 분석** | 매일 쓸 수 있는 앱이 됨 | 중 |
| **P4** | `ggto-solver`: postflop-solver 래핑 + 잡큐 + 캐시 + SSE | CLI로 솔브 돌아감 | 대 |
| **P5** | 포스트플랍 탐색 UI: 액션 트리 + 격자 + 런아웃 히트맵 | | 대 |
| **P6** | 트레이너 v2: **포스트플랍 스팟** (SRS·리크 분석은 P3 에서 앞당겼다) | | 중 |
| **P7+** | 핸드히스토리 임포트 → 자동 리뷰 (선택) | | 대 |

**P2까지 오면 이미 쓸모가 있고, P3까지 오면 매일 켠다.** P4가 가장 큰 벽이니 그 전에 앱이 자립하도록 순서를 잡았다.

---

## 9. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| **포스트플랍 솔브 메모리 폭발** | 베팅 사이즈 프리셋 제한 + 솔브 전 메모리 추정 표시 + f16 압축 모드 |
| **솔브 시간이 UX를 죽임** | 캐시 우선 + 보드 동형 정규화 + 백그라운드 잡 + 미리 자주 쓰는 스팟 배치 솔브 |
| **프리플랍 차트 데이터 부재** | 오픈 차트 임포트로 시작. 출처를 DB에 강제 기록. 상용 서비스 스크래핑 금지 |
| **169 격자 렌더 성능** | Canvas 렌더 + 전략 블롭을 Web Worker에서 디코드 |
| **f16 정밀도 손실로 채점 오류** | EV loss 임계값을 f16 오차(~0.001bb)보다 훨씬 크게(0.05bb) 잡음 |
| **솔버 크레이트에 종속** | `trait Solver`로 추상화. 나중에 자체 CFR 엔진으로 교체 가능한 경계 유지 |

---

## 10. 지금 당장 정할 것

1. **게임 타입 1순위**: 6max 캐시 100bb로 고정하고 시작 (MTT/앤티는 P6 이후)
2. **레이크 모델**: 프리플랍 차트가 레이크를 반영하는지 여부. `chart_set.name`에 명시
3. **차트 데이터 소스**: P2 시작 전에 임포트할 실제 차트 파일 확보 필요
