use bolt_lang::*;
use game_config::GameConfig;
use player_state::PlayerState;
use player_registry::PlayerRegistry;

declare_id!("5kurbimAJh3B9VB4wNC99JZan6pdo6nDGfZD6tbmw4mi");

#[system]
pub mod spawn_player {
    /// Spawn a player at y=100 (bottom).
    /// Set alive=true, finished=false, register in PlayerRegistry.
    /// TODO: implement
    pub fn execute(ctx: Context<Components>, _args: Vec<u8>) -> Result<Components> 
    {
        require!(ctx.accounts.game_config.status == 0, ErrorCode::GameNotWaiting);
        require!(ctx.accounts.game_config.player_active < 10, ErrorCode::TooManyPlayers);

        let name_bytes = parse_json_string(&_args, b"name");
        let len = name_bytes.len().min(16);                                              
        ctx.accounts.player_state.name[..len].copy_from_slice(&name_bytes[..len]);       
        ctx.accounts.player_state.name_len = len as u8;     

        
        ctx

        Ok(ctx.accounts)
    }

    #[system_input]
    pub struct Components {
        pub player_state: PlayerState,
        pub game_config: GameConfig,
        pub player_registry: PlayerRegistry,
    }
}
