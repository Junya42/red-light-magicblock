use bolt_lang::*;
use game_config::GameConfig;
use shared::GameError;

declare_id!("9xmJrU5Z7HqT5kaK8kAmHJyQ691PnYHH4bEL9NtEDEGx");

const GAME_DURATION: i64 = 150; // 2min30

#[system]
pub mod end_game {
    pub fn execute(ctx: Context<Components>, _args: Vec<u8>) -> Result<Components> {
        require!(ctx.accounts.game_config.status == 1, GameError::GameNotPlaying);

        let now = Clock::get()?.unix_timestamp;
        // Game playing starts at lobby_end, so end = lobby_end + GAME_DURATION
        require!(now >= ctx.accounts.game_config.lobby_end + GAME_DURATION, GameError::LobbyNotOver);

        ctx.accounts.game_config.status = 2; // Finished

        Ok(ctx.accounts)
    }

    #[system_input]
    pub struct Components {
        pub game_config: GameConfig,
    }
}
