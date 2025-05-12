use anchor_lang::prelude::*;

declare_id!("EuPnp5xmATyeaX6hNNESRnsStztj4FkfEMKVqUs5XetR");

#[program]
pub mod easy_amm {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
