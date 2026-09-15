//! stdio JSON-lines RPC 의 요청·응답 타입 (P4.md 5.3).
//!
//! 한 줄 = JSON 객체 하나. 이진 프레임을 쓰지 않는 이유는 D23 에 있다 —
//! 노드 하나가 base64 로 ~43KB 라 별도 프레이밍의 이유가 없고, 벤치가 왕복 20ms 를
//! 넘길 때만 이 문서 개정으로 도입한다.

use serde::{Deserialize, Serialize};

/// 프로토콜 버전. 클라이언트가 `hello` 로 맞춘다. 바뀌면 클라이언트가 즉시 종료한다.
pub const PROTOCOL: u32 = 1;
/// 고정한 상류 커밋 (P4.md 1절). 캐시 행의 `solver` 컬럼에 그대로 들어간다.
pub const SOLVER_ID: &str = "postflop-solver@9d1509fe";

#[derive(Debug, Deserialize)]
pub struct Request {
    /// 알림에는 없다.
    #[serde(default)]
    pub id: Option<u64>,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// `@ggto/solver` 의 `SolverError.code` 와 같은 문자열을 쓴다 (P4.md 5.3 표 아래).
#[derive(Debug)]
pub struct RpcError {
    pub code: &'static str,
    pub message: String,
}

impl RpcError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new("BadRequest", message)
    }
}

impl From<String> for RpcError {
    /// postflop-solver 는 실패를 `String` 으로 돌려준다. 그대로 삼키지 않고 `BadRequest` 로 올린다.
    fn from(e: String) -> Self {
        Self::bad_request(e)
    }
}

pub type RpcResult = Result<serde_json::Value, RpcError>;

#[derive(Debug, Serialize)]
pub struct Hello {
    pub protocol: u32,
    pub solver: &'static str,
    pub build: String,
    pub features: Vec<&'static str>,
}

/// 한 줄을 stdout 에 쓰고 즉시 flush 한다. 버퍼에 남으면 부모가 진행률을 못 본다.
pub fn write_line(value: &serde_json::Value) {
    use std::io::Write;
    let stdout = std::io::stdout();
    let mut lock = stdout.lock();
    let _ = serde_json::to_writer(&mut lock, value);
    let _ = lock.write_all(b"\n");
    let _ = lock.flush();
}

pub fn write_result(id: Option<u64>, result: serde_json::Value) {
    write_line(&serde_json::json!({ "id": id, "result": result }));
}

pub fn write_error(id: Option<u64>, err: &RpcError) {
    write_line(&serde_json::json!({
        "id": id,
        "error": { "code": err.code, "message": err.message },
    }));
}

pub fn write_notification(method: &str, params: serde_json::Value) {
    write_line(&serde_json::json!({ "method": method, "params": params }));
}

/// stderr 는 로그 전용이다 (클라이언트가 서버 로그로 흘린다). stdout 에 섞으면 프레임이 깨진다.
pub fn log(msg: &str) {
    use std::io::Write;
    let _ = writeln!(std::io::stderr(), "{}", msg);
}
