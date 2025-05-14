use anchor_lang::prelude::*;

pub mod state;
pub mod instructions;
pub mod error;

pub use instructions::*;

declare_id!("Ds2VNJ6Ay2JVfGhLedAHAiyUyDTMGW8A8dBXneLdDhBe");

#[program]
pub mod easy_amm {
    use instructions::InitializeSwap;

    use super::*;

    pub fn initialize_swap(
        ctx: Context<InitializeSwap>,
        trade_fees: u16, 
        withdraw_fees: u16,
        amount_a: u64,
        amount_b: u64,
    ) -> Result<()> {
        ctx.accounts.process(trade_fees, withdraw_fees, amount_a, amount_b, ctx.bumps)
    }
}
