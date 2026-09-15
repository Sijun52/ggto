//! P4.md 8.2 — **프로세스 밖에서** 본 계약: JSON-lines 프레이밍, `.part` 저장, 취소 지연.
//!
//! `cargo test` 가 빌드한 바이너리를 그대로 띄운다 (`CARGO_BIN_EXE_*`). 라이브러리 함수를
//! 부르는 것과 다른 것을 검사한다: stdout 이 한 줄에 한 객체인지, 취소가 `solve_step`
//! 경계에서 500ms 안에 응답하는지, 종료 코드가 0 인지.

use ggto_solver_cli::b64;
use ggto_solver_cli::config::COMBO_COUNT;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::time::Instant;

const BIN: &str = env!("CARGO_BIN_EXE_ggto-solver-cli");

/// 취소 테스트가 "끝나기 전에" 취소되려면 트리가 충분히 커야 한다. 그래도 16GB PC 에서
/// 안전한 크기다 (레인지 두 개가 포켓 + 브로드웨이 수티드).
fn wide_config(board: &str) -> serde_json::Value {
    let mut oop = vec![0.0f32; COMBO_COUNT];
    let mut ip = vec![0.0f32; COMBO_COUNT];
    let dead: Vec<u8> = board
        .as_bytes()
        .chunks(2)
        .map(|c| {
            let s = std::str::from_utf8(c).unwrap();
            postflop_solver::card_from_str(s).unwrap()
        })
        .collect();
    for hi in 1u8..52 {
        for lo in 0..hi {
            if dead.contains(&hi) || dead.contains(&lo) {
                continue;
            }
            let i = ggto_solver_cli::config::combo_index(hi, lo);
            // 페어 + 같은 슈트 = 적당히 넓고 결정적인 레인지.
            if hi >> 2 == lo >> 2 {
                oop[i] = 1.0;
                ip[i] = 1.0;
            } else if hi & 3 == lo & 3 && (hi >> 2) >= 6 && (lo >> 2) >= 6 {
                oop[i] = 1.0;
                ip[i] = 1.0;
            }
        }
    }
    serde_json::json!({
        "board": board,
        "oop": b64::encode_f32(&oop),
        "ip": b64::encode_f32(&ip),
        "potChips": 2000,
        "stackChips": 20000,
        "chipsPerBb": 100,
        "sizings": {
            "flop":  { "bet": "33%,75%", "raise": "2.5x" },
            "turn":  { "bet": "50%,100%", "raise": "2.5x" },
            "river": { "bet": "50%,100%", "raise": "2.5x" },
        },
        "rake": { "mode": "none" },
        "compressed": false,
    })
}

fn spawn(mode: &str) -> (Child, ChildStdout) {
    let mut child = Command::new(BIN)
        .arg(mode)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn solver");
    let out = child.stdout.take().expect("stdout");
    (child, out)
}

fn send(child: &mut Child, value: serde_json::Value) {
    let stdin = child.stdin.as_mut().expect("stdin");
    stdin.write_all(value.to_string().as_bytes()).unwrap();
    stdin.write_all(b"\n").unwrap();
    stdin.flush().unwrap();
}

fn next_line(reader: &mut BufReader<ChildStdout>) -> serde_json::Value {
    let mut line = String::new();
    let n = reader.read_line(&mut line).expect("read");
    assert!(n > 0, "daemon closed stdout early");
    serde_json::from_str(&line).unwrap_or_else(|e| panic!("not one JSON object per line: {} in {:?}", e, line))
}

#[test]
fn p4_8_2_hello_reports_protocol_1_and_the_pinned_solver() {
    let (mut child, out) = spawn("--serve");
    let mut reader = BufReader::new(out);
    send(&mut child, serde_json::json!({ "id": 7, "method": "hello", "params": {} }));
    let v = next_line(&mut reader);
    assert_eq!(v["id"], 7);
    assert_eq!(v["result"]["protocol"], 1);
    assert_eq!(v["result"]["solver"], "postflop-solver@9d1509fe");
    drop(child.stdin.take());
    assert_eq!(child.wait().unwrap().code(), Some(0), "stdin EOF must exit 0");
}

#[test]
fn p4_8_2_solve_writes_the_part_file_and_reaches_the_target() {
    let dir = std::env::temp_dir().join(format!("ggto-solve-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let part = dir.join("result.bin.part");
    let (mut child, out) = spawn("--solve");
    let mut reader = BufReader::new(out);
    send(
        &mut child,
        serde_json::json!({
            "id": 1, "method": "solve",
            "params": {
                "config": wide_config("Ks7h2hQc"),
                "targetExploitabilityPct": 0.5,
                "maxIterations": 400,
                "progressEvery": 20,
                "outPath": part.to_string_lossy(),
            }
        }),
    );
    let mut last_pct = -1.0f64;
    let mut progress_seen = 0;
    let result = loop {
        let v = next_line(&mut reader);
        if v["method"] == "progress" {
            progress_seen += 1;
            let pct = v["params"]["pct"].as_f64().unwrap();
            assert!(pct >= last_pct - 1e-9, "pct must not go backwards: {} -> {}", last_pct, pct);
            last_pct = pct;
            assert!(v["params"]["iter"].as_u64().unwrap() > 0);
            continue;
        }
        break v;
    };
    assert!(progress_seen >= 2, "expected progress notifications, got {}", progress_seen);
    assert_eq!(result["id"], 1, "unexpected frame: {}", result);
    let expl = result["result"]["exploitabilityPct"].as_f64().unwrap();
    assert!(expl <= 0.5, "exploitability {}% did not reach the 0.5% target", expl);
    assert!(part.exists(), ".part file was not written");
    assert_eq!(
        result["result"]["bytes"].as_u64().unwrap(),
        std::fs::metadata(&part).unwrap().len()
    );
    drop(child.stdin.take());
    child.wait().unwrap();
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn p4_8_2_cancel_answers_within_500ms_at_a_solve_step_boundary() {
    let dir = std::env::temp_dir().join(format!("ggto-cancel-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let part = dir.join("cancel.bin.part");
    let (mut child, out) = spawn("--solve");
    let mut reader = BufReader::new(out);
    send(
        &mut child,
        serde_json::json!({
            "id": 1, "method": "solve",
            "params": {
                // 턴 스팟이다. 취소 응답의 하한은 **solve_step 한 번**이라 트리가 크면
                // 500ms 를 넘을 수 있다 (플랍 wide 트리 실측 1.4s/step). 프로세스를 확실히
                // 세우는 것은 클라이언트의 "stdin close -> 2s -> kill" 경로다 (P4.md 5.1).
                "config": wide_config("Ks7h2hQc"),
                "targetExploitabilityPct": 0.05,
                "maxIterations": 100_000,
                "progressEvery": 1,
                "outPath": part.to_string_lossy(),
            }
        }),
    );
    // 첫 진행률을 받고 나면 확실히 솔브 루프 안이다.
    loop {
        if next_line(&mut reader)["method"] == "progress" {
            break;
        }
    }
    let sent_at = Instant::now();
    send(&mut child, serde_json::json!({ "id": 2, "method": "cancel", "params": {} }));

    let mut cancel_ack = None;
    let mut solve_err = None;
    while cancel_ack.is_none() || solve_err.is_none() {
        let v = next_line(&mut reader);
        if v["id"] == 2 {
            cancel_ack = Some(sent_at.elapsed());
        } else if v["id"] == 1 {
            solve_err = Some(v["error"]["code"].as_str().unwrap().to_string());
        }
    }
    let elapsed = cancel_ack.unwrap();
    assert_eq!(solve_err.as_deref(), Some("Cancelled"));
    assert!(elapsed.as_millis() <= 500, "cancel took {:?}", elapsed);
    // 취소된 잡은 `.part` 를 남기지 않는다 (P4.md 8.3).
    assert!(!part.exists(), ".part must not exist after a cancel");
    drop(child.stdin.take());
    assert_eq!(child.wait().unwrap().code(), Some(0));
    std::fs::remove_dir_all(&dir).ok();
}
