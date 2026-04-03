use bolt_lang::*;

declare_id!("3pXqzoU9T4uQzVTv1gZJrPNe59qFKy2GP4353JK22Swu");

#[component(delegate)]
#[derive(Default)]
pub struct PlayerState {
    pub authority: Pubkey,
    pub alive: bool,
    /// Player reached finish line
    pub finished: bool,
    /// Timestamp when player finished (for leaderboard)
    pub finish_time: i64,
}
