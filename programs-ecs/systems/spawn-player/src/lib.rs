use bolt_lang::*;
use game_config::GameConfig;
use player_state::PlayerState;
use player_registry::PlayerRegistry;
use shared::{parse_json_str, GameError};

declare_id!("5kurbimAJh3B9VB4wNC99JZan6pdo6nDGfZD6tbmw4mi");

#[system]
pub mod spawn_player {
    pub fn execute(ctx: Context<Components>, _args: Vec<u8>) -> Result<Components> {
        require!(ctx.accounts.game_config.status == 0, GameError::GameNotWaiting);
        let active = ctx.accounts.game_config.active_players as usize;
        require!(active < 10, GameError::TooManyPlayers);

        // Parse name
        let name_bytes = parse_json_str(&_args, b"name");
        let len = name_bytes.len().min(16);
        ctx.accounts.player_state.name[..len].copy_from_slice(&name_bytes[..len]);
        ctx.accounts.player_state.name_len = len as u8;

        // Init player — y=0 (bottom), goes up to 100 (finish)
        ctx.accounts.player_state.alive = true;
        ctx.accounts.player_state.finished = false;
        ctx.accounts.player_state.finish_time = 0;
        ctx.accounts.player_state.y = 0;

        // Register in player_registry
        let state_bytes = ctx.accounts.player_state.key().to_bytes();
        ctx.accounts.player_registry.player_states[active] = state_bytes;
        ctx.accounts.player_registry.count += 1;
        ctx.accounts.game_config.active_players += 1;

        Ok(ctx.accounts)
    }

    #[system_input]
    pub struct Components {
        pub player_state: PlayerState,
        pub game_config: GameConfig,
        pub player_registry: PlayerRegistry,
    }
}
