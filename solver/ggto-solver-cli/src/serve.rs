//! `--serve` 모드: 상주 조회 데몬 (P4.md 5.1 · 5.4 · 5.5).
//!
//! 솔브 프로세스와 분리한 이유: 조회는 결과를 **메모리에 올린 채** 답해야 빠르고,
//! 솔브는 끝나면 메모리를 반납해야 한다. 한 프로세스에 합치면 둘 중 하나를 포기하게 된다.
//! 로드 상한(`GGTO_SOLVER_LOADED_BYTES`)을 넘으면 `last_used` 가 오래된 것부터 버린다.
//!
//! **상한은 `.bin` 파일 크기의 합**이다 (RSS 를 폴링하지 않는다 — 결정적이고 공짜다).
//! 실측 배수 (R1 UNCERTAIN 2, 이 PC, 세 파일 누적 로드):
//! ```text
//!   파일 0.54MB  -> RSS 증가 2.3MB   (×4.32, 고정 오버헤드가 지배)
//!   파일 5.42MB  -> RSS 증가 13.3MB  (×2.45)
//!   파일 327MB   -> RSS 증가 686MB   (×2.10)
//! ```
//! 즉 파일 합 1GB ≈ RSS 2.1GB 다. 5.1 이 말하는 "2GB" 는 **프로세스 메모리**이므로
//! 기본 상한을 파일 합 **1GB** 로 둔다 (옛 기본 2GB 는 RSS 4GB 를 뜻했다).

use crate::lines;
use crate::nodes;
use crate::proto::{RpcError, RpcResult};
use postflop_solver::*;
use serde::Deserialize;
use serde_json::json;

const DEFAULT_LOADED_BYTES: u64 = 1024 * 1024 * 1024;

fn loaded_cap() -> u64 {
    std::env::var("GGTO_SOLVER_LOADED_BYTES")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|&n| n > 0)
        .unwrap_or(DEFAULT_LOADED_BYTES)
}

struct Loaded {
    hash: String,
    game: PostFlopGame,
    bytes: u64,
    /// 파일의 (크기, mtime). **해시만으로 멱등이면 안 된다** (P4 R1 MAJOR 3):
    /// 재솔브(REPLACE)·삭제 후 재솔브는 같은 해시로 **다른 `.bin`** 을 만든다. 크기와
    /// mtime 이 로드 당시와 다르면 사용자가 요청한 정확도가 아닌 낡은 결과를 주게 된다.
    stamp: FileStamp,
    chips_per_bb: i32,
    last_used: u64,
}

/// 파일 동일성 지문. 크기만으로는 "같은 크기로 다시 수렴한 재솔브" 를 못 잡는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileStamp {
    len: u64,
    mtime_ns: u128,
}

fn file_stamp(path: &str) -> Result<FileStamp, RpcError> {
    let md = std::fs::metadata(path)
        .map_err(|e| RpcError::new("NotLoaded", format!("cannot stat {}: {}", path, e)))?;
    let mtime_ns = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    Ok(FileStamp { len: md.len(), mtime_ns })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadParams {
    hash: String,
    path: String,
    /// EV 를 bb 로 되돌리는 데 필요하다. `.bin` 메모에도 적지만 계약은 요청이 준다.
    chips_per_bb: i32,
}

#[derive(Debug, Deserialize)]
struct HashParams {
    hash: String,
}

#[derive(Debug, Deserialize)]
struct NodeParams {
    hash: String,
    #[serde(default)]
    line: String,
}

fn parse<T: serde::de::DeserializeOwned>(params: serde_json::Value) -> Result<T, RpcError> {
    serde_json::from_value(params).map_err(|e| RpcError::bad_request(format!("bad params: {}", e)))
}

pub struct ServeSession {
    loaded: Vec<Loaded>,
    clock: u64,
}

impl ServeSession {
    pub fn new() -> Self {
        Self { loaded: Vec::new(), clock: 0 }
    }

    fn touch(&mut self, idx: usize) {
        self.clock += 1;
        self.loaded[idx].last_used = self.clock;
    }

    fn find(&self, hash: &str) -> Option<usize> {
        self.loaded.iter().position(|l| l.hash == hash)
    }

    fn evict_to_fit(&mut self, incoming: u64) {
        let cap = loaded_cap();
        while !self.loaded.is_empty() && self.loaded.iter().map(|l| l.bytes).sum::<u64>() + incoming > cap {
            let victim = self
                .loaded
                .iter()
                .enumerate()
                .min_by_key(|(_, l)| l.last_used)
                .map(|(i, _)| i)
                .expect("non-empty");
            let gone = self.loaded.remove(victim);
            crate::proto::log(&format!("unloaded {} ({} bytes) to fit {} bytes", gone.hash, gone.bytes, incoming));
        }
    }

    pub fn load(&mut self, params: serde_json::Value) -> RpcResult {
        let p: LoadParams = parse(params)?;
        if p.chips_per_bb <= 0 {
            return Err(RpcError::bad_request("chipsPerBb must be positive"));
        }
        let stamp = file_stamp(&p.path)?;
        if let Some(i) = self.find(&p.hash) {
            if self.loaded[i].stamp == stamp {
                // 같은 파일이면 멱등이다 — 데몬이 죽었다 살아난 뒤 클라이언트가 그냥 다시 부른다.
                self.touch(i);
                let l = &self.loaded[i];
                let mut game_info = json!({ "bytes": l.bytes, "reloaded": false });
                let (street, actions) = self.root_info(i)?;
                game_info["street"] = json!(street);
                game_info["actionsRoot"] = json!(actions);
                return Ok(game_info);
            }
            // 파일이 바뀌었다 (재솔브 REPLACE 또는 삭제 후 재솔브). 낡은 결과를 버린다.
            let gone = self.loaded.remove(i);
            crate::proto::log(&format!(
                "reloading {}: file changed ({} bytes -> {} bytes)",
                gone.hash, gone.bytes, stamp.len
            ));
        }
        let file_bytes = stamp.len;
        self.evict_to_fit(file_bytes);
        let (game, memo): (PostFlopGame, String) =
            load_data_from_file(&p.path, None).map_err(|e| RpcError::new("NotLoaded", e))?;
        crate::proto::log(&format!("loaded {} ({} bytes) memo={:?}", p.hash, file_bytes, memo));
        self.clock += 1;
        self.loaded.push(Loaded {
            hash: p.hash,
            game,
            bytes: file_bytes,
            stamp,
            chips_per_bb: p.chips_per_bb,
            last_used: self.clock,
        });
        let i = self.loaded.len() - 1;
        let (street, actions) = self.root_info(i)?;
        Ok(json!({ "bytes": file_bytes, "street": street, "actionsRoot": actions, "reloaded": true }))
    }

    fn root_info(&mut self, i: usize) -> Result<(&'static str, Vec<String>), RpcError> {
        let chips_per_bb = self.loaded[i].chips_per_bb;
        let game = &mut self.loaded[i].game;
        game.back_to_root();
        let street = nodes::street_of(game.current_board().len());
        let actions = if game.is_chance_node() || game.is_terminal_node() {
            Vec::new()
        } else {
            lines::action_tokens(game, chips_per_bb)?
        };
        Ok((street, actions))
    }

    pub fn unload(&mut self, params: serde_json::Value) -> RpcResult {
        let p: HashParams = parse(params)?;
        let before = self.loaded.len();
        self.loaded.retain(|l| l.hash != p.hash);
        Ok(json!({ "ok": self.loaded.len() < before }))
    }

    pub fn node(&mut self, params: serde_json::Value) -> RpcResult {
        let p: NodeParams = parse(params)?;
        let i = self
            .find(&p.hash)
            .ok_or_else(|| RpcError::new("NotLoaded", format!("{} is not loaded", p.hash)))?;
        self.touch(i);
        let chips_per_bb = self.loaded[i].chips_per_bb;
        nodes::node_response(&mut self.loaded[i].game, &p.line, chips_per_bb)
    }

    pub fn runouts(&mut self, params: serde_json::Value) -> RpcResult {
        let p: NodeParams = parse(params)?;
        let i = self
            .find(&p.hash)
            .ok_or_else(|| RpcError::new("NotLoaded", format!("{} is not loaded", p.hash)))?;
        self.touch(i);
        let chips_per_bb = self.loaded[i].chips_per_bb;
        nodes::runouts_response(&mut self.loaded[i].game, &p.line, chips_per_bb)
    }

    pub fn stats(&self) -> serde_json::Value {
        json!({
            "loadedBytes": self.loaded.iter().map(|l| l.bytes).sum::<u64>(),
            "cap": loaded_cap(),
            "loaded": self.loaded.iter().map(|l| json!({
                "hash": l.hash, "bytes": l.bytes, "lastUsed": l.last_used,
            })).collect::<Vec<_>>(),
        })
    }
}
