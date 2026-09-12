# GGTO

**goldggongchi + GTO.** 개인용 텍사스 홀덤 GTO 학습 도구 — 프리플랍 차트 조회, 포스트플랍 솔루션 탐색, 그리고 트레이너를 내 PC에서 로컬 웹앱으로.

> 상용 서비스의 솔루션을 가져다 쓰지 않는다. 시드 차트는 이 저장소의 생성기가 CFR+ 로 직접 푼 것이고, exploitability 를 계산해 게이트로 건다. 출처를 `source` 에 기록할 수 없는 데이터는 넣지 않는다.

---

## 지금 상태

| 페이즈 | 내용 | 상태 |
|---|---|---|
| **P0** | `@ggto/core` — 카드/콤보(1326)/레인지/파서/핸드 평가기/에퀴티/보드 동형/액션 시퀀스/프리플랍 상태 기계 | ✅ 승인 |
| **P1** | Hono 서버 + `RangeGrid` (Canvas 169 격자) | ✅ 승인 |
| **P2** | 프리플랍 차트 — SQLite 스키마, `ggto-json` v1, 임포터 CLI, 시드 생성기, 차트 뷰어 | ✅ 승인 |
| **P3** | 트레이너 — 스팟 출제, EV loss 채점, SRS, 세션 리포트 | ✅ 승인 |
| **P3M** | 모바일 UX — 반응형 격자, 터치 타겟 44px, 하단 액션 바, LAN 접속 | 🔍 검증 중 |
| **P4** | 포스트플랍 솔버 — Rust `postflop-solver` 데몬 + 잡 큐 + 캐시 | ⏳ 스파이크 완료 |
| **P5** | 포스트플랍 탐색 UI — 액션 트리, 런아웃 히트맵 | ⏳ |
| **P6** | 트레이너 v2 — 포스트플랍 스팟, 리크 분석 | ⏳ |

테스트 **480개** 통과 · 타입체크 strict · 런타임 의존성은 core 에 0개.

---

## 빠른 시작

```bash
npm install        # prepare 훅이 core/protocol 을 먼저 빌드한다 (Node 24 필요)
npm run seed       # 시드 차트 6개 생성 → data/ggto.db 임포트 (최초 1회, ~6초)
npm run build
npm start          # http://localhost:7777
```

`data/` 는 gitignore 대상이라 클론 직후에는 비어 있다. `npm run seed` 가 CFR+ 로 차트를 다시 풀어서 채운다 — 결정적이라 어느 머신에서 돌려도 `content_hash` 가 같다.

```bash
npm run ci            # typecheck → test → build → bench → smoke
npm run bench:strict  # 성능 예산 강제 (유휴 머신에서만 의미 있음)
npm run check:mobile  # 375x812 실제 레이아웃 검사 + 스크린샷 (Chrome 필요, ci 밖)
npm run check:desktop # 1280x720 / 1500x1000 회귀 게이트
```

### 휴대폰에서 쓰기

앱은 **모바일 우선**이다 (375px 한 열 스택, 답 버튼은 엄지가 닿는 하단 고정 바). 같은 Wi‑Fi 의 휴대폰에서 PC 의 서버에 붙으려면:

```bash
npm run start:lan   # GGTO_HOST=0.0.0.0 으로 바인드하고 접속 주소를 찍는다
```

> ⚠️ **이 서버에는 인증이 없다.** `start:lan` 은 같은 네트워크의 **모든 기기**에 트레이너 기록 읽기/쓰기를 연다. 신뢰하는 홈 네트워크에서만 쓰고, 카페·회사 Wi‑Fi 에서는 쓰지 마라. 기본 `npm start` 는 `127.0.0.1` 에만 바인드한다 (D19).

기동하면 `[ggto] 휴대폰에서: http://192.168.x.x:7777` 같은 줄이 나온다. 그 주소를 휴대폰 브라우저에 치면 된다. Windows 방화벽이 처음 한 번 물어보면 "개인 네트워크" 만 허용하라.

### 환경변수

| 변수 | 기본값 | 뜻 |
|---|---|---|
| `PORT` | `7777` | 서버 포트 |
| `GGTO_HOST` | `127.0.0.1` | 바인드 주소. 루프백이 아니면 기동 로그에 경고와 LAN URL 이 찍힌다 (D19) |
| `GGTO_DATA_DIR` | `<repo>/data` | `ggto.db`·`trainer.db`·`charts/` 가 있는 곳 |
| `WEB_DIST` | `<repo>/web/dist` | 서빙할 프론트 빌드 |
| `GGTO_CHROME` | Windows 표준 경로 탐색 | `check:mobile`/`check:desktop` 이 띄울 Chrome |

---

## 아키텍처

![GGTO 아키텍처](docs/assets/architecture.svg)

### 어기면 안 되는 규칙

- **계산은 1326 콤보, 표시만 169 격자.** 169 인덱스를 받아 *계산*하는 함수는 어디에도 없다. 이걸 섞으면 블로커 효과를 표현할 수 없다.
- **`@ggto/core` 는 UI·DB·HTTP·파일을 모른다.** 런타임 의존성 0.
- **액션 시퀀스 문자열이 캐시 키이자 URL 파라미터이자 DB 컬럼이다.** 파서/포매터는 core 에 하나뿐.
- **솔버는 별도 프로세스.** `postflop-solver` 가 AGPL-3.0 이라 프로세스 경계가 곧 라이선스 경계다.
- 서버에 SQL 없음. 웹은 `core`/`protocol` 만 import.

전체 목록과 각 결정의 근거는 [`docs/DECISIONS.md`](docs/DECISIONS.md).

---

## 어떻게 만들어지고 있나

두 개의 에이전트가 역할을 나눠 돌린다. 스펙을 쓰고 판정하는 쪽과 구현하는 쪽이 분리돼 있고, **검수자가 `APPROVED` 를 낼 때까지 페이즈가 끝나지 않는다.**

![2-에이전트 개발 루프](docs/assets/agent-loop.svg)

검수자는 구현자의 보고를 믿지 않는다 — 테스트를 직접 다시 돌리고, 자체 검증 스크립트를 새로 짜고, 브라우저 캔버스 픽셀을 샘플링하고, 전수 열거로 정답을 재계산한다. 구현자는 스펙이 틀렸다고 판단되면 근거를 대고 반박할 수 있다 (누적 7건 수용됨).

이 구조가 실제로 잡아낸 것들:

- URL 의 리터럴 `+` 가 공백으로 디코딩돼 **에러 없이** 162콤보 레인지를 22콤보로 바꾸던 버그
- 커밋되어야 할 20분짜리 에퀴티 표가 `.gitignore` 의 `data/` 패턴에 걸려 있던 것 (`git clone` 하면 CI 가 깨진다)
- fresh clone 에서만 재현되는 CI 실패 — stale `dist` 위에서는 통과하던 것
- 스펙 자체의 자기모순 3건, 그리고 오케스트레이터가 잘못 적은 에퀴티 기준값

에이전트 정의는 [`.claude/agents/`](.claude/agents/) 에 있다. 다른 PC 에서 이어받으려면 [`docs/HANDOFF.md`](docs/HANDOFF.md).

---

## 시드 차트는 어디서 오나

공개된 프리플랍 차트 데이터셋 중 쓸 수 있는 것이 사실상 없다. 오픈소스 **솔버**는 있지만 (TexasSolver, wasm-postflop, HeadsUpSolver), **차트 데이터**는 출처·스택·레이크·사이즈가 기록돼 있지 않다. 파라미터를 모르는 차트는 어느 조건의 정답인지 알 수 없어서, 그걸로 트레이닝하면 틀린 걸 외우게 된다.

그래서 `tools/chart-gen` 이 직접 푼다. HU 푸시/폴드 6개 스택, CFR+ 로 수렴시키고 **exploitability 를 실제로 계산해 게이트로 건다.**

| 검증 | 결과 |
|---|---|
| exploitability (NashConv/2) | 2.7e-8 ~ 1.4e-7 bb (게이트 0.005bb) |
| 독립 솔버 대조 (fictitious play — CFR+ 아님) | 집계 레인지 6/6 일치, EV L∞ 0.0003bb |
| HoldemResources 무앤티 Nash 표 | 2,010 셀 중 **2,007 일치** (나머지 3은 임계값 ±0.2bb 경계) |
| 169 에퀴티 표 | 전수 계산 (몬테카를로 아님) |

`chart_set.source` 에 생성 파라미터·커밋 해시·exploitability 가 전부 기록된다.

---

## 프로젝트 구조

```
packages/core       @ggto/core       순수 도메인. 의존성 0
packages/protocol   @ggto/protocol   API 타입·상수
packages/server     @ggto/server     Hono 라우터, 정적 서빙, 진입점
packages/preflop    @ggto/preflop    스키마·저장소·ggto-json·도달 레인지
packages/trainer    @ggto/trainer    스팟·채점·SRS
web/                @ggto/web        Vite + React 19 + Tailwind v4
tools/chart-gen     시드 차트 생성기 (CFR+)
tools/chart-import  ggto-json → SQLite
tools/shots         headless Chrome 레이아웃 검사 + 스크린샷 (ci 밖)
scripts/            start-lan 등 운영 스크립트
docs/specs/         페이즈별 정본 스펙
docs/reviews/       검수 판정 이력
docs/DECISIONS.md   되돌리면 안 되는 결정과 근거
```

---

## 라이선스와 출처

- 이 저장소의 코드는 개인 프로젝트다.
- **P4 부터 쓰는 [`postflop-solver`](https://github.com/b-inary/postflop-solver) 는 AGPL-3.0-or-later.** 개인 로컬 사용에는 의무가 발동하지 않지만, 배포하거나 네트워크로 열면 솔버와 링크된 부분이 AGPL 이 된다. 별도 Cargo 프로젝트 + 별도 프로세스로 격리하는 이유다.
- 프리플랍 차트 데이터는 출처·라이선스·파라미터를 `chart_set.source` 에 기록할 수 없으면 넣지 않는다. 상용 서비스(GTO Wizard 등)에서 추출한 데이터는 "무료 구간" 이어도 쓰지 않는다.
