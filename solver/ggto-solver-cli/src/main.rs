//! `ggto-solver-cli` — postflop-solver 를 stdio JSON-lines RPC 뒤에 두는 래퍼 (P4.md).
//!
//! **왜 별도 프로세스인가 (D2·D22)**: postflop-solver 는 AGPL-3.0-or-later 다. 프로세스
//! 경계가 배포 시 라이선스 선을 지킨다. 그리고 GB 단위 솔브 메모리는 프로세스가 끝나야
//! 확실히 돌아온다 — 라이브러리 내부 해제에 기대지 않는다. 취소도 kill 한 번이다.
//!
//! 두 모드가 같은 바이너리·같은 프로토콜을 쓴다 (P4.md 5.1):
//!   `--solve` : 잡 하나를 풀고 `.bin` 을 남긴다. `estimate`/`solve`/`cancel`
//!   `--serve` : 상주 조회 데몬. `load`/`unload`/`node`/`runouts`/`stats`
//!
//! 인자 파싱은 손으로 한다 — `clap` 은 `windows-sys` 를 끌어오고 GNU 호스트의 번들
//! dlltool 이 import library 를 못 만든다 (스파이크 3절, `scripts/solver-gate.mjs`).

use ggto_solver_cli::{proto, serve, solve};
use proto::{write_error, write_result, RpcError, RpcResult};
use std::sync::mpsc;

fn usage() -> ! {
    proto::log("usage: ggto-solver-cli (--solve | --serve)");
    std::process::exit(2);
}

/// stdin 을 줄 단위로 읽어 채널에 넣는 스레드. 솔브 중에도 `cancel` 을 받으려면
/// 읽기가 블로킹 루프와 분리돼 있어야 한다 (tokio 없이).
fn spawn_reader() -> mpsc::Receiver<Option<proto::Request>> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        use std::io::BufRead;
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            let line = match line {
                Ok(l) => l,
                Err(e) => {
                    proto::log(&format!("stdin read error: {}", e));
                    break;
                }
            };
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<proto::Request>(&line) {
                Ok(req) => {
                    if tx.send(Some(req)).is_err() {
                        return;
                    }
                }
                Err(e) => {
                    // 파싱 실패는 프레임 하나의 문제다 — 프로세스를 죽이지 않는다.
                    proto::log(&format!("bad request line: {}", e));
                }
            }
        }
        let _ = tx.send(None); // EOF
    });
    rx
}

fn hello() -> RpcResult {
    Ok(serde_json::to_value(proto::Hello {
        protocol: proto::PROTOCOL,
        solver: proto::SOLVER_ID,
        build: std::env::var("GGTO_BUILD_SHA").unwrap_or_else(|_| "unknown".to_string()),
        features: vec!["compressed"],
    })
    .expect("Hello is serializable"))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mode = match args.first().map(String::as_str) {
        Some("--solve") => "solve",
        Some("--serve") => "serve",
        _ => usage(),
    };
    if args.len() > 1 {
        proto::log(&format!("ignoring extra args: {:?}", &args[1..]));
    }

    let rx = spawn_reader();
    let mut solver = solve::SolveSession::new();
    let mut server = serve::ServeSession::new();

    while let Ok(Some(req)) = rx.recv() {
        let id = req.id;
        let result: RpcResult = match (mode, req.method.as_str()) {
            (_, "hello") => hello(),
            ("solve", "estimate") => solve::estimate(req.params),
            ("solve", "solve") => solver.run(req.params, id, &rx),
            ("solve", "cancel") => Ok(serde_json::json!({ "ok": true })),
            ("serve", "load") => server.load(req.params),
            ("serve", "unload") => server.unload(req.params),
            ("serve", "node") => server.node(req.params),
            ("serve", "runouts") => server.runouts(req.params),
            ("serve", "stats") => Ok(server.stats()),
            (m, other) => Err(RpcError::bad_request(format!("method {:?} is not available in --{} mode", other, m))),
        };
        match result {
            Ok(value) => write_result(id, value),
            Err(e) => write_error(id, &e),
        }
    }
    // stdin EOF = 부모가 끝났다는 신호다. 정상 종료한다.
}
