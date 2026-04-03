use bolt_lang::*;

declare_id!("3pXqzoU9T4uQzVTv1gZJrPNe59qFKy2GP4353JK22Swu");

#[component(delegate)]
pub struct PlayerState {
    pub authority: Pubkey,
    pub alive: bool,
    pub finished: bool,
    pub finish_time: i64,
    /// Y position (0 = top/finish, 100 = bottom/start)
    pub y: u8,
    /// Player name (max 16 bytes, no heap)
    pub name: [u8; 16],
    /// Actual length of name
    pub name_len: u8,
}

impl Default for PlayerState {
    fn default() -> Self {
        Self {
            authority: Pubkey::default(),
            alive: false,
            finished: false,
            finish_time: 0,
            y: 0,
            name: [0u8; 16],
            name_len: 0,
            bolt_metadata: BoltMetadata::default(),
        }
    }
}
