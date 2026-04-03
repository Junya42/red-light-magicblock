use bolt_lang::*;
use game_config::GameConfig;
use player_state::PlayerState;
use shared::{GameError, parse_json_u64};

declare_id!("B41Kov8d1moDABp8RdSTRauZUNpwuNwvc312erhWF7w1");

const MAX_STEP: u8 = 5; // max movement per tx

#[system]
pub mod move_player {
    pub fn execute(ctx: Context<Components>, _args: Vec<u8>) -> Result<Components> {
        require!(ctx.accounts.game_config.status == 1, GameError::GameNotPlaying);
        require!(ctx.accounts.player_state.alive, GameError::PlayerDead);
        require!(!ctx.accounts.player_state.finished, GameError::PlayerFinished);

        let step = parse_json_u64(&_args, b"move") as u8;
        require!(step > 0 && step <= MAX_STEP, GameError::InvalidMove);

        let now = Clock::get()?.unix_timestamp;
        let is_red = ctx.accounts.game_config.light == 1
            && now < ctx.accounts.game_config.red_until;

        if is_red {
            // Moved during red light → eliminated
            ctx.accounts.player_state.alive = false;
        } else {
            // Green light → advance
            let new_y = ctx.accounts.player_state.y.saturating_add(step);
            ctx.accounts.player_state.y = new_y.min(100);

            // Win check
            if ctx.accounts.player_state.y >= 100 {
                ctx.accounts.player_state.finished = true;
                ctx.accounts.player_state.finish_time = now;
            }
        }

        Ok(ctx.accounts)
    }

    #[system_input]
    pub struct Components {
        pub player_state: PlayerState,
        pub game_config: GameConfig,
    }
}
