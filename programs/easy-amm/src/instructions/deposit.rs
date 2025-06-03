//! 存入流动性(双币)

use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_interface::{Mint, TokenAccount, TokenInterface}};

use crate::{error::SwapError, events::DepositEvent, shared::{mint_tokens, pool_tokens_to_trading_toknes, to_u64, transfer_tokens}, state::Swap};


#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [Swap::SWAP_SEEDS],
        bump
    )]
    pub swap: Account<'info, Swap>,

    #[account(
        address = swap.token_a_mint
    )]
    pub token_a_mint: InterfaceAccount<'info, Mint>,

    #[account(
        address = swap.token_b_mint
    )]
    pub token_b_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_a_mint,
        associated_token::authority = user
    )]
    pub user_token_a: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = token_b_mint,
        associated_token::authority = user
    )]
    pub user_token_b: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [
            swap.key().as_ref(),
            Swap::TOKEN_A_SEEDS
        ],
        bump = swap.token_a_bump_seed,
        token::authority = swap
    )]
    pub token_a: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [
            swap.key().as_ref(),
            Swap::TOKEN_B_SEEDS
        ],
        bump = swap.token_b_bump_seed,
        token::authority = swap
    )]
    pub token_b: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [
            swap.key().as_ref(),
            Swap::POOL_MINT_SEEDS
        ],
        bump = swap.pool_mint_bump_seed,
        mint::authority = swap
    )]
    pub pool_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = pool_mint,
        associated_token::authority = user
    )]
    pub user_mint_account: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>
}


impl<'info> Deposit<'info> {
    pub fn process(
        &self,
        bump_swap: u8,
        pool_token_amount: u64,
        maximum_token_a_amount: u64,
        maximum_token_b_amount: u64,
    ) -> Result<()> {
        require_gt!(
            pool_token_amount, 
            Swap::MIN_TOKEN_AMOUNT, 
            SwapError::DepositPoolTokenAmountTooSmall
        );

        let (token_a_amount, token_b_amount) = pool_tokens_to_trading_toknes(
            true,
            u128::from(pool_token_amount), 
            u128::from(self.pool_mint.supply), 
            u128::from(self.token_a.amount), 
            u128::from(self.token_b.amount)
        ).ok_or(SwapError::ZeroTradingTokens)?;

        let token_a_amount = to_u64(token_a_amount)?;
        let token_b_amount = to_u64(token_b_amount)?;

        if token_a_amount > maximum_token_a_amount 
            || token_b_amount > maximum_token_b_amount 
        {
            return err!(SwapError::ExceededSlippage);
        }

        if token_a_amount == 0 || token_b_amount == 0 {
            return err!(SwapError::ZeroTradingTokens);
        }
        
        if token_a_amount > self.user_token_a.amount 
            || token_b_amount > self.user_token_b.amount 
        {
            return err!(SwapError::InsufficientTokenBalance);
        }

        // 转账
        transfer_tokens(
            &self.user_token_a, 
            &self.token_a, 
            token_a_amount, 
            &self.token_a_mint, 
            self.user.to_account_info(), 
            &self.token_program, 
            None
        )?;
        msg!("双币存入 token_a: {}", token_a_amount);

        transfer_tokens(
            &self.user_token_b, 
            &self.token_b, 
            token_b_amount, 
            &self.token_b_mint, 
            self.user.to_account_info(), 
            &self.token_program, 
            None
        )?;
        msg!("双币存入 token_b: {}", token_b_amount);

        // 代币铸造
        mint_tokens(
            &self.pool_mint, 
            &self.user_mint_account, 
            pool_token_amount, 
            self.swap.to_account_info(), 
            &self.token_program, 
            &[&[
                Swap::SWAP_SEEDS,
                &[bump_swap]
            ]]
        )?;
        msg!("池币铸造(双币存入): {}", pool_token_amount);

        emit!(DepositEvent {
            user: self.user.key(),
            pool_mint: self.pool_mint.key(),
            pool_token_amount,
            token_a_amount,
            token_b_amount,
        });

        Ok(())
    }
}
