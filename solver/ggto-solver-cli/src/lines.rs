//! 노드 경로(`line`) ↔ postflop-solver 히스토리.
//!
//! **문법은 `@ggto/core` 의 액션 문자열을 그대로 쓴다** (D3·D9):
//! ```text
//! line := "" | seg ('/' seg)*
//! seg  := action ('-' action)*  |  card        // card = 턴/리버로 깔린 카드 ("Qc")
//! action := 'F' | 'X' | 'C' | 'A' | 'B'amount | 'R'amount     // amount 단위 = bb
//! ```
//! 구분자가 `.` 이 아니라 `-` 인 이유가 여기서 실제로 필요하다: 금액이 `B6.6` 처럼
//! 소수를 가지므로 `.` 로 쪼개면 토크나이즈가 깨진다 (D3).
//!
//! 올인은 금액 없이 `A` 다 (D10) — `R<stack>` 과 `A` 가 같은 상태를 만들면 캐시 키가 중복된다.

use crate::proto::RpcError;
use postflop_solver::*;

/// 칩 → bb 정규 문자열. `@ggto/core` 의 `formatAmount` 와 같은 규칙: 후행 0 없음, 최대 2자리.
pub fn amount_bb(chips: i32, chips_per_bb: i32) -> String {
    let v = chips as f64 / chips_per_bb as f64;
    let rounded = (v * 100.0).round() / 100.0;
    let mut s = format!("{:.2}", rounded);
    if s.contains('.') {
        while s.ends_with('0') {
            s.pop();
        }
        if s.ends_with('.') {
            s.pop();
        }
    }
    s
}

pub fn action_token(a: Action, chips_per_bb: i32) -> Result<String, RpcError> {
    Ok(match a {
        Action::Fold => "F".to_string(),
        Action::Check => "X".to_string(),
        Action::Call => "C".to_string(),
        Action::AllIn(_) => "A".to_string(),
        Action::Bet(n) => format!("B{}", amount_bb(n, chips_per_bb)),
        Action::Raise(n) => format!("R{}", amount_bb(n, chips_per_bb)),
        Action::Chance(c) => card_to_string(c).map_err(RpcError::from)?,
        Action::None => return Err(RpcError::bad_request("unexpected Action::None in tree")),
    })
}

/// 현재 노드의 액션 토큰들. 두 액션이 같은 토큰이 되면 `line` 이 모호해지므로 **실패시킨다**
/// (조용히 첫 번째를 고르면 사용자가 다른 노드를 보게 된다).
pub fn action_tokens(game: &PostFlopGame, chips_per_bb: i32) -> Result<Vec<String>, RpcError> {
    let mut out = Vec::new();
    for a in game.available_actions() {
        let t = action_token(a, chips_per_bb)?;
        if out.contains(&t) {
            return Err(RpcError::bad_request(format!("ambiguous action token {:?} in tree", t)));
        }
        out.push(t);
    }
    Ok(out)
}

/// `line` 을 히스토리로 바꿔 적용한다. 루트는 빈 문자열.
///
/// `play()` 는 잘못된 인자에 **panic** 하므로 (상류 계약) 여기서 전부 선검증한다 —
/// 데몬이 죽으면 대기 중인 모든 요청이 `DaemonExited` 가 된다.
pub fn apply_line(game: &mut PostFlopGame, line: &str, chips_per_bb: i32) -> Result<(), RpcError> {
    game.back_to_root();
    if line.is_empty() {
        return Ok(());
    }
    for seg in line.split('/') {
        if seg.is_empty() {
            return Err(RpcError::new("NoSuchLine", format!("empty segment in line {:?}", line)));
        }
        if game.is_chance_node() {
            let card = card_from_str(seg)
                .map_err(|_| RpcError::new("NoSuchLine", format!("expected a card segment, got {:?}", seg)))?;
            if game.possible_cards() & (1u64 << card) == 0 {
                return Err(RpcError::new("NoSuchLine", format!("card {:?} cannot be dealt here", seg)));
            }
            game.play(card as usize);
            continue;
        }
        for token in seg.split('-') {
            if game.is_terminal_node() {
                return Err(RpcError::new("NoSuchLine", format!("line continues past a terminal node: {:?}", line)));
            }
            if game.is_chance_node() {
                return Err(RpcError::new(
                    "NoSuchLine",
                    format!("street ended; {:?} must start a new '/' segment", token),
                ));
            }
            let tokens = action_tokens(game, chips_per_bb)?;
            let idx = tokens
                .iter()
                .position(|t| t == token)
                .ok_or_else(|| RpcError::new("NoSuchLine", format!("no action {:?} here (have {:?})", token, tokens)))?;
            game.play(idx);
        }
    }
    Ok(())
}

/// 현재 히스토리를 정규 `line` 문자열로 되돌린다. `apply_line` 과 왕복이어야 한다.
pub fn line_of(game: &mut PostFlopGame, chips_per_bb: i32) -> Result<String, RpcError> {
    let history: Vec<usize> = game.history().to_vec();
    game.back_to_root();
    let mut segs: Vec<String> = Vec::new();
    let mut cur: Vec<String> = Vec::new();
    for &h in &history {
        if game.is_chance_node() {
            if !cur.is_empty() {
                segs.push(cur.join("-"));
                cur.clear();
            }
            segs.push(card_to_string(h as u8).map_err(RpcError::from)?);
        } else {
            let tokens = action_tokens(game, chips_per_bb)?;
            let t = tokens
                .get(h)
                .ok_or_else(|| RpcError::bad_request("history index out of range"))?
                .clone();
            cur.push(t);
        }
        game.play(h);
    }
    if !cur.is_empty() {
        segs.push(cur.join("-"));
    }
    Ok(segs.join("/"))
}
