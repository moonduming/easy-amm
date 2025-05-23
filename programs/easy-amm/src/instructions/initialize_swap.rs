//! 池子初始化

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken, 
    token_interface::{Mint, TokenAccount, TokenInterface}
};

use crate::{error::SwapError, events::InitializeSwapEvent, shared::{mint_tokens, transfer_tokens}, state::Swap};



/// Initializes a new swap pool.
///
/// ⚠️ `user` and `payer` **must not be the same account**.
/// This is to prevent conflicts during token transfers and fee accounting.
#[derive(Accounts)]
pub struct InitializeSwap<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(
        constraint = payer.key() != user.key() 
            @ SwapError::PayerAndUserCannotBeSame
    )]
    pub user: Signer<'info>,

    pub token_a_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        constraint = token_b_mint.key() != token_a_mint.key() 
            @ SwapError::DuplicateMint
    )]
    pub token_b_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = token_a_mint,
        associated_token::authority = user
    )]
    pub user_token_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = token_b_mint,
        associated_token::authority = user
    )]
    pub user_token_b: Box<InterfaceAccount<'info, TokenAccount>>,

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
    pub token_a: Box<InterfaceAccount<'info, TokenAccount>>,

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
    pub token_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = payer,
        seeds = [
            swap.key().as_ref(),
            Swap::POOL_MINT_SEEDS
        ],
        bump,
        mint::authority = swap,
        mint::decimals = 6
    )]
    pub pool_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = pool_mint,
        associated_token::authority = payer
    )]
    pub pool_fees_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = pool_mint,
        associated_token::authority = user
    )]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>
}


impl<'info> InitializeSwap<'info> {
    pub fn process(
        &mut self, 
        trade_fees: u16, 
        withdraw_fees: u16,
        amount_a: u64,
        amount_b: u64,
        bumps: InitializeSwapBumps
    ) -> Result<()> {
        require!(trade_fees <= Swap::MAX_TRADE_FEES, SwapError::TradeFeeTooHigh);
        require!(withdraw_fees <= Swap::MAX_WITHDRAW_FEES, SwapError::WithdrawFeeTooHigh);
        require_gt!(amount_a, 0, SwapError::ZeroInitialLiquidity);
        require_gt!(amount_b, 0, SwapError::ZeroInitialLiquidity);

        // 充值
        msg!("token_a 首充 {}", amount_a);
        transfer_tokens(
            &self.user_token_a, 
            &self.token_a, 
            amount_a, 
            &self.token_a_mint, 
            self.user.to_account_info(), 
            &self.token_program,
            None
        )?;

        msg!("token_b 首充 {}", amount_b);
        transfer_tokens(
            &self.user_token_b, 
            &self.token_b, 
            amount_b, 
            &self.token_b_mint, 
            self.user.to_account_info(), 
            &self.token_program,
            None
        )?;

        // 铸造代币
        msg!("铸造代币 {}", Swap::INITIAL_SWAP_POOL_AMOUNT);
        mint_tokens(
            &self.pool_mint, 
            &self.destination, 
            Swap::INITIAL_SWAP_POOL_AMOUNT, 
            self.swap.to_account_info(), 
            &self.token_program, 
            &[&[
                Swap::SWAP_SEEDS,
                &[bumps.swap]
            ]]
        )?;

        self.swap.set_inner(Swap { 
            token_a: self.token_a.key(), 
            token_b: self.token_b.key(), 
            pool_fee_account: self.pool_fees_account.key(), 
            pool_mint: self.pool_mint.key(), 
            token_a_mint: self.token_a_mint.key(), 
            token_b_mint: self.token_b_mint.key(), 
            trade_fees, 
            withdraw_fees, 
            swap_bump_seed: bumps.swap, 
            pool_mint_bump_seed: bumps.pool_mint, 
            token_a_bump_seed: bumps.token_a, 
            token_b_bump_seed: bumps.token_b 
        });
        // ------------------------------------------------------------------
        // Emit off‑chain event so indexers / front‑end can track pool creation
        // ------------------------------------------------------------------
        emit!(InitializeSwapEvent {
            swap: self.swap.key(),
            user: self.user.key(),
            token_a: self.token_a.key(),
            token_b: self.token_b.key(),
            pool_mint: self.pool_mint.key(),
            initial_a: amount_a,
            initial_b: amount_b,
            lp_issued: Swap::INITIAL_SWAP_POOL_AMOUNT,
        });
        Ok(())
    }
}
