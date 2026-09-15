# P3M 리뷰 라운드 1 — 모바일 UX

리뷰어: ggto-architect, 2026-09-12. 대상 커밋: `afea5af` (origin/main, `9f7da12` 이후 3 커밋). 스펙: `docs/specs/P3M.md` (이 리뷰로 R1 개정).

## VERDICT: CHANGES_REQUIRED

CRITICAL 0 · MAJOR 2 · MINOR 6 · UNCERTAIN 3. 모바일 트레이너 자체(3·4·5·6절)는 실측으로 성립한다. 되돌려 보내는 이유는 둘이다: **`start:lan` 이 이 PC 에서는 공인 IP 에 무인증 서버를 여는 명령이 된다**(7절/D19 의 "신뢰하는 LAN" 전제가 코드에 없다), 그리고 **데스크톱 뷰어의 reach 패널이 1280×720 에서 화면 밖으로 내려갔다**(스펙 0.5·6.2 위반, 게이트가 행 수만 세서 놓쳤다).

---

## 검증한 것 (실행 근거)

| 항목 | 실행 | 결과 |
|---|---|---|
| `packages/*` 독립성 | `git diff --stat 9f7da12 HEAD -- packages` | `packages/server/src/main.ts` 1파일 (+37 −4) 만. 내용 확인: host 해석·경고·LAN 주소 출력뿐 |
| 의존성 | `git diff --stat 9f7da12 HEAD` 55파일 목록 | `package-lock.json`·`web/package.json` 변경 없음. 루트 `package.json` 은 scripts + `engines` 뿐 |
| `npm run ci` (작업 트리) | `> ci.log`, exit 0 | 테스트 131+45+69+99+**105**+23+8 = **480** (web 73→105). typecheck `error TS` 0건. bench 전부 `withinBudget`. smoke OK |
| fresh clone | `git -c core.autocrlf=true clone origin` → `HEAD=afea5af`, `w/crlf` **0**, node v24.14.0, `npm install` exit 0, `npm run seed` exit 0 (6셋, hash 동일), `npm run ci` exit 0 | H1·H2 유지 |
| `check:mobile` / `check:desktop` | `GGTO_BASE_URL=http://127.0.0.1:7790` 로 내 서버에 대고 실행 | mobile **65 PASS / 0 FAIL** exit 0 (보고서의 58 은 마지막 커밋의 태블릿 7항목 추가 전 수치), desktop **18 PASS** exit 0. 두 스크립트가 커밋된 PNG 8장을 덮어써 트리가 더러워짐 → MINOR 5 |
| 대비 재계산 | `scratchpad/contrast.mjs` (WCAG 상대휘도, `chartGrid.ts` 의 hex 를 정규식으로 추출) | 아래 1절 |
| 빌드 CSS 캐스케이드 | `web/dist/assets/index-*.css` 에서 `@media (width>=48rem)` 블록 offset 5682, `@media (pointer:coarse)` 블록 offset 12479 | `pointer-coarse:min-h-11` 이 `md:min-h-0` 뒤에 있어 768+터치에서 44px 이 이긴다. `overflow-x:clip`, `touch-action:manipulation` 존재 확인 |
| Browser 도구 (`resize_window mobile` 375×812) | `/trainer` 폼 → 세션 시작 → 답 F → JS 로 실측 | 폼: `innerWidth 375 / scrollWidth 375`, 44 미만 타겟 0, 넘침 0, "세션 시작" 343×48, `pointer: coarse` true / `hover: hover` false. 출제: 캔버스 325 (attr 650), 바 top **683** (엄지선 487 이상), 답 버튼 **168×48** ×2, F 글자 `rgb(255,255,255)` / C 글자 `rgb(0,0,0)`. 답 후: verdict 720–748, "다음" 756–804 (≤ 812), `document.body.textContent` 에 정답/오답/맞았/틀렸 **없음**, 고른 F 만 배경색 + `ring-2`, C 는 `bg-[#1e293b]` |
| 내 CDP 스크립트 (`scratchpad/arch-shots.mjs`, 레포의 `tools/shots/lib` 재사용) | 375×812 DPR2 touch / 768×1024 touch / 768×1024 mouse / 1280×720 / 1500×1000 | 스크린샷 12장 `docs/reviews/assets/p3m-r1-arch-*.png`. 수치는 아래 절들 |
| 오탭 방지 | 답 직후 `next-spot` 에 pointerdown/mousedown/pointerup/mouseup/click + `.click()` 을 전부 쏘고 150ms 뒤 확인 | `disabledAt0 true`, 스팟 `1/20` 그대로, verdict 그대로. 750ms 뒤 `disabled false`. `AnswerBar.test` 의 fake-timer 499/500ms 경계 테스트도 통과 |
| `overflow-x: hidden` 재현 (설계 변경 4) | 답 후 화면에 `html,body{overflow-x:hidden}` 를 주입 | verdict top **720 → 823** (뷰포트 812 밖), 바 758–915. 제거하면 복귀. 주장 재현됨 |
| `GGTO_HOST` 기본값 | 이미 떠 있던 `npm start` 프로세스(PID 5312, `node packages/server/dist/main.js`) 를 `netstat -ano` | `TCP 127.0.0.1:7777 LISTENING` **만**. 루프백 확인 |
| `start:lan` | `PORT=7778 node scripts/start-lan.mjs` → 로그·`netstat`·LAN IP 로 `/api/health` | `0.0.0.0:7778 LISTENING`, 경고 줄 + `휴대폰에서: http://61.82.129.232:7778`, health 200. **그 주소가 공인 IP 다** → MAJOR 1 |
| 이 PC 의 네트워크 | `Get-NetIPAddress`, `Get-NetRoute`, `Get-NetConnectionProfile` | 유일한 IPv4 `61.82.129.232/26` (DHCP, 기본 게이트웨이 61.82.129.254), 연결 프로필 **Public**. 방화벽 3 프로필 Enabled, 규칙 조회는 관리자 권한 부족 (UNCERTAIN 1) |
| 신규 테스트 동어반복 여부 | `palette.test`·`layout.test`·`responsive.test`·`AnswerBar.test`·`fixtures.test` 정독 | 아래 3절 |

---

## 1. 스펙 5절 대비 표 반박 — 판정: **개발 에이전트가 맞다. 스펙을 고쳤다**

내 스크립트로 다시 잰 값 (배경 `#020617`, 글자 `#0b1220`):

| 색 | 용도 | `slate-950` 글자 | `#0b1220` 라벨 | `bestTextOn` → 비율 |
|---|---|---|---|---|
| `#64748b` F | 시드 차트 폴드 | **4.24** | **3.93** | 흰색 → **4.76** |
| `#dc2626` A | 시드 차트 올인 | **4.18** | **3.88** | 흰색 → **4.83** |
| `#10b981` C | 콜 | 7.95 | 7.38 | 검정 → 8.28 |
| `#38bdf8` X | 체크 | 9.42 | 8.74 | 검정 → 9.80 |
| `#a855f7` | 폴백 | 5.10 | 4.73 | 검정 → 5.31 |
| `#ef4444` | 사이즈 램프 끝 | 5.36 | — | — |

스펙 5절의 "5.36 (red)" 은 램프 끝 `#ef4444` 였고, 시드 HU 푸시/폴드가 실제로 쓰는 F·A 는 재지 않았다. `bestTextOn` 으로 최악 4.76 — AA 충족. 격자 채움 라벨도 같은 결론 (3.88·3.93 미달 → 유도색). **스펙 5절 표를 개정했다** (두 행 교체, 램프 색 주석). 단 격자 라벨 유도 규칙에 구멍이 하나 있다 → MINOR 2.

## 2. 설계 변경 8건

| # | 변경 | 판정 | 근거 |
|---|---|---|---|
| 1 | 답 버튼 글자색 `bestTextOn` | **수용** | 1절. 스펙 개정 |
| 2 | 격자 채움 위 라벨색 동일 규칙 | **수용** (MINOR 2 동반) | 1절. `dominant` 레이어 기준이라 라벨 중심이 다른 레이어에 놓이면 틀린다 |
| 3 | 터치 타겟 해제 기준 `md` → `pointer: coarse` | **수용** (스펙 4절 개정) | 재현: 768×1024 **touch** 에서 `coarse true / md true` → 44 미만 **0**. 같은 폭 **mouse** 에서는 10개 (링크 2·탭 2·포지션 2·라인 1·모드 2·다음 1 로 추정 — 개발 보고의 "10개" 와 일치). 수정 전 TOUCH 는 `md:min-h-0` 만 있었으므로 touch 768 에서도 10개였을 것이 논리적으로 따라온다. 빌드 CSS 에서 `pointer-coarse` 블록이 `md` 블록 뒤라 캐스케이드도 맞다 |
| 4 | `overflow-x: hidden` 금지 → `clip` | **수용** | 직접 재현 (verdict 720 → 823) |
| 5 | `GradeBox` → `GradeVerdict` + `GradeTable` | **수용** | testid `grade-box`(바 컨테이너)·`grade-verdict`·`grade-evloss`·`grade-mixed`·`grade-summary`·`grade-action-*` 유지 확인. desktop 게이트 `grade-box.left(936) > canvas.right(562)` 통과 |
| 6 | 답 후 답 버튼을 바에 남김 | **수용** | 스펙 4절이 원래 "답 버튼은 답 후 비활성 유지 (P3 8.2)" 라고 했다 — 변경이 아니라 스펙 그대로다. 대신 바가 157px 이 되어 액션표를 가린다 → MINOR 1 |
| 7 | 상태줄 `선택:` 통일 + 테스트 4곳 수정 | **정당** | 스펙 4절이 명시적으로 "테스트가 `hover:` 문자열을 더는 기대하지 않는다" 라고 했다. 수정된 테스트는 여전히 mouseMove → 호버 셀 / mouseLeave → `—` 를 검사하므로 호버 동작 회귀를 숨기지 않는다. `ChartsPage.test` 의 `combo-toggle` 클릭 추가는 D20 의 결과다 |
| 8 | `web/src/lib/layout.ts` | **수용** | `lib/` 의 다른 파일(`title.ts`·`grid.ts`) 과 같은 층위. 순수 함수 + 훅 혼재는 `useContainerWidth` 가 순수 함수 `gridSizeFor` 의 입력을 만드는 관계라 같은 파일이 맞다 |

## 3. 알려진 한계 4건

| 한계 | 판정 |
|---|---|
| 실기기 스크린샷 없음 | **DoD 5 는 "또는 사유" 라 닫힌다.** 그러나 에뮬레이션이 못 잡는 것이 있다 (UNCERTAIN 2: iOS Safari `100vh`/툴바). **사용자에게 실기기 1회 확인을 요청**한다 — 승인 조건은 아니다 |
| Charts 375 에서 격자 top≈396 | **수용.** 실측 396.5 + 325 = 721 < 812 라 첫 화면에 격자가 다 들어온다 (콤보 토글 782–826 만 걸침). "스크롤 전제" 라는 표현이 오히려 과하다 |
| 답 후 바가 액션표 마지막 줄을 가림 | **수용하되 MINOR 1.** 실측: 표 614–690, 바 top 655 → 행 부분이 35px 가려진다. 끝까지 스크롤하면 표 495–571 / 바 639 로 해소 |
| `tools/shots` Chrome 탐색 Windows 전용 | **수용.** `GGTO_CHROME` 문서화됨. MINOR 4 에 후보 경로 추가만 적어 둔다 |

---

## CRITICAL

없음. 도메인 코드(`packages/core|preflop|trainer`) 무변경을 diff 로 확인했고, 서버 기본 바인드는 루프백이다.

## MAJOR

### MAJOR 1 — `start:lan` 이 공인 IP 에 무인증 서버를 연다 (`packages/server/src/main.ts:26-37`, `scripts/start-lan.mjs:21`, `README.md` "휴대폰에서 쓰기")

무엇이 틀렸나: `lanAddresses()` 는 `!a.internal` 인 IPv4 를 전부 "휴대폰에서: …" 로 찍고, `start-lan.mjs` 는 무조건 `0.0.0.0` 에 바인드한다. "LAN" 인지 확인하는 코드가 없다.

어떤 입력에서 깨지나: **이 개발 PC 가 그 입력이다.** 유일한 IPv4 가 `61.82.129.232/26` (DHCP, 게이트웨이 `61.82.129.254`, Windows 연결 프로필 **Public**). `npm run start:lan` 을 치면 로그가 `[ggto] 휴대폰에서: http://61.82.129.232:7777` 를 안내한다. 이 주소는 인터넷 주소다. README 의 "방화벽이 물어보면 '개인 네트워크' 만 허용하라" 는 이 PC 에서 성립하지 않는다 — 네트워크가 Public 이라 개인 프로필만 허용하면 휴대폰도 못 붙고, 그래서 사용자는 Public 을 허용하게 된다. 그 순간 `data/trainer.db` 읽기/쓰기와 `/api/*` 전부가 인터넷에 열린다. D19 의 근거("같은 네트워크의 누구나") 가 "인터넷의 누구나" 가 된다.

고칠 것 (스펙 7절 R1 개정 반영):
1. `lanAddresses()` → 사설 대역만 (`10/8`, `172.16/12`, `192.168/16`; Tailscale 용 `100.64/10` 은 "오버레이" 라벨로 따로). 공인 주소는 출력하지 않는다.
2. `start-lan.mjs`: 사설 IPv4 가 하나도 없으면 **기동을 거부**하고 이유(발견된 주소와 대역)를 찍는다. 있으면 `0.0.0.0` 이 아니라 **그 사설 주소에 바인드** (`GGTO_HOST=<사설 IP>`). 여러 개면 첫 번째 + 목록 출력, `GGTO_HOST` 로 고르게.
3. `main.ts`: `GGTO_HOST` 가 `0.0.0.0`/`::` 이고 인터페이스에 공인 IPv4 가 있으면 `GGTO_ALLOW_PUBLIC=1` 없이는 기동 거부 (명시 opt-in 의 opt-in). 이 두 함수(대역 분류, 바인드 결정)는 순수 함수로 빼서 `packages/server/test` 에 표 테스트 (`10.0.0.1 → private`, `61.82.129.232 → public`, `100.100.1.1 → overlay`, `169.254.1.1 → link-local 제외`).
4. README/HANDOFF: "'개인 네트워크' 만 허용" 문장을 지우고 `Get-NetConnectionProfile` 로 **Private 인지 먼저 확인**, Public 이면 `start:lan` 을 쓰지 말라고 쓴다. D19 에 "사설 대역만, 공인 주소 감지 시 거부" 한 줄.

`packages/server` 변경이지만 P3M 2절의 `main.ts` host 예외 범위 안이다 (테스트 파일 추가 포함).

### MAJOR 2 — 데스크톱 뷰어 reach 패널이 격자 아래로 내려가 1280×720 에서 보이지 않는다 (`web/src/components/ChartNodeView.tsx:126,195-199`, 게이트 `tools/shots/desktop.mjs:118-122`)

무엇이 틀렸나: `ChartNodeView` 루트가 `flex flex-col` 이고 reach 패널이 `belowGrid` 다음 형제라 **모든 폭에서** 격자 아래에 온다. 스펙 6.2 는 "우측 패널(콤보/리치)은 `< md` 에서 격자 아래", 0.5 는 "데스크톱은 지금과 같다". D20 은 **콤보 패널만** 접힘+아래로 옮겼고 reach 패널은 언급이 없다.

실측: 1280×720 `/charts` reach 모드 — 캔버스 top 236 (bottom 756, 이미 격자 마지막 행이 잘린다), reach 패널 **top 813 / bottom 941** → 스크롤 0 에서 완전히 화면 밖. 격자 오른쪽 700px 은 비어 있다. 1500×1000 에서도 top 813 (보이긴 한다). P3 이전(P2 배치) 에서는 같은 해상도에서 격자 옆에 있었으므로 **데스크톱 회귀**다. 스크린샷 `p3m-r1-arch-desktop-1280x720-charts-reach.png` (개발 첨부 `P3M-desktop-1280x720-charts-reach.png` 와 바이트 동일 51,698 — 개발 스크린샷에도 패널이 없다).

왜 게이트가 못 잡았나: `desktop.mjs` 8.3-3 검사가 `reach-row-*` **개수 ≥ 2** 만 본다. 렌더 여부지 가시성이 아니다.

고칠 것: `≥ md` 에서 reach 패널을 격자 오른쪽 열에 (`md:flex-row` + 우측 `md:w-80`). 콤보 토글은 D20 대로 아래 유지. 게이트: 1280×720 reach 모드에서 `reach-panel` 의 `top ≥ 0 && bottom ≤ 720` 을 스크롤 0 에서 단언 (8.3-3 R1 개정). 트레이너의 `belowGrid`(액션표) 는 그대로.

## MINOR (다음 페이즈로 미뤄도 됨)

1. **답 후 하단 바가 액션표를 가린다** (`AnswerBar.tsx:43`, `TrainerPage.tsx:278`). 375 스크롤 0: 표 614–690, 바 655–812 (h 157). 요약줄은 보이고 행은 가려진다. 콘텐츠 열에 `pb-[바 높이]` 를 주거나(바를 `ResizeObserver` 로 재서), 답 후에는 답 버튼 행을 32px 칩으로 줄여 바를 ~120 으로.
2. **격자 라벨 유도색이 라벨 밑 레이어가 아니라 최대 레이어를 본다** (`drawGrid.ts:60-90`). 예: 액션 `[F, C, A]` 에 F 0.35 / C 0.30 / A 0.35 → `dominant` = F(첫 최대) → 흰 글자, 그런데 라벨 중심 y = 0.5 는 C (0.35~0.65) 위 → 흰/`#38bdf8` = **2.14**. 시드(2액션) 에서는 안 나오고 6-max 임포트 차트에서 나온다. `y + step/2` 를 포함하는 레이어의 색으로 `bestTextOn` 하라.
3. **출제 화면(짧은 페이지) 에서 바 아래 16px 이 남는다** (바 bottom 796 / 812). 바가 `p-4` 페이지 상자 안에 있어 세로 패딩은 상쇄되지 않았다 (`-mx-4` 만). 노치 폰에서는 `safe-area-inset-bottom` + 16 이 겹친다. `-mb-4` 또는 바를 패딩 상자 밖으로.
4. **`tools/shots/lib/server.mjs:30` 이 7777 에 떠 있는 아무 프로세스나 쓴다.** 이 PC 에는 13:07 에 뜬 `npm start` (PID 5312) 가 있었다 — 마지막 두 커밋 빌드 전이다. 정적 파일은 디스크에서 읽으니 이번엔 무해했지만 다른 체크아웃의 서버면 엉뚱한 빌드를 검사한다. 기본은 자체 기동(7791) 으로 하고 기존 서버 사용은 `GGTO_BASE_URL` 명시로만. Chrome 후보에 macOS/Linux 경로 두 줄 추가.
5. **`check:mobile`/`check:desktop` 이 커밋된 PNG 를 매번 덮어쓴다** → 돌릴 때마다 `git status` 가 더러워진다 (이번 리뷰에서 8장 `git checkout` 으로 복구). 기본 출력은 gitignore 된 `tools/shots/out/`, `--publish` 플래그로만 `docs/reviews/assets`.
6. `README.md` "테스트 480개" 는 맞지만 다음 커밋마다 어긋난다. 숫자 대신 `npm test` 로 대체하거나 그대로 두되 P4 에서 갱신.

## UNCERTAIN (개발 에이전트 또는 사용자가 증명할 것)

1. **이 PC 에 node.exe 인바운드 허용 방화벽 규칙이 이미 있는가.** `Get-NetFirewallApplicationFilter` 가 관리자 권한을 요구해 못 봤다. 있으면 MAJOR 1 은 "위험" 이 아니라 "지금 열려 있음" 이다. 사용자가 관리자 PowerShell 로 `Get-NetFirewallRule | ? DisplayName -like '*node*'` 확인.
2. **iOS Safari 실기기.** 페이지 상자가 `min-h-screen`(= `100vh`) 이라 iOS 에서 툴바가 펼쳐진 상태의 가시 높이보다 크다. 출제 화면(짧은 페이지) 에서 `mt-auto` 로 내려간 바가 툴바 뒤에 있을 수 있다 (`sticky` 는 스크롤 시에만 붙는다). `min-h-dvh` 로 바꾸면 데스크톱에 영향 없이 해결되지만 실기기 없이는 단정 못 한다. **사용자 확인 항목**: iPhone Safari, `/trainer` 세션 시작 직후, 스크롤 없이 F/C 버튼 전체가 보이는가.
3. `useContainerWidth` 의 "첫 페인트 전 측정" 이 실제로 520 캔버스 플래시를 막는지 — CDP 로도 첫 프레임을 못 잡았다. `scrollWidth 375` 는 안정 상태만 증명한다. 개발 에이전트가 `Page.startScreencast` 나 `--enable-benchmarking` 첫 프레임으로 보여주면 닫는다. 아니면 그대로 두어도 된다 (실사용 관측 없음).

---

## 다음 페이즈 진행 가능 여부

아니다. MAJOR 1·2 를 닫고 R2 로. 스펙 `docs/specs/P3M.md` 는 이 리뷰로 R1 개정됐다 (4절 타겟 기준, 5절 표, 6.2 reach 패널, 7절 사설 대역 규칙, 8.3-3 가시성 게이트, 12절 공인 IP 검사). P4 스펙은 P3M APPROVED 후에 쓴다.

R2 에서 리뷰어가 다시 돌릴 것: `start:lan` 을 이 PC(공인 IP) 에서 → 거부 메시지; `GGTO_HOST=192.168.x.x` 가상 인터페이스가 없으므로 단위 테스트 표로 대체; 1280×720 reach 패널 가시성; MINOR 1~3 은 선택.
