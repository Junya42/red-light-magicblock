use bolt_lang::*;

// ─── JSON parsers (stack-only, no heap) ───

/// Parse a u64 value from JSON bytes by key name.
pub fn parse_json_u64(json: &[u8], key: &[u8]) -> u64 {
    let mut i = 0;
    while i + key.len() + 3 < json.len() {
        if json[i] == b'"'
            && i + 1 + key.len() + 1 < json.len()
            && &json[i + 1..i + 1 + key.len()] == key
            && json[i + 1 + key.len()] == b'"'
            && json[i + 2 + key.len()] == b':'
        {
            let mut j = i + 3 + key.len();
            while j < json.len() && json[j] == b' ' { j += 1; }
            let mut val: u64 = 0;
            while j < json.len() && json[j].is_ascii_digit() {
                val = val * 10 + (json[j] - b'0') as u64;
                j += 1;
            }
            return val;
        }
        i += 1;
    }
    0
}

/// Parse an i64 value from JSON bytes (supports negative).
pub fn parse_json_i64(json: &[u8], key: &[u8]) -> i64 {
    let mut i = 0;
    while i + key.len() + 3 < json.len() {
        if json[i] == b'"'
            && i + 1 + key.len() + 1 < json.len()
            && &json[i + 1..i + 1 + key.len()] == key
            && json[i + 1 + key.len()] == b'"'
            && json[i + 2 + key.len()] == b':'
        {
            let mut j = i + 3 + key.len();
            while j < json.len() && json[j] == b' ' { j += 1; }
            let neg = j < json.len() && json[j] == b'-';
            if neg { j += 1; }
            let mut val: i64 = 0;
            while j < json.len() && json[j].is_ascii_digit() {
                val = val * 10 + (json[j] - b'0') as i64;
                j += 1;
            }
            return if neg { -val } else { val };
        }
        i += 1;
    }
    0
}

/// Parse a string value from JSON bytes. Returns the bytes between quotes.
pub fn parse_json_str<'a>(json: &'a [u8], key: &[u8]) -> &'a [u8] {
    let mut i = 0;
    while i + key.len() + 4 < json.len() {
        if json[i] == b'"'
            && i + 1 + key.len() + 1 < json.len()
            && &json[i + 1..i + 1 + key.len()] == key
            && json[i + 1 + key.len()] == b'"'
            && json[i + 2 + key.len()] == b':'
        {
            let mut j = i + 3 + key.len();
            while j < json.len() && json[j] == b' ' { j += 1; }
            if j < json.len() && json[j] == b'"' {
                j += 1;
                let start = j;
                while j < json.len() && json[j] != b'"' { j += 1; }
                return &json[start..j];
            }
        }
        i += 1;
    }
    &[]
}

// ─── Errors ───

#[error_code]
pub enum GameError {
    #[msg("Game is not in Waiting state")]
    GameNotWaiting,
    #[msg("Game is not in Playing state")]
    GameNotPlaying,
    #[msg("Too many players")]
    TooManyPlayers,
    #[msg("Player is dead")]
    PlayerDead,
    #[msg("Player already finished")]
    PlayerFinished,
    #[msg("Moved during red light")]
    RedLightViolation,
    #[msg("Lobby not over yet")]
    LobbyNotOver,
    #[msg("Invalid movement")]
    InvalidMove,
}
