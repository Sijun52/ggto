//! `ggto-solver-cli` 의 내부 모듈. 바이너리와 **통합 테스트가 같은 코드를 본다**
//! (바이너리 크레이트만 있으면 `tests/` 가 모듈을 import 할 수 없어서 프로토콜 계약을
//! 프로세스 밖에서만 검사하게 된다 — 필드명 단언을 하려면 lib 타깃이 필요하다).

pub mod b64;
pub mod config;
pub mod lines;
pub mod nodes;
pub mod proto;
pub mod serve;
pub mod solve;
