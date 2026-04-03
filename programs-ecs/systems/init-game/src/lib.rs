use bolt_lang::*;
use game_config::GameConfig;

declare_id!("2ta7fTqSgTZ59Tr1WcdjUjgVL3uMyjtGed2jE3Eqfv6x");

#[system]
pub mod init_game {
    /// Init the game — set status Playing, green light, start_time, field dimensions.
    /// TODO: implement
    pub fn execute(ctx: Context<Components>, _args: Vec<u8>) -> Result<Components> {
        Ok(ctx.accounts)
    }

    #[system_input]
    pub struct Components {
        pub game_config: GameConfig,
    }
}
