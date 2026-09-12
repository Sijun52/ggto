# P4 스파이크 — rustup GNU 호스트에서 `postflop-solver` 빌드

실행: ggto-dev, 2026-09-11 (P2 기간 병행). 지시: `docs/specs/P2.md` 11절. 이 문서는 **기록**이고 P2 코드와 무관하다.

## 결론 (요약)

| 질문 | 답 |
|---|---|
| 이 PC 에 MSVC 없이 Rust 툴체인을 깔 수 있나 | **예.** `rustup-init --default-host x86_64-pc-windows-gnu --profile minimal` 성공 |
| C 컴파일러(외부 gcc/cl)가 필요한가 | **아니오.** rustup 의 `rust-mingw` 컴포넌트가 `x86_64-w64-mingw32-gcc.exe` / `ld.exe` / `dlltool.exe` 를 `self-contained` 에 같이 깐다. PATH 에 gcc/cc/clang/cl 은 **없다** |
| `postflop-solver` 가 빌드되나 | **예, 단 직교하는 워크어라운드 2개 필요** (① bincode 를 rc.3 으로 핀한 `Cargo.lock` + `--locked`, ② `-A dangerous_implicit_autorefs`). 상류 커밋이 2023-10-01 이고 현재 stable(1.98.1)·오늘의 crates.io 인덱스에서 그냥은 안 된다. **R1 의 원인 진단은 틀렸다 — 2.1 정정** |
| 실행되나 | **예.** `examples/basic` 이 0.65s 에 완주 (턴 스팟, 1000 iter 한도, exploitability 0.91 / pot 200) |
| `DCFR-SOLVER` 로 6-max JSON 샘플을 얻었나 | **아니오.** `windows-sys` 가 import library 를 만들려고 `dlltool` 을 부르는데 minimal 프로파일의 dlltool 이 보조 프로세스를 못 띄운다. 아래 3절 |
| P2 를 막았나 | **아니오.** 전부 별도 프로세스/디렉터리에서 진행했고 P2 코드에 영향 없음 |

설치는 **레포와 시스템을 건드리지 않는 곳**에 했다: `CARGO_HOME`/`RUSTUP_HOME` 을 스크래치패드로 지정하고 `--no-modify-path` 를 줬다. P4 에서는 영구 설치로 다시 해야 한다.

## 1. 툴체인

```
$ curl -sSL -o rustup-init.exe https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-gnu/rustup-init.exe
$ ./rustup-init.exe -y --default-host x86_64-pc-windows-gnu --profile minimal --no-modify-path
info: setting default host tuple to x86_64-pc-windows-gnu
info: default toolchain set to stable-x86_64-pc-windows-gnu
  stable-x86_64-pc-windows-gnu installed - rustc 1.98.1 (48a229cea 2026-09-01)

$ rustc --version   → rustc 1.98.1 (48a229cea 2026-09-01)
$ cargo --version   → cargo 1.98.1 (797e8a9bc 2026-08-05)
$ rustup show       → Default host: x86_64-pc-windows-gnu
$ rustup component list --installed
cargo-x86_64-pc-windows-gnu
rust-mingw-x86_64-pc-windows-gnu
rust-std-x86_64-pc-windows-gnu
rustc-x86_64-pc-windows-gnu
```

`.../lib/rustlib/x86_64-pc-windows-gnu/bin/self-contained/` 내용 (링커가 여기서 나온다):
```
dlltool.exe (1,328,640B)  ld.exe (1,910,784B)  x86_64-w64-mingw32-gcc.exe (2,840,064B)  + crt/libc 아카이브
```
빌드 중 PATH 에 `gcc` / `cc` / `clang` / `cl.exe` 는 **하나도 없었다** (`which` 전수 확인). 즉 **D1 의 "MSVC 링커 부재" 제약은 GNU 호스트로 우회된다**.

## 2. `postflop-solver` 빌드 (5회 시도)

대상: `github.com/b-inary/postflop-solver`, 커밋 **9d1509fe5077d019825f833eed04b16d342dfda1** (2023-10-01 21:59:55 +0900, 클론 시점 HEAD). 라이선스 AGPL-3.0-or-later (D2 의 프로세스 격리 근거).
기본 feature = `bincode` + `rayon`, **zstd 는 끔** (optional, 기본 아님 — C 코드가 들어오는 유일한 경로였다).

| # | 명령 | 결과 |
|---|---|---|
| 1 | `cargo build --release --example basic` | **실패** (19.3s). `error[E0107]: missing generics for trait bincode::Decode` ×8. crates.io 의 `bincode` 가 `2.0.0-rc.3` 요구를 **2.0.1**(stable) 로 해석하는데 소스는 rc API 를 쓴다 |
| 2 | `cargo build --release --locked --example basic` | **실패** (15.3s, 동일). **이 시도는 아무것도 증명하지 못한다** — 시도 1 이 방금 생성한 lock 을 잠갔을 뿐이다 (아래 2.1 정정) |
| 3 | `cargo update -p bincode --precise 2.0.0-rc.3` 후 빌드 | **실패**. `bincode_derive` 는 여전히 2.0.1 이라 derive 매크로가 2.0.1 모양의 impl 을 만든다 (`trait takes 0 generic arguments but 1 was supplied`) |
| 4 | `bincode_derive` 도 rc.3 으로 내리고 빌드 | **실패** (4.0s) — 이번엔 다른 이유. rustc 1.98 의 deny-by-default 린트 `dangerous_implicit_autorefs` 가 `error: implicit autoref creates a reference to the dereference of a raw pointer` ×3 (2023년 코드) |
| 5 | `RUSTFLAGS="-A dangerous_implicit_autorefs" cargo build --release --example basic` | **성공.** `Finished release profile in 17.43s`, `target/release/examples/basic.exe` = **4,967,473 B** |

실행:
```
$ ./target/release/examples/basic.exe        (0.65s)
Memory usage without compression (32-bit float): 0.01GB
...
iteration: 100 / 1000 (exploitability = 9.1105e-1)
Exploitability: 0.91
Equity of oop_hands[0]: 5.21%
EV of oop_hands[0]: 6.63
Average equity: 53.06%
Average EV: 91.89
```

### 2.1 정정 — bincode 실패의 진짜 원인 (R2, 리뷰어 지적)

R1 문서는 "레포에 커밋된 `Cargo.lock` 이 bincode 2.0.1 을 고정한다" 고 적었다. **틀렸다.**

1. **상류에 `Cargo.lock` 이 없다.** 라이브러리 크레이트이고 `.gitignore` 에 `Cargo.lock` 이 들어 있다.
   ```
   $ git ls-files | grep -i cargo      → Cargo.toml   (lock 없음)
   $ cat .gitignore                    → /target
                                         Cargo.lock
   $ curl -s "https://api.github.com/repos/b-inary/postflop-solver/contents/?ref=9d1509fe…"
     → .github .gitignore CHANGES.md Cargo.toml LICENSE README.md examples src tests   (lock 없음)
   ```
   시도 1 의 `cargo build` 가 lock 을 **새로 생성**했고, 시도 2 의 `--locked` 는 그 파일을 잠근 것이다.
2. **진짜 원인은 `Cargo.toml` 의 `bincode = { version = "2.0.0-rc.3" }` 에 대한 semver 해석이다.**
   caret 요구 `^2.0.0-rc.3` 의 구간은 `2.0.0-rc.3 ≤ v < 3.0.0` 이라 prerelease 를 넘어 stable 2.0.1 을 포함하고,
   cargo 는 그중 **최대**를 고른다. lock 없는 상태에서 재현 (2026-09-11):
   ```
   $ (Cargo.toml + src 만 복사한 빈 디렉터리) cargo generate-lockfile
        Locking 35 packages to latest compatible versions
         Adding bincode v2.0.1 (available: v3.0.0)
   $ grep -A1 'name = "bincode"' Cargo.lock → version = "2.0.1"
   ```
   소스는 rc.3 API 를 쓰므로 `E0107` 이 난다. 상류의 잘못이 아니라 "rc 핀을 caret 으로 적은 2023년 관행" 이 오늘 깨진 것이다.
3. 따라서 R1 의 권고 **(b) "툴체인을 1.73 으로 고정" 은 bincode 문제를 못 고친다.** 의존성 해석은 툴체인 버전이 아니라
   **오늘의 crates.io 인덱스 + 요구 문자열**의 함수다. 2023년 cargo 로도 오늘 인덱스를 보면 2.0.1 을 고른다.
   (1.73 고정이 고치는 것은 `dangerous_implicit_autorefs` 린트 쪽뿐이고, 그것도 옛 툴체인 고정이라는 값을 치른다.)

**P4 빌드 스크립트가 담아야 할 것 (확정 권고)** — 두 문제는 **직교**하므로 각각 따로 고친다:
- **의존성 해석**: 우리 래퍼 크레이트(또는 벤더링한 빌드 디렉터리)에 **rc.3 을 핀한 `Cargo.lock` 을 커밋**하고 항상 `--locked` 로 빌드한다.
  동등한 대안은 포크에서 `bincode = "=2.0.0-rc.3"` 로 바꾸는 것. `cargo update --precise` 를 빌드 스크립트에서 매번 부르는 것(R1 의 (a))은
  네트워크와 인덱스 상태에 의존하므로 열등하다.
- **린트**: `RUSTFLAGS="-A dangerous_implicit_autorefs"` 또는 포크에서 3곳 수정. `rust-toolchain.toml` 로 툴체인을 **오늘의 stable(1.98.1)** 에 고정하는 것은
  그것대로 유지하되, 이는 재현성용이지 bincode 대책이 아니다.

**검증 (2026-09-11, 이 문서의 주장을 실제로 돌려 확인함)**: rc.3 이 핀된 `Cargo.lock` 을 가진 디렉터리에서
```
$ RUSTFLAGS="-A dangerous_implicit_autorefs" cargo build --locked --release --example basic
   Finished `release` profile [optimized] target(s) in 1m 45s      (lock 은 rc.3 그대로, 변경 없음)
```

## 3. `DCFR-SOLVER` (P2.md 11-4 부산물) — **실패, 샘플 확보 못 함**

`github.com/exinori/DCFR-SOLVER`, 커밋 **4ade6a9e15a841c41867afde1258b9d110cd6fb1** (2026-03-16, "Initial commit: DCFR poker solver"), `LICENSE` = **MIT (Copyright (c) 2025 POKERGOSU)**.
의존성: `rand 0.8`, `rayon`, `clap 4`, `serde`, `serde_json`, `byteorder`, `rustc-hash`, `memmap2`. (`ort`/`nn` 은 optional, 끔.)

```
$ cargo build --release
   Compiling windows-sys v0.61.2
error: error calling dlltool 'dlltool.exe': program not found
error: could not compile `windows-sys` (lib)
```
rustup 의 `self-contained/dlltool.exe` 를 PATH 에 올리고 재시도:
```
error: dlltool could not create import library with .../self-contained/dlltool.exe
       -d ...kernel32.dll_imports.def -D kernel32.dll -l ...kernel32.dll_imports.lib
       -m i386:x86-64 -f --64 --no-leading-underscore --temp-prefix kernel32.dll:
       .../dlltool.exe: CreateProcess
```
= 번들 dlltool 이 보조 도구(`as`)를 못 띄운다. minimal 프로파일에 binutils 전체가 없다.

**해석**: `clap → windows-sys(raw-dylib)` 경로를 쓰는 크레이트는 GNU 호스트 + rustup 번들 binutils 만으로는 못 빌드한다. `postflop-solver` 는 이 경로가 없어서 통과했다.
**다음 대안** (P4 에서, 필요해지면):
1. MSYS2 로 `mingw-w64-x86_64-binutils` 설치 후 PATH 에 추가 (가장 싸다),
2. VS Build Tools C++ 워크로드 설치 후 MSVC 호스트로 전환 (`rustup set default-host x86_64-pc-windows-msvc`),
3. DCFR 을 쓰지 않는다 — 검증 이력이 없는 커밋 1개짜리 레포이고, P2.md 7.2 의 판정도 "품질 UNCERTAIN" 이다.

**따라서 `tools/chart-import/fixtures/dcfr/` 는 비어 있다.** 샘플 파일이 없으므로 6.3 규칙대로 어댑터도 쓰지 않았다.

**P4 에서 확인할 것 (R2, 리뷰어 UNCERTAIN 2)**: 우리 래퍼 크레이트(stdio JSON-lines, `serde_json` 정도)가
`windows-sys` 를 전이 의존으로 끌어오지 않는지 `cargo tree -i windows-sys` 를 CI 게이트로 둔다.
끌어온다면 위 dlltool 실패를 그대로 밟으므로 MSYS2 `mingw-w64-x86_64-binutils` 가 전제 조건이 된다.
(`postflop-solver` 는 `clap` 을 안 써서 이 경로가 없었고, 그래서 통과했다.)

**(R3 정정) 게이트 판정은 "출력이 비어 있음" 이 아니다.** 패키지가 그래프에 없으면 cargo 는 빈 출력이
아니라 **에러**를 낸다. `spike/locked` (rc.3 핀 빌드 디렉터리) 에서 실측:

```
$ cargo tree -i windows-sys
error: package ID specification `windows-sys` did not match any packages
exit=101

$ cargo tree -i bincode          # 대조: 그래프에 있는 패키지
bincode v2.0.0-rc.3
`-- postflop-solver v0.1.0 (...)
exit=0
```

따라서 게이트 정의는:

| 결과 | 의미 | 판정 |
|---|---|---|
| exit != 0 **이고** stderr 에 `did not match any packages` | 의존 그래프에 없음 | **통과** |
| exit 0 (역의존 트리 출력) | 실제로 끌어온다 | **실패** — binutils 전제 조건 발동 |
| 그 밖의 exit != 0 (매니페스트 오류, 네트워크 등) | 게이트가 판정 불능 | **게이트 오류로 빌드 중단** (조용히 통과 금지) |

`cargo tree -i <pkg> ; [ $? -ne 0 ]` 처럼 exit 코드만 보면 세 번째 줄이 통과로 새므로, stderr 문자열까지
같이 검사해야 한다.

## 4. EV getter 단위 (P2.md 11-5, Phase -1 UNCERTAIN 3) — **해소**

`examples/evprobe.rs` 를 직접 써서(스파이크 전용, 레포에 넣지 않음) 두 플레이어의 가중 평균 EV 를 뽑았다. `starting_pot = 200`, `effective_stack = 900`, rake 0, 1000 iter:

```
exploitability=0.09834504
player 0: avg_ev=91.9590  avg_equity=0.5306  eq*pot=106.1206
player 1: avg_ev=108.0410 avg_equity=0.4694  eq*pot=93.8794
SUM_OF_AVG_EV=200.0000  starting_pot=200  effective_stack=900
```

**두 플레이어 EV 의 합이 정확히 `starting_pot`** 이다. 이것이 단위를 특정한다:

```
ev_pfs(player) = E[노드 이후 회수한 칩] − E[노드 이후 추가로 넣은 칩]        (단위: 칩)
  ⇒ Σ_players ev_pfs = (starting_pot + Σ 추가 투입) − Σ 추가 투입 = starting_pot  ✓
```
이것은 **P2.md 3.3 의 기준점("노드 시점 이후 히어로 스택의 기대 변화")과 정확히 같은 정의**다. 노드 이전에 팟에 들어간 칩은 손실로 세지 않지만 회수하면 이득으로 센다. 폴드 라인의 EV 가 0 이 되는 것도 양쪽이 같다.

**변환식**: `ev_bb = ev_pfs / (1bb 에 해당하는 칩 수)`. 오프셋 없음, 팟 대비 정규화 아님. (`starting_pot` 이 bb 단위로 주어지면 그대로 bb.)
주의: `equity()` 는 팟 지분(비율)이고 `expected_values()` 는 칩이다. 위 표에서 `eq*pot ≠ avg_ev` 인 것이 그 증거다 (베팅으로 EV 가 에퀴티 지분과 갈린다).

**미해소 (R2, 리뷰어 지적 — P4 에서 확정할 것)**: 위 측정은 **루트 노드**에서 한 것이라
"노드 이후" 기준과 "루트 이후" 기준을 **구분하지 못한다** (루트에서는 두 정의가 같은 값을 준다).
따라서 4절의 "해소" 는 루트에 한해서만 참이다. P4 스파이크가 할 일:
OOP 벳 뒤 IP 노드 같은 **내부 노드**로 내려가 `cache_normalized_weights()` 후 두 플레이어 EV 합을 잰다.
- 합 = **그 노드의 팟**(양쪽이 그때까지 넣은 전부) → 노드 기준. P2.md 3.3 과 동일, 변환은 `/bb` 뿐.
- 합 = `starting_pot` → 루트 기준. 노드 이전 투입분을 빼 주는 오프셋이 변환식에 들어간다.
P4 스펙의 변환식은 이 측정 결과에 따라 확정한다.

## 5. 재현 방법

스크립트와 전체 로그: `scratchpad/spike/run{,2,3,4,5,6}.sh` / `run*.log` (세션 스크래치패드, 레포 밖).
요약 재현:
```bash
export CARGO_HOME=<tmp>/cargo RUSTUP_HOME=<tmp>/rustup
curl -sSL -o rustup-init.exe https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-gnu/rustup-init.exe
./rustup-init.exe -y --default-host x86_64-pc-windows-gnu --profile minimal --no-modify-path
export PATH="$CARGO_HOME/bin:$PATH"
git clone https://github.com/b-inary/postflop-solver.git && cd postflop-solver
git checkout 9d1509fe5077d019825f833eed04b16d342dfda1
# 상류에는 Cargo.lock 이 없다 (2.1). 한 번만 만들어 rc.3 으로 내린 뒤 그 lock 을 **우리 레포에 보관**한다.
cargo update -p bincode --precise 2.0.0-rc.3
cargo update -p bincode_derive --precise 2.0.0-rc.3
cp Cargo.lock <our-repo>/tools/<wrapper>/postflop-solver.lock   # 보관용 이름 (레포 안에서 cargo 가 집지 않도록)

# 이 체크아웃에서 그대로 이어서 빌드 (Cargo.lock 이 이미 rc.3 이다)
RUSTFLAGS="-A dangerous_implicit_autorefs" cargo build --locked --release --example basic
./target/release/examples/basic.exe
```

**(R3 정정) 새 체크아웃에서 재현할 때는 보관본을 `Cargo.lock` 으로 되돌리는 단계가 필요하다.**
`--locked` 는 크레이트 디렉터리의 **`Cargo.lock` 파일만** 읽는다 — `postflop-solver.lock` 이라는
이름의 파일은 쳐다보지 않으므로, 위 `cp` 만 하고 `--locked` 를 부르면 lock 이 없는 상태에서
`--locked` 가 실패하거나(새 클론) 엉뚱한 lock 을 잠근다(2절 시도 2 와 같은 함정):

```bash
git clone ... && cd postflop-solver && git checkout 9d1509fe...
cp <our-repo>/tools/<wrapper>/postflop-solver.lock ./Cargo.lock   # <-- 빠져 있던 단계
RUSTFLAGS="-A dangerous_implicit_autorefs" cargo build --locked --release --example basic
```

이 왕복이 싫으면 **2절 권고 첫 항의 래퍼 크레이트 방식**을 쓴다: 래퍼가 path/git 의존으로
`postflop-solver` 를 가리키고 **래퍼 디렉터리의 `Cargo.lock` 을 커밋**하면, 그 파일이 이름 그대로
`Cargo.lock` 이고 그래프 전체(래퍼 + postflop-solver + bincode rc.3)를 핀하므로 복사 단계가 사라진다.
**P4 스펙에서 둘 중 래퍼 방식 하나로 고정한다.**

`Cargo.lock` 없는 상태의 해석을 직접 보고 싶으면:
```bash
mkdir /tmp/locktest && cp -r Cargo.toml src /tmp/locktest/ && cd /tmp/locktest
cargo generate-lockfile && grep -A1 'name = "bincode"' Cargo.lock   # → 2.0.1
```

## 개정 이력

- **R3 (2026-09-11, P2 R2 리뷰 MINOR 2·3)**: 3절 `cargo tree -i windows-sys` 게이트 정의를 실측에 맞게 정정
  (그래프에 없으면 빈 출력이 아니라 `did not match any packages` + exit 101; exit 코드만 보는 게이트는
  다른 실패를 통과로 샌다 — 3분기 판정표로 교체). 5절 재현 절차에 `postflop-solver.lock` -> `Cargo.lock`
  복구 단계 추가 (`--locked` 는 `Cargo.lock` 만 읽는다) + 래퍼 크레이트 방식이면 이 단계가 불필요함을 명시.

- **R2 (2026-09-11, P2 R1 리뷰 MAJOR 3)**: 2절 시도 2 의 해석 정정 + **2.1 신설** (상류에 `Cargo.lock` 이 없다 — `git ls-files`/`.gitignore`/GitHub API 로 확인; 진짜 원인은 `^2.0.0-rc.3` 의 semver 해석이고 빈 디렉터리 `cargo generate-lockfile` 로 2.0.1 선택을 재현; R1 권고 (b) 툴체인 1.73 고정은 이 문제를 못 고친다). 권고를 "커밋된 rc.3 `Cargo.lock` + `--locked`" 로 교체하고 실제 빌드로 검증. 3절에 `cargo tree -i windows-sys` 게이트, 4절에 "루트에서만 잰 값" 미해소 항목 추가 (리뷰어 UNCERTAIN 1·2).
