use bolt_lang::*;
use game_config::GameConfig;

declare_id!("2ta7fTqSgTZ59Tr1WcdjUjgVL3uMyjtGed2jE3Eqfv6x");

const LOBBY_DURATION: i64 = 40; // 40 seconds lobby

#[system]
pub mod init_game {
    /// Create a new game. Status = Waiting, lobby_end = now + 40s.
    /// Players can join during the lobby period via spawn-player.
    /// After lobby_end, anyone can call start-game to begin.
    /// TODO (Emile): implement — set status=0, start_time=now, lobby_end=now+LOBBY_DURATION
    pub fn execute(ctx: Context<Components>, _args: Vec<u8>) -> Result<Components> {
        Ok(ctx.accounts)
    }

    #[system_input]
    pub struct Components {
        pub game_config: GameConfig,
    }
}
