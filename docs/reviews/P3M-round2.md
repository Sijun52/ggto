# P3M 리뷰 라운드 2 — 모바일 UX

리뷰어: ggto-architect, 2026-09-16. 대상 커밋: `44e7e72` (origin/main, R1 판정 `6a99d4c` 이후 1 커밋). 스펙: `docs/specs/P3M.md` (이 리뷰로 R2 개정). R1: `docs/reviews/P3M-round1.md`.

## VERDICT: APPROVED

CRITICAL 0 · MAJOR 0 · MINOR 7 (전부 P4 첫 커밋으로) · UNCERTAIN 1 (원인 규명만, 승인 조건 아님). R1 의 MAJOR 1·2 와 MINOR 1·2·3 은 아래 표대로 **실행으로** 닫혔다.

---

## 검증한 것 (실행 근거)

| 항목 | 실행 | 결과 |
|---|---|---|
| diff 범위 | `git diff --stat 6a99d4c..44e7e72` | 27 파일. `packages/*` 는 `server/src/main.ts` (+50 −4), `server/src/netAddr.ts` (신규 212), `server/test/netAddr.test.ts` (신규 214) 뿐. core/preflop/trainer 무변경 |
| `npm run ci` (작업 트리) | `scratchpad/ci.log`, exit **0** | 131+45+133+99+111+23+8 = **550**. `error TS` 0. core/preflop 벤치 ENFORCED·전부 withinBudget. trainer 벤치는 `load 62% (external 45%)` 로 NOT ENFORCED — **내가 동시에 돌린 fresh clone ci 가 원인**이다 (수치 자체는 전부 예산 안: 2253.8/6000 등) |
| fresh clone | `git -c core.autocrlf=true clone origin` → `HEAD=44e7e72`, `w/crlf` 0, node v24.14.0, `npm install` 0, `npm run seed` 0, `npm run ci` **0** | 550 테스트, 벤치 3 스위트 전부 ENFORCED (`load 34/26/20%`) |
| **MAJOR 1 — 거부 경로 6개** | `PORT=7811 node scripts/start-lan.mjs` / `GGTO_HOST=61.82.129.232` / `0.0.0.0` / `::` / `my-pc.lan` (`main.js`) / `GGTO_HOST=0.0.0.0 start-lan.mjs` | 전부 **EXIT=1**, 거부 이유 + 발견 주소(`fe80::… link-local`, `61.82.129.232 public`) 출력. `netstat -ano` 에 781x 리스닝 **0** (7811 의 리스너 PID 17816 은 03:11:50 에 뜬 개발 에이전트 잔여 프로세스 — MINOR 6). 공인 IP 를 "휴대폰에서:" 로 찍는 줄 없음 |
| **보안 회귀 테스트가 회귀를 잡는가** | `netAddr.ts` 에 뮤턴트 5개를 차례로 심고 `vitest run test/netAddr.test.ts` → 매번 `git checkout` | M1 `decideBind` 항상 ok → **4 실패**; M2 `chooseLanHost` 항상 `0.0.0.0` → **5 실패**; M3 `172.16/12` 상한 `b<=32` → **1 실패** (`172.32.0.0 = public`); M4 와일드카드 게이트 무력화 (`exposed.length > 99`) → **2 실패**; M5 호스트명 허용 → **1 실패**. 기준선 64/64. 트리 clean 확인 |
| `netAddr` 경계 탐침 | `scratchpad/netaddr-edge.mjs` (dist 로 직접 호출, 51 입력) | RFC 표와 일치: `100.64/10 overlay`, `100.128.0.1 public`, `169.254 link-local`, `fec0::1 public`, `224.0.0.1 public`, `::ffff:61.82.129.232 unknown`(거부), `''`/`' '`/`'*'`/`LOCALHOST` → unknown(거부). **불일치 1**: `fc::1`/`fd::1` → private, `fe8::1` → link-local (MINOR 1) |
| **MAJOR 2 — reach 패널** | Browser 도구 1280×720, `/charts?set=7` → `mode-reach` → `scrollTo(0,0)` → JS 실측 | `reach-panel {top 196, bottom 340, left 921, right 1241}`, 캔버스 `{top 237, bottom 757, left 42, right 562}`. 스크롤 0 에서 보이고 `left 921 > canvas.right 562`. `check:desktop` 도 1280×720·1500×1000 에서 같은 항목 PASS (936/1156) |
| 768×1024 reach | 같은 방법, 태블릿 프리셋 | 정상 상태: 캔버스 351 (`left 42 right 393`), 패널 `left 424` — 겹침 없음. **전환 과도기**: strategy→reach 토글 후 컨테이너 폭은 192ms 에 720→376 으로 바뀌는데(내 RO 로 확인) 캔버스는 **~1.19s** 동안 416 (right 448) 을 유지해 패널(left 424)과 **24px 겹친다**. 3회 반복 1193/1203/1213ms (MINOR 4) |
| `check:desktop` / `check:mobile` | 내 서버(7790, 방금 빌드한 dist)에 `GGTO_BASE_URL` 로 | desktop **24 PASS** exit 0, mobile **73 PASS** exit 0. 두 스크립트가 PNG 8장을 덮어씀 → `git checkout` 으로 복구 (MINOR 5, R1 MINOR 5 이월 확인) |
| **모바일 트레이너 (375×812, Browser 도구)** | 폼 → 20문제 → 답 F → 실측 | 폼: `innerWidth 375 / scrollWidth 375`, `pointer:coarse true / hover:hover false`, 44 미만 0, 시작 343×48. 출제: 캔버스 **325** (attr 650), 바 699–812 (h 113), F `rgb(100,116,139)`/흰 글자, A `rgb(220,38,38)`/흰 글자, 각 168×48. 상태줄 `선택: T8o`. 답 후 스크롤 0: `answer-buttons` **`display: none`**, 바 **711–812 (h 101)**, 액션표 **614–690 ≤ 711** (R1 MINOR 1 닫힘), verdict 720–748 `Perfect`, `EV loss 0.01bb`, 요약 `당신: F (0%) 최선: A +0.01bb`, "다음" 756–804 (`disabled` true → 600ms 뒤 false), `정답/오답/맞았/틀렸` 없음. 캔버스 픽셀 샘플: T8o 셀 `rgb(220,38,38)` (A 100%) 위 라벨 흰색 |
| EV-loss 채점 확인 (D8) | 위 스팟 | T8o 는 A 100% 인데 F 를 골라 `chosenFreq 0%` — 그래도 EV 차 0.01bb < 0.05 라 **Perfect**. 빈도 채점이 아님을 실데이터로 재확인 |
| MINOR 1 계산 | 실측값으로 재계산 | `pb-[바 높이]` 는 문서 끝에 여백을 더할 뿐 스크롤 0 에서 표(614–690)와 바(top)의 관계를 바꾸지 못한다 — 맞다. 32px 칩 안: 바 = 101 + 32 + gap 8 = **141** → top 671 < 690 → 19px 가림, 게이트 3(모든 버튼 ≥ 44) 위반 — 맞다. 숨김: 101 → top 711 > 690. 개발 계산 정확 |
| MINOR 2 | `scratchpad/contrast2.mjs` (레포 코드 import 없이 WCAG 식 재구현) + 뮤턴트 | 옛 규칙 `bestTextOn(F)=#fff` on C(#38bdf8) = **2.14**, 새 규칙 `bestTextOn(C)=#000` on C = **9.80**. `drawGrid.ts` 를 dominant 규칙으로 되돌리면 `drawGridLabel.test` **4/6 실패**, 기준선 6/6. 부수 효과: 옛 `used ≥ 0.6` 규칙에서 fill 0.55 F 셀은 base 라벨 `#e2e8f0` on F = **3.86** (미달) 이었는데 새 규칙은 흰 글자 4.76 — 개선 |
| MINOR 3 | `check:mobile` + Browser | 출제 바 `bottom 812 === H`, 답 후 바 `bottom 812`. 16px 띠 없음 |
| 신규 70 테스트 동어반복 여부 | `netAddr.test.ts` 45 표행 + 19 `it` = 64, `drawGridLabel.test.ts` 6 | netAddr 기댓값은 RFC 경계 양쪽(`9.255.255.255/10.0.0.0`, `172.15/16/31/32`, `100.63/64/127/128`, `169.253/254/255`) — 구현 복사 아님, 뮤턴트 5/5 검출. drawGridLabel 은 `layerAtCenter` 를 테스트가 독립 구현하고 대비를 `contrastRatio` 로 재계산 — 동어반복 아님 |
| 문서 | README/HANDOFF/DECISIONS diff | "'개인 네트워크' 만 허용" 문장 삭제, `Get-NetConnectionProfile` 선확인 절차, `GGTO_ALLOW_PUBLIC` 표 행, D19 에 "사설 대역만·공인 감지 시 거부·두 번째 opt-in" — 7절 R1-5 충족. README 22행 "테스트 480개" 는 낡음 (MINOR 7) |

---

## 1. 설계 변경 6건 — 판정

| # | 변경 | 판정 | 근거 |
|---|---|---|---|
| 1 | `packages/server/src/netAddr.ts` 신규 | **수용, 스펙 2절·8.4-8 개정** | 7절 R1-4 는 순수 함수 + 표 테스트를 요구했고 `main.ts` 는 import 만으로 DB 를 열고 `serve` 를 부르는 진입점이라 테스트에서 import 할 수 없다. 두 조항이 충돌한 것은 내 스펙의 결함이고 개발 에이전트의 해석이 맞다. `packages/*` 예외를 "`main.ts` host + `netAddr.ts` + 그 테스트" 로 넓힌다. 도메인 패키지(core/preflop/trainer) 무변경은 diff 로 확인. `scripts/start-lan.mjs` 가 `packages/server/dist/netAddr.js` 를 import 하는 것은 "분류 함수 한 벌" 원칙상 맞고, 빌드 전 실행은 `existsSync(entry)` 로 막힌다 |
| 2 | R1 MINOR 1 을 "답 후 `< md` 답 버튼 줄 숨김" 으로 | **수용, 스펙 4절 개정** | 계산 검증은 위 표. 정보 손실: 고른 액션은 `grade-summary` "당신: F (0%)" 와 액션표 `←` 두 곳에 남는다 (실측). P3 8.2 "답 후 비활성 유지" 는 `≥ md` 에서 그대로 (`hidden md:flex`). 단 jsdom 테스트는 Tailwind 를 적용하지 않으므로 이 숨김을 검사하지 못한다 — `check:mobile` 의 R1 MINOR 1 게이트가 유일한 검사다. 그걸로 충분하다 |
| 3 | 호스트명 거부 (`localhost` 만 예외) | **수용** | fail-closed. `my-pc.lan` 이 사설로 resolve 되는 경우까지 막지만 "모르고 여는 것" 을 막는 목적에 부합. `LOCALHOST`/`localhost.` 도 거부됨 — 메시지가 "사설 IP 를 직접 적어라" 라 복구 경로가 있다 |
| 4 | `start:lan` 이 `0.0.0.0` 도 거부 | **수용** | 스펙 7절-2 "`0.0.0.0` 이 아니라 첫 사설 주소" 의 직접 귀결. 실행으로 확인 (EXIT=1) |
| 5 | `used >= 0.6` 임계 제거 | **수용** | 새 규칙("중심을 덮은 레이어") 에서는 임계가 무의미하고, 옛 임계는 fill 0.5~0.6 구간에서 3.86 짜리 조합을 만들고 있었다 (위 표) |
| 6 | `reach-aside` testid | 수용 | — |

## 2. UNCERTAIN 3 (R1) — 520 캔버스 플래시: **닫힘**

rAF 논증은 성립한다. 근거를 코드 경로로 보강하면: `useContainerWidth` 는 `useLayoutEffect` 에서 `getBoundingClientRect` 로 재고 `setWidth` 한다 (`layout.ts:43-63`). React 는 layout effect 안의 setState 를 **같은 커밋 안에서 동기 재렌더**하므로 "520 커밋 → 측정 → 325 재렌더" 가 하나의 JS 태스크다. 브라우저의 rendering opportunity(rAF → style → layout → paint)는 JS 태스크 사이에만 오므로, 520 이 DOM 에 있는 순간에는 페인트가 끼어들 수 없다. 개발 에이전트의 rAF 레코더가 관측한 `[null, 325]` 는 이 논리의 실측 확인이다.

한 가지 정정: "rAF 콜백은 페인트 직전" 은 정확히는 rAF → style/layout → **ResizeObserver 콜백** → paint 다. RO 콜백이 rAF 뒤·페인트 앞에서 DOM 을 바꾸면 rAF 레코더는 그 프레임을 못 본다. 그러나 이 창에서 일어날 수 있는 변화는 컨테이너 크기 변화에 대한 반응뿐이라 "520 이 페인트됐는데 레코더가 놓쳤다" 는 경우는 만들지 못한다. 닫는다.

## 3. 알려진 한계 6건 — 판정

| 한계 | 판정 |
|---|---|
| `GGTO_ALLOW_PUBLIC=1` 성공 경로 미실행 | **옳은 판단.** 실행하면 이 PC 의 공인 IP 에 무인증 서버가 뜬다 (R1 UNCERTAIN 1 의 방화벽 규칙이 미확인이라 "몇 초" 도 정당화되지 않는다). `decideBind` 의 `allowPublic` 분기는 단위 테스트(노출 목록 단언)로, `serve` 이후의 `!!!` 경고 블록은 코드 읽기로 확인했다 — 그 블록은 로그뿐이라 실행 없이 판정 가능 |
| 사설 대역 e2e 불가 | **수용** (스펙 12절이 허용한 대체 = 표 테스트 + 뮤턴트) |
| iOS Safari 실기기 불가, `min-h-dvh` 미검증 | **수용.** `dvh` 는 데스크톱·Android Chrome 에서 `vh` 와 같게 동작하므로 회귀 위험 없음 (실측 375/1280 정상). **사용자 확인 항목 유지** (R1 UNCERTAIN 2) |
| 방화벽 규칙 미확인 | 수용. R1 UNCERTAIN 1 그대로 — 사용자가 관리자 PowerShell 로 |
| `check:*` PNG 덮어씀 + `git checkout` 복구 | 수용 (트리 clean 확인). MINOR 5 로 P4 첫 커밋 |
| 실기기 스크린샷 없음 | DoD 5 "또는 사유" 로 닫힘 (R1 과 동일) |

---

## CRITICAL

없음.

## MAJOR

없음. R1 MAJOR 1·2 닫힘 (위 표).

## MINOR (P4 첫 커밋 — `docs/specs/P4.md` 12절에 배치)

1. [`packages/server/src/netAddr.ts:73`] **`classifyIpv6` 의 `head.padEnd(4, '0')` 은 `padStart` 여야 한다.** IPv6 그룹은 16비트 hex 이고 압축 표기는 **앞** 0 을 생략한다: `fc::1` 은 `00fc::1` (`::/8` 예약 대역) 인데 `padEnd` 가 `fc00` 으로 만들어 `private` 로 판정한다. 실측: `fc::1 → private`, `fd::1 → private`, `fe8::1 → link-local` (실제는 셋 다 `::/8`, 공인도 사설도 아닌 예약). **보안 영향 없음** — 글로벌 유니캐스트(`2000::/3`) 의 첫 그룹은 항상 4자리라 공인 주소가 사설로 새지 않고, `::/8` 주소는 인터페이스에 붙지 않는다. 그러나 표 테스트에 짧은 첫 그룹 케이스가 없어 못 잡았다. `padStart` 로 바꾸고 `fc::1 → public`, `fe8::1 → public`, `2::1 → public` 을 표에 추가.
2. [`netAddr.ts:121-125` `lanCandidates`] **정렬이 family 만 본다 — `private` 가 `overlay` 보다 앞이어야 한다.** 스펙 7절-2 는 "첫 **사설** 주소에 바인드" 다. Tailscale 어댑터가 `os.networkInterfaces()` 에서 이더넷보다 먼저 열거되는 PC(Windows 에서 흔하다) 에서 `start:lan` 은 `100.x.x.x` 에 바인드하고 그 주소를 "휴대폰에서:" 로 찍는다 — 같은 Wi‑Fi 의 휴대폰은 못 붙는다. 실측 (`[100.100.1.1, 192.168.0.17]` 입력): `host 100.100.1.1 (overlay)`. 정렬 키를 `(kind: private < overlay, family: IPv4 < IPv6)` 로. 후보 목록 출력과 `GGTO_HOST` 선택은 이미 있으므로 사용성 문제이지 보안 문제는 아니다.
3. [`netAddr.ts:167` `decideBind`] **`0.0.0.0` 이 공인 IPv6 를 이유로 거부된다.** `publicAddrs` 가 IPv4/IPv6 를 구분하지 않아 `192.168.0.17 + 2001:db8::abcd` (ISP 글로벌 IPv6 를 받는 흔한 가정) 에서 `GGTO_HOST=0.0.0.0` 이 "이 PC 에 공인 IP 가 있다: `2001:db8::abcd (IPv6)`" 로 거부된다 — IPv4 와일드카드는 IPv6 주소를 열지 않으므로 이유가 틀렸다. fail-closed 라 보안 회귀는 아니지만 메시지가 사용자를 오도한다. `0.0.0.0` 은 IPv4 공인만, `::` 는 둘 다 세라. 표 테스트에 `HOME_ROUTER + 2001:db8::` 케이스 추가 (`0.0.0.0 → ok`, `:: → 거부`).
4. [`web/src/components/ChartNodeView.tsx:137`, `tools/shots/mobile.mjs` 태블릿 절] **768~829px 에서 reach 토글 직후 ~1.2s 동안 reach 패널이 격자를 24px 덮는다.** 실측 768×1024: 토글 후 192ms 에 좌측 열이 720→376 으로 줄고(내 RO 로 확인) 패널이 `left 424` 에 나타나지만 캔버스는 **1193/1203/1213ms** (3회) 까지 416 (`right 448`) 을 유지한다. 정상 상태(351)는 맞다. RO 발화(192ms)와 캔버스 재렌더(~1190ms) 사이의 1초는 RO 지연이 아니다 — 원인은 UNCERTAIN 1. 830px 이상에서는 열이 438 이상이라 겹치지 않는다. 게이트: `mobile.mjs` 8절 태블릿 검사에 reach 모드 + settle 후 `panel.left > canvas.right` 를 추가하고, 과도기는 rAF 루프로 "겹침 지속 ≤ 2 프레임" 을 단언.
5. [`tools/shots/lib/server.mjs`, `mobile.mjs`/`desktop.mjs` `OUT_DIR`] R1 MINOR 4·5 그대로: 기본 출력을 gitignore 된 `tools/shots/out/` 로, `--publish` 로만 `docs/reviews/assets`. 기본은 자체 기동, 기존 서버는 `GGTO_BASE_URL` 명시로만. 이번 라운드에도 8장 덮어써 복구했다.
6. [환경] 개발 에이전트 잔여 프로세스: node PID **17816** 이 `127.0.0.1:7811` 에 03:11:50 부터, PID **5312** 가 `127.0.0.1:7777` 에 09-12 13:07 부터 (P3 빌드) 떠 있다. 루프백이라 위험은 없지만 `check:*` 의 "7777 아무거나 쓰기"(MINOR 5) 와 결합하면 낡은 빌드를 검사한다. 개발 에이전트는 라운드 종료 시 자기 서버를 끈다.
7. [`README.md:22`] "테스트 480개" → 550. 숫자를 지우고 `npm test` 로 대체하라 (R1 MINOR 6).

## UNCERTAIN (개발 에이전트가 증명할 것 — 승인 조건 아님)

1. MINOR 4 의 **1초 지연의 원인.** `useContainerWidth` 의 RO 는 192ms 에 발화하는데 `size` prop 이 캔버스에 반영되는 것은 ~1190ms 다. `setWidth` → `gridSizeFor` → `RangeGrid size` 사이에 비동기 단계가 없어 보인다. 후보: reach 모드 전환 시 `reachWeights` 쿼리 대기 중 `cells === null` 경로, 또는 `useMediaQuery` 재구독. 개발 에이전트가 `performance.mark` 로 `setWidth` 호출 시각과 `drawGrid` 호출 시각을 찍어 어디서 1초가 사라지는지 보여라.

---

## 다음 페이즈 진행 가능 여부

**P3M APPROVED. 다음은 P4 (`ggto-solver`).** 스펙 `docs/specs/P4.md` 를 이 리뷰와 함께 작성했다 — Rust 데몬 stdio JSON-lines RPC, `Solver` 인터페이스, 잡 큐(동시 2)·메모리 게이트(합 ≤ 8GB), 캐시(`config_hash`, LRU 20GB), 보드 동형 정규화를 캐시 키에(D5·D6), 진행률 SSE·취소, EV f32(D7), `expected_values()` 기준점을 내부 노드에서 프로브, `cargo tree -i windows-sys` 게이트, 래퍼 크레이트 + rc.3 핀 `Cargo.lock` + `--locked`. P4 **첫 커밋**은 이월 정리다: P3 R1 MINOR 3·5, P3 R2 MINOR 1·2·3, P3M R1 MINOR 4·5·6, P3M R2 MINOR 1~7 (P4.md 12절). `docs/specs/P3M.md` 는 이 리뷰로 R2 개정 (2절·8.4-8 `netAddr.ts` 예외, 4절 답 후 `< md` 답 버튼 숨김, 7절 R2 주석, 13절 이월 표). 사용자에게 남는 확인 2건: iPhone Safari 에서 `/trainer` 출제 직후 스크롤 없이 답 버튼이 보이는가 (R1 UNCERTAIN 2), 관리자 PowerShell 로 node.exe 인바운드 방화벽 규칙 유무 (R1 UNCERTAIN 1).
