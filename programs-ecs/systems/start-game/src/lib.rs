use bolt_lang::*;
use game_config::GameConfig;

declare_id!("2zKVpP5ovwYVfcTtEj1n4sRWdBoRcDKVk8AbzEAo8B8k");

#[system]
pub mod start_game {
    /// Called after lobby_end. Transitions game from Waiting → Playing.
    /// Reads Pyth price from remaining_accounts[0] to set last_price.
    /// Sets light = green, status = 1 (Playing).
    ///
    /// remaining_accounts[0] = Pyth price PDA (SOL/USD)
    ///
    /// TODO (Emile):
    /// 1. require!(status == 0, "Game not in Waiting")
    /// 2. require!(Clock::get()?.unix_timestamp >= lobby_end, "Lobby not over")
    /// 3. Read Pyth price from remaining_accounts[0] at offset 73
    /// 4. Set status = 1, light = 0, last_price = price, last_check_time = now
    pub fn execute(ctx: Context<Components>, _args: Vec<u8>) -> Result<Components> {
        Ok(ctx.accounts)
    }

    #[system_input]
    pub struct Components {
        pub game_config: GameConfig,
    }
}
