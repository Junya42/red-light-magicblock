use bolt_lang::*;
use game_config::GameConfig;
use position::Position;
use player_state::PlayerState;

declare_id!("B41Kov8d1moDABp8RdSTRauZUNpwuNwvc312erhWF7w1");

#[system]
pub mod move_player {
    /// Move the player. Parse x,y from args.
    /// If RED LIGHT and player is moving → alive = false (killed).
    /// If GREEN LIGHT → validate movement, update position.
    /// If position.y <= finish_y → finished = true.
    /// TODO: implement
    pub fn execute(ctx: Context<Components>, _args: Vec<u8>) -> Result<Components> {
        Ok(ctx.accounts)
    }

    #[system_input]
    pub struct Components {
        pub position: Position,
        pub player_state: PlayerState,
        pub game_config: GameConfig,
    }
}
