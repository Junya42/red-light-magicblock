use bolt_lang::*;
use game_config::GameConfig;
use shared::{GameError, read_pyth_price};

declare_id!("2zKVpP5ovwYVfcTtEj1n4sRWdBoRcDKVk8AbzEAo8B8k");

#[system]
pub mod start_game {
    /// Called after lobby_end. Transitions game from Waiting → Playing.
    /// Reads Pyth price from remaining_accounts[0] to set last_price.
    ///
    ///
    /// 3. Read Pyth price from remaining_accounts[0] at offset 73
    pub fn execute(ctx: Context<Components>, _args: Vec<u8>) -> Result<Components> 
    {
        require!(ctx.accounts.game_config.status == 0, GameError::GameNotWaiting);
        require!(Clock::get()?.unix_timestamp >= ctx.accounts.game_config.lobby_end, GameError::LobbyNotOver);

        ctx.accounts.game_config.status = 1; // Playing
        ctx.accounts.game_config.light = 0; // Green
        ctx.accounts.game_config.last_price = read_pyth_price(&ctx.remaining_accounts[0])?;
        ctx.accounts.game_config.last_check_time = Clock::get()?.unix_timestamp;

        Ok(ctx.accounts)
    }

    #[system_input]
    pub struct Components {
        pub game_config: GameConfig,
    }
}
