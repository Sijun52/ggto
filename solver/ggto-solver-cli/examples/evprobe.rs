//! P4.md 3.5 — `expected_values()` 의 **기준점**을 내부 노드에서 확정한다.
//!
//! 스파이크(`docs/spikes/P4-rust.md` 4절)는 **루트에서만** `Σ ev = starting_pot` 을 확인했다.
//! 루트에서는 "노드 이후 스택 변화"와 "루트 이후 스택 변화"가 같은 값이라 두 가설이
//! 구분되지 않는다. 여기서는 OOP 가 벳한 **뒤의** IP 노드로 내려가서 잰다:
//!
//! - `Σ_players ev = 그 노드의 팟` → **노드 기준** (P3.md 3.3 과 동일, 변환은 `/chipsPerBb` 뿐)
//! - `Σ_players ev = starting_pot`  → **루트 기준** (변환에 "노드 이전 히어로 투입분" 오프셋이 붙는다)
//!
//! `cargo run --release --example evprobe` 로 직접 재현할 수 있다.

use postflop_solver::*;

fn avg(game: &PostFlopGame, player: usize) -> f32 {
    compute_average(&game.expected_values(player), game.normalized_weights(player))
}

/// 그 노드의 팟 = starting_pot + 두 플레이어가 그때까지 넣은 칩의 합.
fn node_pot(game: &PostFlopGame) -> i32 {
    let bets = game.total_bet_amount();
    game.tree_config().starting_pot + bets[0] + bets[1]
}

fn report(game: &mut PostFlopGame, label: &str, starting_pot: i32) {
    game.cache_normalized_weights();
    let (a, b) = (avg(game, 0), avg(game, 1));
    let pot = node_pot(game);
    let bets = game.total_bet_amount();
    println!(
        "{:<28} bets={:?} node_pot={:<5} ev0={:<10.4} ev1={:<10.4} SUM={:<10.4}  vs node_pot {:+.4}  vs starting_pot {:+.4}",
        label,
        bets,
        pot,
        a,
        b,
        a + b,
        (a + b) - pot as f32,
        (a + b) - starting_pot as f32,
    );
}

fn main() {
    // 스파이크와 같은 스팟 (turn, starting_pot 200, effective_stack 900).
    let card_config = CardConfig {
        range: [
            "66+,A8s+,A5s-A4s,AJo+,K9s+,KQo,QTs+,JTs,96s+,85s+,75s+,65s,54s".parse().unwrap(),
            "QQ-22,AQs-A2s,ATo+,K5s+,KJo+,Q8s+,J8s+,T7s+,96s+,86s+,75s+,64s+,53s+".parse().unwrap(),
        ],
        flop: flop_from_str("Td9d6h").unwrap(),
        turn: card_from_str("Qc").unwrap(),
        river: NOT_DEALT,
    };
    let bet_sizes = BetSizeOptions::try_from(("75%", "2.5x")).unwrap();
    let starting_pot = 200;
    let tree_config = TreeConfig {
        initial_state: BoardState::Turn,
        starting_pot,
        effective_stack: 900,
        rake_rate: 0.0,
        rake_cap: 0.0,
        flop_bet_sizes: [bet_sizes.clone(), bet_sizes.clone()],
        turn_bet_sizes: [bet_sizes.clone(), bet_sizes.clone()],
        river_bet_sizes: [bet_sizes.clone(), bet_sizes],
        turn_donk_sizes: None,
        river_donk_sizes: None,
        add_allin_threshold: 1.5,
        force_allin_threshold: 0.15,
        merging_threshold: 0.1,
    };

    let action_tree = ActionTree::new(tree_config).unwrap();
    let mut game = PostFlopGame::with_config(card_config, action_tree).unwrap();
    game.allocate_memory(false);
    let expl = solve(&mut game, 1000, starting_pot as f32 * 0.005, false);
    println!("exploitability = {:.6} ({:.4}% pot)\n", expl, 100.0 * expl / starting_pot as f32);

    // 1. 루트 (스파이크가 잰 지점 — 두 가설이 같은 값을 준다)
    game.back_to_root();
    report(&mut game, "root", starting_pot);

    // 2. OOP 가 벳한 뒤의 IP 노드 — 여기서 두 가설이 갈린다.
    game.back_to_root();
    let actions = game.available_actions();
    println!("root actions: {:?}", actions);
    let bet_idx = actions
        .iter()
        .position(|a| matches!(a, Action::Bet(_)))
        .expect("root must have a bet action");
    let bet_amount = match actions[bet_idx] {
        Action::Bet(n) => n,
        _ => unreachable!(),
    };
    game.play(bet_idx);
    report(&mut game, &format!("root -> OOP Bet({})", bet_amount), starting_pot);

    // 3. 더 깊은 내부 노드: IP 레이즈 뒤의 OOP 노드 (있으면), 없으면 IP 콜 뒤의 리버 chance.
    let ip_actions = game.available_actions();
    println!("ip actions: {:?}", ip_actions);
    if let Some(raise_idx) = ip_actions.iter().position(|a| matches!(a, Action::Raise(_))) {
        let amount = match ip_actions[raise_idx] {
            Action::Raise(n) => n,
            _ => unreachable!(),
        };
        game.play(raise_idx);
        report(&mut game, &format!("  -> IP Raise({})", amount), starting_pot);
    }

    // 4. 콜 뒤 리버 chance 노드에서 카드 하나를 깔고 한 번 더.
    game.back_to_root();
    game.play(bet_idx);
    let call_idx = game
        .available_actions()
        .iter()
        .position(|a| matches!(a, Action::Call))
        .expect("IP must be able to call");
    game.play(call_idx);
    report(&mut game, "  -> IP Call (river chance)", starting_pot);
    let card = game.possible_cards().trailing_zeros() as usize;
    game.play(card);
    report(&mut game, &format!("    -> river {}", card_to_string(card as u8).unwrap()), starting_pot);
}
