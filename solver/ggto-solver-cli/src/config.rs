//! 와이어 `config` → postflop-solver 의 `CardConfig` / `TreeConfig` (P4.md 3.1 · 5.3).
//!
//! **레인지를 문자열로 받지 않는다.** Node 쪽 `@ggto/core` 가 이미 파싱·카드 제거·정규화를
//! 끝낸 1326 `Float32Array` 를 base64 로 보낸다. 문자열을 다시 파싱하면 두 파서가 서로
//! 다르게 해석할 여지가 생기고 (D11 의 `T9s+` 같은 경우), 캐시 키(해시)는 TS 쪽 배열에서
//! 나오므로 **해시와 실제 계산이 갈라진다**.

use crate::b64;
use crate::proto::RpcError;
use postflop_solver::*;
use serde::Deserialize;

/// 1326 콤보 인덱스는 `@ggto/core` 규칙이다: `hi*(hi-1)/2 + lo`, hi > lo (카드 id 기준).
/// postflop-solver 의 `Range` 내부 인덱스(`lo*(101-lo)/2 + hi - 1`)와 **다르므로**
/// 반드시 카드 쌍을 거쳐 변환한다.
pub const COMBO_COUNT: usize = 1326;

pub fn combo_index(a: u8, b: u8) -> usize {
    let (hi, lo) = if a > b { (a as usize, b as usize) } else { (b as usize, a as usize) };
    hi * (hi - 1) / 2 + lo
}

pub fn combo_cards(i: usize) -> (u8, u8) {
    // hi 는 hi*(hi-1)/2 <= i 를 만족하는 최대값. 1326 은 작아서 선형 탐색으로 충분하다.
    let mut hi = 1usize;
    while (hi + 1) * hi / 2 <= i {
        hi += 1;
    }
    (hi as u8, (i - hi * (hi - 1) / 2) as u8)
}

#[derive(Debug, Deserialize)]
pub struct StreetSizings {
    /// postflop-solver `BetSizeOptions` 문법 그대로 (예: `"33%,75%"`)
    pub bet: String,
    /// 예: `"2.5x"`
    pub raise: String,
}

#[derive(Debug, Deserialize)]
pub struct Sizings {
    pub flop: StreetSizings,
    pub turn: StreetSizings,
    pub river: StreetSizings,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rake {
    /// `"none"` | `"pot"`
    pub mode: String,
    #[serde(default)]
    pub pct: f64,
    #[serde(default)]
    pub cap_chips: f64,
}

impl Default for Rake {
    fn default() -> Self {
        Self { mode: "none".to_string(), pct: 0.0, cap_chips: 0.0 }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireConfig {
    /// 정규 보드. 3~5장 붙여쓰기 (`"2h7hKs"`)
    pub board: String,
    /// base64 f32[1326], `@ggto/core` 콤보 인덱스 순서
    pub oop: String,
    pub ip: String,
    pub pot_chips: i32,
    pub stack_chips: i32,
    /// bb 당 칩. 고정 100 이지만 EV 변환에 필요하므로 명시로 받는다.
    pub chips_per_bb: i32,
    pub sizings: Sizings,
    #[serde(default)]
    pub rake: Rake,
    #[serde(default)]
    pub compressed: bool,
}

fn parse_board(s: &str) -> Result<Vec<u8>, RpcError> {
    if !s.is_ascii() || s.len() % 2 != 0 {
        return Err(RpcError::bad_request(format!("bad board {:?}", s)));
    }
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let chunk = std::str::from_utf8(&bytes[i..i + 2]).map_err(|e| RpcError::bad_request(e.to_string()))?;
        out.push(card_from_str(chunk).map_err(RpcError::from)?);
        i += 2;
    }
    if out.len() < 3 || out.len() > 5 {
        return Err(RpcError::bad_request(format!("board must be 3..5 cards, got {}", out.len())));
    }
    let mut seen = 0u64;
    for &c in &out {
        if seen & (1 << c) != 0 {
            return Err(RpcError::bad_request(format!("duplicate board card in {:?}", s)));
        }
        seen |= 1 << c;
    }
    Ok(out)
}

fn range_from_weights(b64s: &str, label: &str) -> Result<Range, RpcError> {
    let w = b64::decode_f32(b64s)?;
    if w.len() != COMBO_COUNT {
        return Err(RpcError::bad_request(format!("{} must be {} f32, got {}", label, COMBO_COUNT, w.len())));
    }
    let mut range = Range::new();
    let mut any = false;
    for (i, &weight) in w.iter().enumerate() {
        if !(0.0..=1.0).contains(&weight) || weight.is_nan() {
            return Err(RpcError::bad_request(format!("{}[{}] out of [0,1]: {}", label, i, weight)));
        }
        if weight > 0.0 {
            let (hi, lo) = combo_cards(i);
            range.set_weight_by_cards(hi, lo, weight);
            any = true;
        }
    }
    if !any {
        return Err(RpcError::new("BadRequest", format!("{} range is empty", label)));
    }
    Ok(range)
}

pub struct BuiltConfig {
    pub card: CardConfig,
    pub tree: TreeConfig,
    pub chips_per_bb: i32,
    pub compressed: bool,
}

pub fn build(cfg: &WireConfig) -> Result<BuiltConfig, RpcError> {
    let board = parse_board(&cfg.board)?;
    let (initial_state, turn, river) = match board.len() {
        3 => (BoardState::Flop, NOT_DEALT, NOT_DEALT),
        4 => (BoardState::Turn, board[3], NOT_DEALT),
        _ => (BoardState::River, board[3], board[4]),
    };
    if cfg.pot_chips <= 0 || cfg.stack_chips <= 0 {
        return Err(RpcError::bad_request("potChips and stackChips must be positive"));
    }
    if cfg.chips_per_bb <= 0 {
        return Err(RpcError::bad_request("chipsPerBb must be positive"));
    }

    let card = CardConfig {
        range: [range_from_weights(&cfg.oop, "oop")?, range_from_weights(&cfg.ip, "ip")?],
        flop: [board[0], board[1], board[2]],
        turn,
        river,
    };

    let mk = |s: &StreetSizings| -> Result<BetSizeOptions, RpcError> {
        BetSizeOptions::try_from((s.bet.as_str(), s.raise.as_str())).map_err(RpcError::from)
    };
    let flop = mk(&cfg.sizings.flop)?;
    let turn_s = mk(&cfg.sizings.turn)?;
    let river_s = mk(&cfg.sizings.river)?;

    let (rake_rate, rake_cap) = if cfg.rake.mode == "pot" {
        (cfg.rake.pct / 100.0, cfg.rake.cap_chips)
    } else {
        (0.0, 0.0)
    };

    let tree = TreeConfig {
        initial_state,
        starting_pot: cfg.pot_chips,
        effective_stack: cfg.stack_chips,
        rake_rate,
        rake_cap,
        flop_bet_sizes: [flop.clone(), flop],
        turn_bet_sizes: [turn_s.clone(), turn_s],
        river_bet_sizes: [river_s.clone(), river_s],
        turn_donk_sizes: None,
        river_donk_sizes: None,
        // postflop-solver 기본값 (P4.md 3.2 "올인 임계 1.5").
        add_allin_threshold: 1.5,
        force_allin_threshold: 0.15,
        merging_threshold: 0.1,
    };

    Ok(BuiltConfig { card, tree, chips_per_bb: cfg.chips_per_bb, compressed: cfg.compressed })
}

/// 액션 트리의 노드 수 (chance 는 카드별로 펼치지 않는다 — 베팅 라인 노드만).
/// `estSeconds` 추정과 로그용이다. 상류에 공개 카운터가 없어 직접 센다 (수백~수천 노드).
pub fn count_tree_nodes(tree_config: TreeConfig) -> Result<u64, RpcError> {
    let mut tree = ActionTree::new(tree_config).map_err(RpcError::from)?;
    fn walk(t: &mut ActionTree) -> u64 {
        if t.is_terminal_node() {
            return 1;
        }
        let actions: Vec<Action> = t.available_actions().to_vec();
        let mut n = 1;
        for a in actions {
            if t.play(a).is_ok() {
                n += walk(t);
                let _ = t.undo();
            }
        }
        n
    }
    Ok(walk(&mut tree))
}
