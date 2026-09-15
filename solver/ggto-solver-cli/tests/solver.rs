//! P4.md 8.2 — 크레이트 테스트. `cargo test --locked` (= `npm run test:solver` 의 앞쪽).
//!
//! 기댓값은 구현 복사가 아니라 **외부에서 알 수 있는 값**이다: 팟 대비 exploitability,
//! 전략 행 합 = 1, 콤보 수 1326, 런아웃 49/48, `Σ ev = 노드의 팟`.

use ggto_solver_cli::config::{self, COMBO_COUNT};
use ggto_solver_cli::{b64, lines, nodes};
use postflop_solver::*;

const CHIPS_PER_BB: i32 = 100;
const POT: i32 = 2000;
const STACK: i32 = 8000;

fn card(s: &str) -> u8 {
    card_from_str(s).unwrap()
}

fn board_cards(board: &str) -> Vec<u8> {
    board
        .as_bytes()
        .chunks(2)
        .map(|c| card(std::str::from_utf8(c).unwrap()))
        .collect()
}

/// 작은 턴 스팟. 이 PC(RAM 16GB)에서 테스트가 메모리를 먹지 않도록 레인지를 좁게 잡는다.
fn wire_config(board: &str) -> serde_json::Value {
    let mut oop = vec![0.0f32; COMBO_COUNT];
    let mut ip = vec![0.0f32; COMBO_COUNT];
    let dead_cards = board_cards(board);
    let dead = |a: u8, b: u8| dead_cards.contains(&a) || dead_cards.contains(&b);
    // OOP = 브로드웨이 포켓, IP = 미들 포켓. 둘 다 포켓이라 콤보가 적다.
    for rank in 8..13u8 {
        for s1 in 0..4u8 {
            for s2 in (s1 + 1)..4u8 {
                let (a, b) = (rank * 4 + s1, rank * 4 + s2);
                if !dead(a, b) {
                    oop[config::combo_index(a, b)] = 1.0;
                }
            }
        }
    }
    for rank in 3..8u8 {
        for s1 in 0..4u8 {
            for s2 in (s1 + 1)..4u8 {
                let (a, b) = (rank * 4 + s1, rank * 4 + s2);
                if !dead(a, b) {
                    ip[config::combo_index(a, b)] = 1.0;
                }
            }
        }
    }
    serde_json::json!({
        "board": board,
        "oop": b64::encode_f32(&oop),
        "ip": b64::encode_f32(&ip),
        "potChips": POT,
        "stackChips": STACK,
        "chipsPerBb": CHIPS_PER_BB,
        "sizings": {
            "flop":  { "bet": "33%,75%", "raise": "2.5x" },
            "turn":  { "bet": "75%", "raise": "2.5x" },
            "river": { "bet": "75%", "raise": "2.5x" },
        },
        "rake": { "mode": "none" },
        "compressed": false,
    })
}

fn build(board: &str) -> config::BuiltConfig {
    config::build(&serde_json::from_value(wire_config(board)).unwrap()).unwrap()
}

fn solved(board: &str, iters: u32) -> (PostFlopGame, f32) {
    let built = build(board);
    let tree = ActionTree::new(built.tree.clone()).unwrap();
    let mut game = PostFlopGame::with_config(built.card, tree).unwrap();
    game.allocate_memory(false);
    let target = POT as f32 * 0.005;
    let expl = solve(&mut game, iters, target, false);
    (game, expl)
}

// --- P4.md 8.2: 프로토콜 왕복 ------------------------------------------------

#[test]
fn p4_8_2_estimate_result_has_the_documented_fields() {
    let v = ggto_solver_cli::solve::estimate(serde_json::json!({ "config": wire_config("Ks7h2hQc") })).unwrap();
    // 5.3 표의 필드명을 그대로 단언한다 (스냅샷이 아니라 이름 단언 — 오타가 통과하면 안 된다).
    for key in ["nodes", "memoryBytes", "memoryBytesCompressed", "estSeconds"] {
        assert!(v.get(key).is_some(), "estimate result is missing {:?}: {}", key, v);
    }
    assert!(v["memoryBytes"].as_u64().unwrap() > v["memoryBytesCompressed"].as_u64().unwrap());
    assert!(v["nodes"].as_u64().unwrap() > 1);
}

#[test]
fn p4_8_2_bad_params_are_errors_not_panics() {
    let e = ggto_solver_cli::solve::estimate(serde_json::json!({})).unwrap_err();
    assert_eq!(e.code, "BadRequest");
    let mut cfg = wire_config("Ks7h2hQc");
    cfg["board"] = serde_json::json!("KsKs2h");
    let e = ggto_solver_cli::solve::estimate(serde_json::json!({ "config": cfg })).unwrap_err();
    assert_eq!(e.code, "BadRequest");
    assert!(e.message.contains("duplicate"), "{}", e.message);
}

#[test]
fn p4_8_2_estimate_does_not_allocate_solver_memory() {
    // 트리만 빌드하고 할당하지 않는다. `memory_usage()` 가 MB 단위를 보고해도
    // `is_memory_allocated()` 는 None 이어야 한다 — 이 판정이 8GB 게이트의 전제다.
    let built = build("Ks7h2hQc");
    let tree = ActionTree::new(built.tree).unwrap();
    let game = PostFlopGame::with_config(built.card, tree).unwrap();
    assert_eq!(game.is_memory_allocated(), None);
    assert!(game.memory_usage().0 > 0);
}

// --- P4.md 8.2 / 3.5: EV 기준점 ---------------------------------------------

#[test]
fn p4_3_5_ev_sum_equals_the_pot_of_that_node_at_internal_nodes() {
    let (mut game, _) = solved("Ks7h2hQc", 400);

    // 후보 히스토리: 루트 + 여러 내부 노드. 인덱스가 아니라 **액션 종류**로 찾는다.
    let mut probes: Vec<Vec<usize>> = vec![vec![]];
    game.back_to_root();
    let find = |g: &PostFlopGame, want: fn(&Action) -> bool| {
        g.available_actions().iter().position(want)
    };
    let bet = find(&game, |a| matches!(a, Action::Bet(_))).expect("root must offer a bet");
    let check = find(&game, |a| matches!(a, Action::Check));
    probes.push(vec![bet]);
    if let Some(x) = check {
        probes.push(vec![x]);
        game.play(x);
        if let Some(b2) = find(&game, |a| matches!(a, Action::Bet(_))) {
            probes.push(vec![x, b2]);
        }
        game.back_to_root();
    }
    game.play(bet);
    let call = find(&game, |a| matches!(a, Action::Call)).expect("IP must be able to call");
    probes.push(vec![bet, call]);
    if let Some(raise) = find(&game, |a| matches!(a, Action::Raise(_))) {
        probes.push(vec![bet, raise]);
    }
    // 콜 뒤는 리버 chance 노드다. 카드를 한 장 깔고 그 노드에서도 잰다.
    game.play(call);
    if game.is_chance_node() {
        let card = game.possible_cards().trailing_zeros() as usize;
        probes.push(vec![bet, call, card]);
    }

    let root_pot_bb = POT as f32 / CHIPS_PER_BB as f32;
    let mut verified_internal = 0;
    for history in &probes {
        game.apply_history(history);
        game.cache_normalized_weights();
        // 도달 질량이 0 인 노드(그 라인을 아무도 안 쓴다)는 평균이 0/0 이라 판정 불능이다.
        // 조용히 통과시키지 않고 **세지 않는다** — 아래에서 유효 내부 노드 수를 단언한다.
        let reached: f32 = (0..2)
            .map(|p| game.normalized_weights(p).iter().sum::<f32>())
            .fold(f32::INFINITY, f32::min);
        if !(reached > 0.0) {
            continue;
        }
        let (sum_bb, pot_bb) = nodes::ev_sum_bb(&mut game, CHIPS_PER_BB);
        assert!(
            (sum_bb - pot_bb).abs() <= 1e-3 * pot_bb,
            "history {:?}: sum ev = {} bb but the node pot is {} bb (root pot {} bb)",
            history,
            sum_bb,
            pot_bb,
            root_pot_bb
        );
        if !history.is_empty() {
            // 팟이 커진 내부 노드에서만 두 가설이 갈린다 (P4.md 3.5 의 핵심).
            if pot_bb > root_pot_bb {
                verified_internal += 1;
                assert!(
                    (sum_bb - root_pot_bb).abs() > 1e-3 * pot_bb,
                    "history {:?}: sum ev equals the ROOT pot -> root basis, not node basis",
                    history
                );
            }
        }
    }
    assert!(
        verified_internal >= 3,
        "only {} internal nodes with a bigger pot were reachable; the probe proves nothing",
        verified_internal
    );
}

// --- P4.md 8.2: node 응답 -----------------------------------------------------

fn decode_rows(s: &str, rows: usize) -> Vec<Vec<f32>> {
    let flat = b64::decode_f32(s).unwrap();
    assert_eq!(flat.len(), rows * COMBO_COUNT);
    flat.chunks(COMBO_COUNT).map(<[f32]>::to_vec).collect()
}

#[test]
fn p4_8_2_node_strategy_rows_sum_to_one_and_board_blockers_have_zero_reach() {
    let board = "Ks7h2hQc";
    let (mut game, _) = solved(board, 300);
    let v = nodes::node_response(&mut game, "", CHIPS_PER_BB).unwrap();
    assert_eq!(v["evBasis"], "stack_delta_from_node");
    assert_eq!(v["street"], "turn");
    assert_eq!(v["board"], board);
    assert_eq!(v["player"], "oop");
    assert_eq!(v["potChips"], POT);
    assert_eq!(v["stacksChips"], serde_json::json!([STACK, STACK]));

    let actions = v["actions"].as_array().unwrap().len();
    let strategy = decode_rows(v["strategy"].as_str().unwrap(), actions);
    let _ev = decode_rows(v["ev"].as_str().unwrap(), actions);
    let reach: Vec<f32> = b64::decode_f32(v["reach"][0].as_str().unwrap()).unwrap();
    assert_eq!(reach.len(), COMBO_COUNT);

    let mut checked = 0;
    for combo in 0..COMBO_COUNT {
        if reach[combo] <= 0.0 {
            continue;
        }
        let total: f32 = strategy.iter().map(|row| row[combo]).sum();
        assert!((total - 1.0).abs() < 1e-5, "combo {} strategy sums to {}", combo, total);
        checked += 1;
    }
    assert!(checked > 20, "only {} combos had reach > 0", checked);

    // 보드와 충돌하는 콤보는 도달 0 이다 (양쪽 플레이어 모두).
    let dead = board_cards(board);
    for player in 0..2 {
        let r: Vec<f32> = b64::decode_f32(v["reach"][player].as_str().unwrap()).unwrap();
        for combo in 0..COMBO_COUNT {
            let (hi, lo) = config::combo_cards(combo);
            if dead.contains(&hi) || dead.contains(&lo) {
                assert_eq!(r[combo], 0.0, "player {} combo {} blocks the board but has reach", player, combo);
            }
        }
    }
}

#[test]
fn p4_8_2_line_round_trips_and_unknown_lines_are_no_such_line() {
    let (mut game, _) = solved("Ks7h2hQc", 100);
    let root = nodes::node_response(&mut game, "", CHIPS_PER_BB).unwrap();
    assert_eq!(root["line"], "");
    let bet = root["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t.as_str().unwrap().starts_with('B'))
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();
    let child = nodes::node_response(&mut game, &bet, CHIPS_PER_BB).unwrap();
    assert_eq!(child["line"], bet);
    assert_eq!(child["player"], "ip");
    // 팟은 그 벳만큼 커진다. 토큰은 bb 단위이므로 칩으로 되돌려 비교한다.
    let bet_bb: f64 = bet[1..].parse().unwrap();
    assert_eq!(
        child["potChips"].as_i64().unwrap(),
        POT as i64 + (bet_bb * CHIPS_PER_BB as f64) as i64
    );

    let e = nodes::node_response(&mut game, "B999", CHIPS_PER_BB).unwrap_err();
    assert_eq!(e.code, "NoSuchLine");
    let e = nodes::node_response(&mut game, "b33.c", CHIPS_PER_BB).unwrap_err();
    assert_eq!(e.code, "NoSuchLine", "lowercase/dot form must not be accepted (D3)");
}

// --- P4.md 8.2: runouts -------------------------------------------------------

#[test]
fn p4_8_2_runouts_lists_49_turn_cards_excluding_the_board() {
    let (mut game, _) = solved("Ks7h2h", 100);
    // 플랍 X-X 뒤가 chance(턴) 노드다.
    let v = nodes::runouts_response(&mut game, "X-X", CHIPS_PER_BB).unwrap();
    let cards = v["cards"].as_array().unwrap();
    assert_eq!(cards.len(), 49, "turn runouts must be 52 - 3 board cards");
    let names: Vec<String> = cards
        .iter()
        .map(|c| c["card"].as_str().unwrap().to_string())
        .collect();
    for b in ["Ks", "7h", "2h"] {
        assert!(!names.contains(&b.to_string()), "{} is on the board", b);
    }
    let mut sorted = names.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), 49);
    for c in cards {
        let sum = c["evOop"].as_f64().unwrap() + c["evIp"].as_f64().unwrap();
        assert!(
            (sum - POT as f64 / CHIPS_PER_BB as f64).abs() < 0.01,
            "card {}: sum ev = {}",
            c["card"],
            sum
        );
    }

    let e = nodes::runouts_response(&mut game, "", CHIPS_PER_BB).unwrap_err();
    assert_eq!(e.code, "NotChanceNode");
}

// --- P4.md 8.2: 단위 -----------------------------------------------------------

#[test]
fn p4_8_2_combo_index_matches_core_and_covers_1326() {
    let mut seen = vec![false; COMBO_COUNT];
    for hi in 1u8..52 {
        for lo in 0..hi {
            let i = config::combo_index(hi, lo);
            assert!(!seen[i], "duplicate combo index {}", i);
            seen[i] = true;
            assert_eq!(config::combo_cards(i), (hi, lo));
            assert_eq!(config::combo_index(lo, hi), i, "combo index must be order-free");
        }
    }
    assert!(seen.iter().all(|&b| b), "combo index must cover all 1326 slots");
}

#[test]
fn p4_8_2_amount_formatting_is_canonical_bb() {
    // `@ggto/core` 의 formatAmount 규칙: 후행 0 없음, 최대 2자리.
    assert_eq!(lines::amount_bb(1500, 100), "15");
    assert_eq!(lines::amount_bb(660, 100), "6.6");
    assert_eq!(lines::amount_bb(663, 100), "6.63");
    assert_eq!(lines::amount_bb(100, 100), "1");
    assert_eq!(lines::amount_bb(0, 100), "0");
}

#[test]
fn p4_8_2_base64_f32_round_trips_little_endian() {
    let xs = vec![0.0f32, 1.0, -1.5, f32::MIN_POSITIVE, 1234.5];
    assert_eq!(b64::decode_f32(&b64::encode_f32(&xs)).unwrap(), xs);
    // 1.0f32 LE = 00 00 80 3F -> base64 "AACAPw=="
    assert_eq!(b64::encode_f32(&[1.0]), "AACAPw==");
}
