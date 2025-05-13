use anchor_lang::prelude::*;

pub mod state;
pub mod instructions;

pub use instructions::*;

declare_id!("EuPnp5xmATyeaX6hNNESRnsStztj4FkfEMKVqUs5XetR");

#[program]
pub mod easy_amm {
    use instructions::InitializeSwap;

    use super::*;

    pub fn initialize_swap(ctx: Context<InitializeSwap>) -> Result<()> {
        ctx.accounts.process()
    }
}
