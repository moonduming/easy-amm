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

    // 池子初始化
    pub fn initialize_swap(
        ctx: Context<InitializeSwap>,
        trade_fees: u16, 
        withdraw_fees: u16,
        amount_a: u64,
        amount_b: u64,
    ) -> Result<()> {
        ctx.accounts.process(trade_fees, withdraw_fees, amount_a, amount_b, ctx.bumps)
    }

    // 双币提取
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

    // 单币提取
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

    // 存入流动性(双币)
    pub fn deposiit(
        ctx: Context<Deposit>,
        pool_token_amount: u64,
        maximum_token_a_amount: u64,
        maximum_token_b_amount: u64,
    ) -> Result<()> {
        ctx.accounts.process(
            ctx.bumps.swap, 
            pool_token_amount, 
            maximum_token_a_amount, 
            maximum_token_b_amount
        )
    }

    pub fn deposiit_single(
        ctx: Context<DepositSingle>,
        source_token_amount: u64,
        minimum_pool_token_amount: u64
    ) -> Result<()> {
        ctx.accounts.process(
            ctx.bumps.swap, 
            source_token_amount, 
            minimum_pool_token_amount
        )
    }

    pub fn exchange(
        ctx: Context<Exchange>,
        a_to_b: bool,
        amount_in: u64,
        minimum_amount_out: u64
    ) -> Result<()> {
        ctx.accounts.process(
            ctx.bumps.swap, 
            a_to_b, 
            amount_in, 
            minimum_amount_out
        )
    }
}
