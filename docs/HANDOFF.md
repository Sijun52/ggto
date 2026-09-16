# 다른 PC 에서 이어받기

이 저장소만 클론하면 작업을 그대로 이어갈 수 있다. 에이전트 정의·스펙·판정 이력·결정 근거가 전부 커밋돼 있다.

---

## 1. 사전 요구사항

| 도구 | 버전 | 필수 여부 |
|---|---|---|
| **Node.js** | **24.x** (개발 기준 24.14.0) | 필수 — `node:sqlite` 와 `node:zlib` zstd 를 쓴다. 22 이하는 안 된다. 루트 `package.json` 의 `engines` + `.npmrc engine-strict=true` 가 **설치를 실패시킨다** (경고로 지나가지 않는다) |
| npm | 11.x | 필수 |
| git | 2.x | 필수 |
| Chrome (또는 Edge) | 임의 | `npm run check:mobile`/`check:desktop` 에만. 경로는 `GGTO_CHROME` |
| rustup (GNU 호스트) | stable | **P4 부터만.** 그 전에는 없어도 된다 |

Node 24 가 필요한 이유는 내장 SQLite(`node:sqlite`)와 zstd(`node:zlib`) 때문이다. 네이티브 빌드 의존성을 하나도 두지 않으려고 고른 선택이라, 런타임을 낮추면 대체 패키지를 붙여야 한다.

---

## 2. 셋업

```bash
git clone https://github.com/Sijun52/ggto.git
cd ggto
node --version  # 24.x 여야 한다
npm install     # prepare 훅이 core/protocol 을 자동 빌드한다
npm run seed    # 2-max(HU) 푸시/폴드 45 차트 생성 + 임포트 (최초 1회, 1분 안)
npm run ci      # 전부 통과하면 환경이 정상이다
npm run build && npm start   # http://localhost:7777
```

**전체 차트 사다리**(2~9-max × 앤티 3종 × 스택 15단 = 360 차트)는 오프라인 작업이다:

```bash
npm run gen:charts   # 6코어에서 수 시간. --resume 이 기본이라 중단해도 이어서 돈다
```

`seed` 는 2-max 45장만 만든다 (`ci` 관례인 "1분 안"). 3~9-max 는 3-way 에퀴티 표
(`tools/chart-gen/data/equity169-3way.bin`, 커밋돼 있다)를 읽고 차트당 수 초~수 분이 걸린다.
옛 HU 시드 6개를 쓰던 트레이너 기록이 있으면 서버 기동 로그가 `npm run trainer:migrate` 를
안내한다 (기록은 명시적으로만 옮긴다 — D16·D35).

`npm run ci` 가 exit 0 이면 끝이다. 실패하면 아래 3절을 보라.

휴대폰에서 쓸 거면 `npm start` 대신 **`npm run start:lan`** — 이 PC 의 **사설 LAN 주소 하나**에만 바인드하고 접속 주소를 찍는다 (`0.0.0.0` 이 아니다). 사설 주소가 없으면 **기동을 거부**한다: `Get-NetIPAddress`/`Get-NetConnectionProfile` 로 주소가 사설이고 프로필이 Private 인지 먼저 보라. **인증이 없으므로 신뢰하는 LAN 에서만** (D19). 환경변수 표는 [README](../README.md#환경변수).

레이아웃 검사는 `ci` 밖이다 (Chrome 의존): `npm run check:mobile`, `npm run check:desktop`. 다른 PC 에서는 `GGTO_CHROME` 에 chrome.exe 경로만 주면 된다.

---

## 3. 커밋되지 않는 것과 복구 방법

`.gitignore` 가 막는 것은 **재생성 가능한 것뿐이다.**

| 경로 | 무엇 | 복구 |
|---|---|---|
| `node_modules/` | 의존성 | `npm install` |
| `*/dist/` | 빌드 산출물 | `npm run build` (또는 `prepare`/`pretest` 훅이 자동) |
| `/data/` | `ggto.db`, `trainer.db`, 생성된 차트 JSON | `npm run seed` (2-max) · `npm run gen:charts` (전체 사다리) |
| `*.tsbuildinfo` | tsc 증분 캐시 | 자동 |

**중요**: `.gitignore` 의 데이터 패턴은 `/data/` 다 — 맨 앞 슬래시가 없으면 `tools/chart-gen/data/equity169.json`(커밋되어야 하는 250KB 전수 에퀴티 표)까지 무시된다. 실제로 한 번 발생했던 버그다. 패턴을 바꾸지 마라.

**트레이너 기록(`data/trainer.db`)은 복구 불가능하다.** 사용자 데이터이고 머신마다 다르다. PC 를 옮기면 학습 이력은 따라오지 않는다. 옮기고 싶으면 `data/trainer.db` 를 직접 복사하라 — 단 스팟 키가 `content_hash` 기반이라 시드 차트가 동일해야 참조가 맞는다(결정적이라 보통 맞는다).

---

## 4. 에이전트 설정

[`.claude/agents/`](../.claude/agents/) 의 두 파일이 커밋돼 있다. Claude Code 가 세션 시작 시 자동으로 읽는다.

| 에이전트 | 모델 | 역할 |
|---|---|---|
| `ggto-architect` | **fable** | 스펙 작성, 독립 검증, 페이즈 승인 판정. 코드를 짜지 않는다 |
| `ggto-dev` | **opus** | 스펙대로 구현, 리뷰 피드백 처리, 틀린 지적은 반박 |

새 세션에서 `/ggto-architect` 또는 `/ggto-dev` 로 호출되며, 오케스트레이터(메인 세션)가 `Agent` 툴로 번갈아 띄운다.

> ⚠️ 에이전트 정의 파일은 **세션 시작 시점에** 로드된다. 파일을 고쳐도 그 세션에는 반영되지 않는다.

---

## 5. 컨텍스트가 있는 곳

작업을 이어받기 전에 이 순서로 읽어라.

1. **[`docs/DECISIONS.md`](DECISIONS.md)** — 되돌리면 안 되는 결정 20건과 각각의 근거. 새 페이즈에서 같은 논쟁을 반복하지 않으려고 만든 문서다. **가장 먼저 읽어라.**
2. **[`docs/specs/P*.md`](specs/)** — 페이즈별 정본 스펙. `DESIGN.md` 와 충돌하면 스펙이 이긴다.
3. **[`docs/reviews/`](reviews/)** — 판정 이력. 왜 그렇게 결정됐는지가 여기 있다. 각 리뷰의 "이월 MINOR" 목록이 다음 페이즈의 작업 항목이다.
4. **[`DESIGN.md`](../DESIGN.md)** — 전체 그림. 1~2절은 P1 시점에 재작성됐고, 4.1 스키마는 `specs/P2.md` 가 대체한다.
5. **[`docs/spikes/P4-rust.md`](spikes/P4-rust.md)** — Rust 툴체인 조사 결과. P4 시작 전 필독.

---

## 6. 루프를 재개하는 방법

페이즈 진행은 항상 같은 형태다.

```
아키텍트가 docs/specs/PN.md 작성
  → 개발 에이전트가 구현 + 자체 검증 출력 첨부
  → 아키텍트가 독립 재현 + docs/reviews/PN-roundM.md + VERDICT
  → CHANGES_REQUIRED 면 수정 지시를 들고 개발 에이전트로
  → APPROVED (CRITICAL·MAJOR 0) 나면 다음 페이즈 스펙
```

오케스트레이터가 에이전트를 띄울 때 프롬프트에 반드시 넣을 것:

- 읽어야 할 문서 목록 (스펙 → 최근 리뷰 → DECISIONS)
- 이월 MINOR 목록 (직전 리뷰의 "다음 페이즈로" 항목)
- "보고를 믿지 말고 직접 재현하라" (아키텍트에게)
- "스펙이 틀렸다고 판단되면 근거를 대고 반박하라" (개발 에이전트에게)
- 벤치 보고 시 부하(`load`/`enforced`) 동반

---

## 7. 알아둘 함정

**벤치가 머신 부하에 예민하다.** 게임이나 무거운 앱이 돌면 2~4배 느려져 예산을 넘는다. 그래서 하네스가 `os.cpus()` 델타로 실행 구간 부하를 재고, 외부 부하가 43% 를 넘으면 예산을 **집행하지 않는다**(`OVER (not enforced)` + exit 0). 정확성(`check`) 실패는 부하와 무관하게 항상 exit 1 이다.

유휴 머신에서 진짜 성능을 재려면 `npm run bench:strict`.

**Windows 특이사항.** npm 스크립트가 `cmd` 로 돌아 셸 글로브가 없다. 그래서 `chart-import` 가 디렉터리 인자를 받는다. 개발은 Windows 10 + PowerShell 5.1 + Git Bash 환경에서 했다.

**`node:sqlite` 는 experimental 이다.** `ExperimentalWarning` 이 뜨는 건 정상이다. 저장소는 `ChartRepository` 인터페이스 뒤에 있어서 교체 가능하다.

**P4 는 Rust 가 필요하다.** rustup **GNU 호스트**로 설치해야 한다 (`--default-host x86_64-pc-windows-gnu`). `rust-mingw` 가 링커를 번들해서 별도 C 컴파일러(MSVC/VS Build Tools)가 필요 없다. `postflop-solver` 빌드에는 워크어라운드 2개가 필요하다 — 상세는 [`docs/spikes/P4-rust.md`](spikes/P4-rust.md).

---

## 8. 문서 규칙

- **다이어그램은 이미지로.** SVG 를 `docs/assets/` 에 두고 마크다운에서 참조한다. ASCII 아트를 새로 넣지 마라.
- 스펙과 `DESIGN.md` 가 충돌하면 스펙이 정본이다. 스펙끼리 충돌하면 나중 것이 이긴다.
- 리뷰는 `docs/reviews/<phase>-round<N>.md` 로 남긴다.
