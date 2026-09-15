//! base64 f32 (little-endian) 왕복. 이진 데이터는 전부 이 모듈을 지난다 (P4.md 5.3).
//!
//! `unsafe` 로 슬라이스를 재해석하지 않는다: 정렬 보장이 없고, 엔디안을 명시해야
//! Node 쪽 `new Float32Array(buf.buffer, off, n)` 과 계약이 맞는다 (x86/ARM 둘 다 LE 지만
//! 그 사실에 기대는 코드는 주석 없이 깨진다).

use crate::proto::RpcError;
use base64::Engine;

pub fn encode_f32(xs: &[f32]) -> String {
    let mut bytes = Vec::with_capacity(xs.len() * 4);
    for x in xs {
        bytes.extend_from_slice(&x.to_le_bytes());
    }
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

pub fn decode_f32(s: &str) -> Result<Vec<f32>, RpcError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|e| RpcError::bad_request(format!("bad base64: {}", e)))?;
    if bytes.len() % 4 != 0 {
        return Err(RpcError::bad_request("base64 payload is not a multiple of 4 bytes"));
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect())
}
