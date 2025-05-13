use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_interface::{Mint, TokenAccount, TokenInterface}};

use crate::state::Swap;



#[derive(Accounts)]
pub struct InitializeSwap<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_a_mint: InterfaceAccount<'info, Mint>,
    pub token_b_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = Swap::SWAP_SPACE,
        seeds = [Swap::SWAP_SEEDS],
        bump
    )]
    pub swap: Box<Account<'info, Swap>>,

    #[account(
        init,
        payer = payer,
        seeds = [
            swap.key().as_ref(),
            Swap::TOKEN_A_SEEDS
        ],
        bump,
        token::mint = token_a_mint,
        token::authority = swap
    )]
    pub token_a: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        seeds = [
            swap.key().as_ref(),
            Swap::TOKEN_B_SEEDS
        ],
        bump,
        token::mint = token_b_mint,
        token::authority = swap
    )]
    pub token_b: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        seeds = [Swap::POOL_MINT_SEEDS],
        bump,
        mint::authority = swap,
        mint::decimals = 9
    )]
    pub pool_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = pool_mint,
        associated_token::authority = payer
    )]
    pub pool_fees_account: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>
}


impl<'info> InitializeSwap<'info> {
    pub fn process(&mut self) -> Result<()> {
        msg!("hhhhhh");
        Ok(())
    }
}
