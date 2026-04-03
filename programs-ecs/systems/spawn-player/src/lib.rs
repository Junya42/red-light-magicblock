use bolt_lang::*;
use game_config::GameConfig;
use position::Position;
use player_state::PlayerState;
use player_registry::PlayerRegistry;

declare_id!("5kurbimAJh3B9VB4wNC99JZan6pdo6nDGfZD6tbmw4mi");

#[system]
pub mod spawn_player {
    /// Spawn a player at the bottom of the field.
    /// Set position, alive=true, register in PlayerRegistry.
    /// TODO: implement
    pub fn execute(ctx: Context<Components>, _args: Vec<u8>) -> Result<Components> {
        Ok(ctx.accounts)
    }

    #[system_input]
    pub struct Components {
        pub position: Position,
        pub player_state: PlayerState,
        pub game_config: GameConfig,
        pub player_registry: PlayerRegistry,
    }
}
