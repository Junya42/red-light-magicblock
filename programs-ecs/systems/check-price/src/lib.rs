use bolt_lang::*;
use game_config::GameConfig;

declare_id!("14aiGdhHAwHjMCJb8F4agsa4NNWdyZCBQjvBcX3Fib6K");

/// Pyth Lazer price sits at byte offset 73, uint64 LE, 8 decimals
/// remaining_accounts[0] = Pyth price PDA
/// PDA seeds: ["price_feed", "pyth-lazer", "6"] with program PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd

#[system]
pub mod check_price {
    /// Read Pyth Lazer SOL/USD from remaining_accounts[0].
    /// Compare with last_price:
    ///   - price dropped → light = 1 (red), red_until = now + RED_DURATION
    ///   - price same or up → light = 0 (green)
    /// Update last_price and last_check_time.
    /// Cooldown: only check if elapsed >= CHECK_COOLDOWN since last check.
    /// TODO: implement
    pub fn execute(ctx: Context<Components>, _args: Vec<u8>) -> Result<Components> {
        Ok(ctx.accounts)
    }

    #[system_input]
    pub struct Components {
        pub game_config: GameConfig,
    }
}
