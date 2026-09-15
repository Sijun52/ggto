//! `--solve` 모드: `estimate` 와 `solve` (P4.md 5.2 · 5.3).
//!
//! 트리 빌드와 메모리 추정은 **할당 전에** 끝난다 — 잡 큐의 8GB 게이트가 의미를 가지려면
//! "얼마나 필요한지" 를 먼저 알아야 한다 (P4.md 5.2). `estimate` 는 `allocate_memory` 를
//! 부르지 않는다.

use crate::config::{self, WireConfig};
use crate::proto::{self, RpcError, RpcResult};
use postflop_solver::*;
use serde::Deserialize;
use serde_json::json;
use std::sync::mpsc;
use std::time::Instant;

/// `estSeconds` 상수 (P4.md 5.2 "조악한 추정이라도 좋다").
///
/// 한 iteration 의 일량은 트리 전체를 한 번 훑는 것이라 **비압축 메모리 크기에 비례**한다.
/// 이 PC(6코어, rayon) 실측을 맞춘 값이고, 벤치가 실측/추정 비를 기록한다 (P4.md 9).
const BYTES_PER_SEC_PER_ITER: f64 = 3.0e9;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EstimateParams {
    config: WireConfig,
    /// 없으면 1000 (P4.md 3.1 기본값). 추정 시간은 iteration 수에 비례한다.
    max_iterations: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SolveParams {
    config: WireConfig,
    target_exploitability_pct: f64,
    max_iterations: u32,
    #[serde(default = "default_progress_every")]
    progress_every: u32,
    /// `.part` 경로. 완료 후 rename 은 Node 가 한다 (P4.md 4.2).
    out_path: String,
}

fn default_progress_every() -> u32 {
    10
}

fn parse<T: serde::de::DeserializeOwned>(params: serde_json::Value) -> Result<T, RpcError> {
    serde_json::from_value(params).map_err(|e| RpcError::bad_request(format!("bad params: {}", e)))
}

fn est_seconds(memory_bytes: u64, max_iterations: u32) -> f64 {
    memory_bytes as f64 * max_iterations as f64 / BYTES_PER_SEC_PER_ITER
}

pub fn estimate(params: serde_json::Value) -> RpcResult {
    let p: EstimateParams = parse(params)?;
    let built = config::build(&p.config)?;
    let nodes = config::count_tree_nodes(built.tree.clone())?;
    let tree = ActionTree::new(built.tree).map_err(RpcError::from)?;
    let game = PostFlopGame::with_config(built.card, tree).map_err(RpcError::from)?;
    let (mem, mem_compressed) = game.memory_usage();
    let chosen = if built.compressed { mem_compressed } else { mem };
    Ok(json!({
        "nodes": nodes,
        "memoryBytes": mem,
        "memoryBytesCompressed": mem_compressed,
        // **상한 기준**이다: 목표 exploitability 에 일찍 도달하면 실제는 이보다 짧다.
        // 벤치가 실측/추정 비를 기록한다 (P4.md 9).
        "estSeconds": est_seconds(chosen, p.max_iterations.unwrap_or(1000)),
    }))
}

pub struct SolveSession {
    cancelled: bool,
}

impl SolveSession {
    pub fn new() -> Self {
        Self { cancelled: false }
    }

    /// 취소 요청이 왔는지 본다. 온 요청은 여기서 바로 응답하고 (`{ok:true}`) 삼키지 않는다.
    fn poll_cancel(&mut self, rx: &mpsc::Receiver<Option<proto::Request>>) -> bool {
        while let Ok(msg) = rx.try_recv() {
            match msg {
                Some(req) if req.method == "cancel" => {
                    proto::write_result(req.id, json!({ "ok": true }));
                    self.cancelled = true;
                }
                // stdin 이 닫혔다 = 부모가 취소했다 (P4.md 5.1: 취소 = stdin close → kill).
                None => self.cancelled = true,
                Some(req) => proto::write_error(
                    req.id,
                    &RpcError::bad_request("solver is busy; only `cancel` is accepted while solving"),
                ),
            }
        }
        self.cancelled
    }

    pub fn run(
        &mut self,
        params: serde_json::Value,
        _id: Option<u64>,
        rx: &mpsc::Receiver<Option<proto::Request>>,
    ) -> RpcResult {
        let p: SolveParams = parse(params)?;
        if !(0.05..=5.0).contains(&p.target_exploitability_pct) {
            return Err(RpcError::bad_request("targetExploitabilityPct must be in [0.05, 5]"));
        }
        if !(10..=100_000).contains(&p.max_iterations) {
            return Err(RpcError::bad_request("maxIterations must be in [10, 100000]"));
        }
        let built = config::build(&p.config)?;
        let chips_per_bb = built.chips_per_bb;
        let compressed = built.compressed;
        let starting_pot = built.tree.starting_pot as f32;
        let tree = ActionTree::new(built.tree).map_err(RpcError::from)?;
        let mut game = PostFlopGame::with_config(built.card, tree).map_err(RpcError::from)?;

        let started = Instant::now();
        game.allocate_memory(compressed);
        let target = starting_pot * (p.target_exploitability_pct as f32) / 100.0;

        let mut expl = compute_exploitability(&game);
        let first_expl = expl.max(target);
        let mut iterations = 0u32;
        for i in 0..p.max_iterations {
            if self.poll_cancel(rx) {
                return Err(RpcError::new("Cancelled", "cancelled at a solve_step boundary"));
            }
            solve_step(&game, i);
            iterations = i + 1;
            if iterations % p.progress_every == 0 || iterations == p.max_iterations {
                expl = compute_exploitability(&game);
                proto::write_notification(
                    "progress",
                    json!({
                        "iter": iterations,
                        "exploitabilityPct": 100.0 * expl as f64 / starting_pot as f64,
                        "pct": progress_pct(iterations, p.max_iterations, first_expl, expl, target),
                    }),
                );
                if expl <= target {
                    break;
                }
            }
        }
        finalize(&mut game);
        expl = compute_exploitability(&game);

        // 저장까지 끝나야 응답한다 (P4.md 5.3 표). `.part` 이름은 Node 가 준다.
        let memo = format!("ggto v1 chipsPerBb={} solver={}", chips_per_bb, proto::SOLVER_ID);
        save_data_to_file(&game, &memo, &p.out_path, None).map_err(RpcError::from)?;
        let bytes = std::fs::metadata(&p.out_path).map(|m| m.len()).unwrap_or(0);

        Ok(json!({
            "iterations": iterations,
            "exploitabilityPct": 100.0 * expl as f64 / starting_pot as f64,
            "elapsedMs": started.elapsed().as_millis() as u64,
            "bytes": bytes,
        }))
    }
}

/// 진행률. iteration 비율과 **exploitability 의 로그 진행** 중 큰 쪽이다 (P4.md 5.3):
/// CFR 은 초반에 exploitability 가 급락하므로 iteration 비율만 보면 "90% 에서 끝났는데
/// 바가 20%" 가 된다.
fn progress_pct(iter: u32, max_iter: u32, first: f32, current: f32, target: f32) -> f64 {
    let by_iter = iter as f64 / max_iter as f64;
    let by_log = if first > target && current > 0.0 && target > 0.0 {
        ((first / current).ln() / (first / target).ln()) as f64
    } else {
        0.0
    };
    by_iter.max(by_log).clamp(0.0, 1.0)
}
