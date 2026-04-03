use bolt_lang::*;

declare_id!("G3RuJgA65dgqXJdPDsiZVUbiFC6LX8Grz8wBNiRxoe5H");

pub const MAX_PLAYERS: usize = 10;

#[component(delegate)]
pub struct PlayerRegistry {
    pub players: [[u8; 32]; MAX_PLAYERS],
    pub player_states: [[u8; 32]; MAX_PLAYERS],
    pub count: u8,
}

impl Default for PlayerRegistry {
    fn default() -> Self {
        Self {
            players: [[0u8; 32]; MAX_PLAYERS],
            player_states: [[0u8; 32]; MAX_PLAYERS],
            count: 0,
            bolt_metadata: BoltMetadata::default(),
        }
    }
}
