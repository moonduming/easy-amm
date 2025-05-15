use anchor_lang::prelude::*;

pub mod state;
pub mod instructions;
pub mod error;
pub mod events;

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

    pub fn withdraw_all(
        ctx: Context<WithdrawAll>,
        token_amount: u64,
        minimum_token_a_amount: u64,
        minimum_token_b_amount: u64,
    ) -> Result<()> {
        ctx.accounts.process(
            token_amount, 
            minimum_token_a_amount, 
            minimum_token_b_amount, 
            ctx.bumps.swap
        )
    }

    pub fn withdraw_single(
        ctx: Context<WithdrawSingle>,
        destination_token_amount: u64,
        maximum_pool_token_amount: u64,
    ) -> Result<()> {
        ctx.accounts.process(
            ctx.bumps.swap, 
            destination_token_amount, 
            maximum_pool_token_amount
        )
    }
}
