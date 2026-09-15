//! `--serve` 모드: 상주 조회 데몬 (P4.md 5.1 · 5.4 · 5.5).
//!
//! 솔브 프로세스와 분리한 이유: 조회는 결과를 **메모리에 올린 채** 답해야 빠르고,
//! 솔브는 끝나면 메모리를 반납해야 한다. 한 프로세스에 합치면 둘 중 하나를 포기하게 된다.
//! 로드 상한(`GGTO_SOLVER_LOADED_BYTES`, 기본 2GB)을 넘으면 `last_used` 가 오래된 것부터 버린다.

use crate::lines;
use crate::nodes;
use crate::proto::{RpcError, RpcResult};
use postflop_solver::*;
use serde::Deserialize;
use serde_json::json;

const DEFAULT_LOADED_BYTES: u64 = 2 * 1024 * 1024 * 1024;

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
    chips_per_bb: i32,
    last_used: u64,
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
        if let Some(i) = self.find(&p.hash) {
            // 멱등이다 — 데몬이 죽었다 살아난 뒤 클라이언트가 그냥 다시 부른다.
            self.touch(i);
            let l = &self.loaded[i];
            let mut game_info = json!({ "bytes": l.bytes });
            let (street, actions) = self.root_info(i)?;
            game_info["street"] = json!(street);
            game_info["actionsRoot"] = json!(actions);
            return Ok(game_info);
        }
        let file_bytes = std::fs::metadata(&p.path)
            .map_err(|e| RpcError::new("NotLoaded", format!("cannot stat {}: {}", p.path, e)))?
            .len();
        self.evict_to_fit(file_bytes);
        let (game, memo): (PostFlopGame, String) =
            load_data_from_file(&p.path, None).map_err(|e| RpcError::new("NotLoaded", e))?;
        crate::proto::log(&format!("loaded {} ({} bytes) memo={:?}", p.hash, file_bytes, memo));
        self.clock += 1;
        self.loaded.push(Loaded {
            hash: p.hash,
            game,
            bytes: file_bytes,
            chips_per_bb: p.chips_per_bb,
            last_used: self.clock,
        });
        let i = self.loaded.len() - 1;
        let (street, actions) = self.root_info(i)?;
        Ok(json!({ "bytes": file_bytes, "street": street, "actionsRoot": actions }))
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
