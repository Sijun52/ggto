//! `node` / `runouts` 응답 (P4.md 5.4 · 5.5). **정규 보드 기준**이다 —
//! 슈트 역순열은 `@ggto/solver` 가 한다 (P4.md 2절: 서버·웹은 정규 보드를 모른다).
//!
//! **EV 기준점 (P4.md 3.5 — 내부 노드 프로브로 확정)**: `expected_values()` 는 칩 단위의
//! "그 노드 이후 스택 변화" 다. `examples/evprobe.rs` 를 5개 노드(루트 + 내부 3 + 리버 1)에서
//! 돌려 `Σ_players ev = 그 노드의 팟` 이 **정확히** 성립함을 확인했다 (오차 0.0000).
//! 루트 기준이었다면 내부 노드에서 합이 `starting_pot` 이어야 하는데 +150/+525/+300 으로
//! 갈라졌다. 따라서 변환은 오프셋 없이 `/chipsPerBb` 뿐이고 `evBasis` 는 항상
//! `stack_delta_from_node` 다 (P3.md 3.3 과 같은 정의).

use crate::b64;
use crate::config::{combo_index, COMBO_COUNT};
use crate::lines;
use crate::proto::RpcError;
use postflop_solver::*;
use serde_json::json;

pub const EV_BASIS: &str = "stack_delta_from_node";

/// 플레이어의 핸드별 값(길이 = private_cards 수) → 1326 배열. 없는 콤보는 0 이다
/// (보드와 충돌하거나 레인지 밖 — 둘 다 "도달 0" 이라 0 이 맞다).
fn scatter(game: &PostFlopGame, player: usize, values: &[f32], scale: f32) -> Vec<f32> {
    let cards = game.private_cards(player);
    let mut out = vec![0.0f32; COMBO_COUNT];
    for (i, &(a, b)) in cards.iter().enumerate() {
        if let Some(&v) = values.get(i) {
            out[combo_index(a, b)] = v * scale;
        }
    }
    out
}

/// `[actions][hands]` → `[actions][1326]` 을 이어 붙인 하나의 배열.
fn scatter_rows(game: &PostFlopGame, player: usize, values: &[f32], num_actions: usize, scale: f32) -> Vec<f32> {
    let num_hands = game.private_cards(player).len();
    let mut out = vec![0.0f32; num_actions * COMBO_COUNT];
    let cards = game.private_cards(player);
    for a in 0..num_actions {
        for (i, &(c1, c2)) in cards.iter().enumerate() {
            let v = values[a * num_hands + i];
            out[a * COMBO_COUNT + combo_index(c1, c2)] = v * scale;
        }
    }
    out
}

pub fn street_of(board_len: usize) -> &'static str {
    match board_len {
        3 => "flop",
        4 => "turn",
        _ => "river",
    }
}

fn board_string(game: &PostFlopGame) -> Result<String, RpcError> {
    let mut s = String::new();
    for c in game.current_board() {
        s.push_str(&card_to_string(c).map_err(RpcError::from)?);
    }
    Ok(s)
}

/// 그 노드의 팟 (두 플레이어가 그때까지 넣은 전부 포함). EV 합의 기준값이다.
fn node_pot(game: &PostFlopGame) -> i32 {
    let bets = game.total_bet_amount();
    game.tree_config().starting_pot + bets[0] + bets[1]
}

pub fn node_response(game: &mut PostFlopGame, line: &str, chips_per_bb: i32) -> Result<serde_json::Value, RpcError> {
    lines::apply_line(game, line, chips_per_bb)?;
    if game.is_terminal_node() {
        return Err(RpcError::new("NoSuchLine", format!("{:?} is a terminal node", line)));
    }
    if game.is_chance_node() {
        return Err(RpcError::new(
            "BadRequest",
            format!("{:?} is a chance node — use the `runouts` method", line),
        ));
    }
    game.cache_normalized_weights();

    let player = game.current_player();
    let actions = lines::action_tokens(game, chips_per_bb)?;
    let num_actions = actions.len();
    let inv_bb = 1.0 / chips_per_bb as f32;

    let strategy = scatter_rows(game, player, &game.strategy(), num_actions, 1.0);
    let ev = scatter_rows(game, player, &game.expected_values_detail(player), num_actions, inv_bb);
    let reach = [
        b64::encode_f32(&scatter(game, 0, game.normalized_weights(0), 1.0)),
        b64::encode_f32(&scatter(game, 1, game.normalized_weights(1), 1.0)),
    ];
    let equity = [
        b64::encode_f32(&scatter(game, 0, &game.equity(0), 1.0)),
        b64::encode_f32(&scatter(game, 1, &game.equity(1), 1.0)),
    ];

    let bets = game.total_bet_amount();
    let stack = game.tree_config().effective_stack;
    // 3.5 의 증인: 두 플레이어의 레인지 가중 평균 EV. 합이 그 노드의 팟이어야 한다.
    // 1326 배열만 주면 호출자가 이 항등식을 **검증**할 수 없다 (상대 EV 가 응답에 없다).
    let ev_avg = [
        compute_average(&game.expected_values(0), game.normalized_weights(0)) * inv_bb,
        compute_average(&game.expected_values(1), game.normalized_weights(1)) * inv_bb,
    ];
    let canonical_line = lines::line_of(game, chips_per_bb)?;

    Ok(json!({
        "street": street_of(game.current_board().len()),
        "line": canonical_line,
        "board": board_string(game)?,
        "player": if player == 0 { "oop" } else { "ip" },
        "potChips": node_pot(game),
        "stacksChips": [stack - bets[0], stack - bets[1]],
        "actions": actions,
        "strategy": b64::encode_f32(&strategy),
        "ev": b64::encode_f32(&ev),
        "reach": reach,
        "equity": equity,
        "evAvgBb": ev_avg,
        "evBasis": EV_BASIS,
    }))
}

/// 두 플레이어 EV 합 (bb). `Σ = node_pot/chipsPerBb` 여야 한다 (3.5 성질 테스트).
pub fn ev_sum_bb(game: &mut PostFlopGame, chips_per_bb: i32) -> (f32, f32) {
    game.cache_normalized_weights();
    let a = compute_average(&game.expected_values(0), game.normalized_weights(0));
    let b = compute_average(&game.expected_values(1), game.normalized_weights(1));
    ((a + b) / chips_per_bb as f32, node_pot(game) as f32 / chips_per_bb as f32)
}

pub fn runouts_response(game: &mut PostFlopGame, line: &str, chips_per_bb: i32) -> Result<serde_json::Value, RpcError> {
    lines::apply_line(game, line, chips_per_bb)?;
    if !game.is_chance_node() {
        return Err(RpcError::new("NotChanceNode", format!("{:?} is not a chance node", line)));
    }
    let canonical_line = lines::line_of(game, chips_per_bb)?;
    let history: Vec<usize> = game.history().to_vec();
    let mask = game.possible_cards();
    let inv_bb = 1.0 / chips_per_bb as f32;

    let mut cards = Vec::new();
    for c in 0u8..52 {
        if mask & (1u64 << c) == 0 {
            continue;
        }
        game.play(c as usize);
        game.cache_normalized_weights();
        let ev_oop = compute_average(&game.expected_values(0), game.normalized_weights(0)) * inv_bb;
        let ev_ip = compute_average(&game.expected_values(1), game.normalized_weights(1)) * inv_bb;
        let eq_oop = compute_average(&game.equity(0), game.normalized_weights(0));
        // 카드가 깔린 뒤 첫 플레이어의 레인지 가중 평균 전략 (액션별).
        let strategy_root = if game.is_terminal_node() || game.is_chance_node() {
            Vec::new()
        } else {
            let p = game.current_player();
            let hands = game.private_cards(p).len();
            let s = game.strategy();
            let w = game.normalized_weights(p);
            (0..s.len() / hands.max(1))
                .map(|a| compute_average(&s[a * hands..(a + 1) * hands], w))
                .collect()
        };
        cards.push(json!({
            "card": card_to_string(c).map_err(RpcError::from)?,
            "evOop": ev_oop,
            "evIp": ev_ip,
            "equityOop": eq_oop,
            "strategyRoot": strategy_root,
        }));
        game.apply_history(&history);
    }
    // `board` 는 **그 chance 노드의 보드** 다 (아직 카드가 깔리기 전). 라인이 턴 카드를
    // 이미 지났다면 4장이다 — 호출자가 시작 보드로 되돌려 쓰면 딜된 카드가 사라진다
    // (P4 R1 MAJOR 1).
    game.apply_history(&history);
    let board = board_string(game)?;
    Ok(json!({ "line": canonical_line, "board": board, "cards": cards }))
}
