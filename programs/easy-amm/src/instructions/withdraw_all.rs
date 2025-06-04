use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken, 
    token_interface::{Mint, TokenAccount, TokenInterface}
};

use crate::{
    error::SwapError, events::WithdrawAllEvent, shared::{
        burn_tokens, 
        calculation_fee, 
        pool_tokens_to_trading_toknes, 
        to_u64, 
        transfer_tokens
    }, state::Swap
};


#[derive(Accounts)]
pub struct WithdrawAll<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        address = swap.token_a_mint
    )]
    pub token_a_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        address = swap.token_b_mint
    )]
    pub token_b_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        seeds = [Swap::SWAP_SEEDS],
        bump
    )]
    pub swap: Box<Account<'info, Swap>>,

    #[account(
        mut,
        seeds = [
            swap.key().as_ref(),
            Swap::TOKEN_A_SEEDS
        ],
        bump = swap.token_a_bump_seed,
        token::authority = swap
    )]
    pub token_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [
            swap.key().as_ref(),
            Swap::TOKEN_B_SEEDS
        ],
        bump = swap.token_b_bump_seed,
        token::authority = swap
    )]
    pub token_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [
            swap.key().as_ref(),
            Swap::POOL_MINT_SEEDS
        ],
        bump = swap.pool_mint_bump_seed,
        mint::authority = swap
    )]
    pub pool_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_a_mint,
        associated_token::authority = user
    )]
    pub user_token_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_b_mint,
        associated_token::authority = user
    )]
    pub user_token_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = swap.pool_mint,
        associated_token::authority = user
    )]
    pub user_mint_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        address = swap.pool_fee_account,
        token::mint = swap.pool_mint
    )]
    pub pool_fee_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>
}


impl<'info> WithdrawAll<'info> {
    pub fn process(
        &self, 
        token_amount: u64,
        minimum_token_a_amount: u64,
        minimum_token_b_amount: u64,
        bump_swap: u8
    ) -> Result<()> {
        require_gt!(token_amount, Swap::MIN_TOKEN_AMOUNT, SwapError::WithdrawTooSmall);
        require!(
            token_amount <= self.user_mint_account.amount,
            SwapError::InsufficientPoolTokenBalance
        );

        let withdraw_fee = if self.pool_fee_account.key() == self.user_mint_account.key() {
            0
        } else {
            calculation_fee(
                u128::from(token_amount), 
                u128::from(self.swap.withdraw_fees)
            ).ok_or(SwapError::FeeCalculationFailure)?
        };

        let withdraw_fee = to_u64(withdraw_fee)?;

        let token_amount = token_amount
            .checked_sub(withdraw_fee)
            .ok_or(SwapError::CalculationFailure)?;

        let (token_a_amount, token_b_amount) = pool_tokens_to_trading_toknes(
            false,
            u128::from(token_amount), 
            u128::from(self.pool_mint.supply), 
            u128::from(self.token_a.amount), 
            u128::from(self.token_b.amount)
            ).ok_or(SwapError::ZeroTradingTokens)?;

        let token_a_amount = to_u64(token_a_amount)?;
        let token_b_amount = to_u64(token_b_amount)?;

        let token_a_amount = std::cmp::min(self.token_a.amount, token_a_amount);
        let token_b_amount = std::cmp::min(self.token_b.amount, token_b_amount);

        if token_a_amount < minimum_token_a_amount {
            return err!(SwapError::ExceededSlippage);
        }

        if token_a_amount == 0 && self.token_a.amount == 0 {
            return err!(SwapError::ZeroTradingTokens);
        }

        if token_b_amount < minimum_token_b_amount {
            return err!(SwapError::ExceededSlippage);
        }

        if token_b_amount == 0 && self.token_b.amount == 0 {
            return err!(SwapError::ZeroTradingTokens);
        }

        // 转账
        if withdraw_fee > 0 {
            transfer_tokens(
                &self.user_mint_account, 
                &self.pool_fee_account, 
                withdraw_fee, 
                &self.pool_mint, 
                self.user.to_account_info(), 
                &self.token_program,
                None
            )?;
            msg!("收取提取手续费(双币): {}", withdraw_fee);
        }

        // 销毁 lp mint 
        burn_tokens(
            &self.user_mint_account, 
            &self.pool_mint, 
            self.user.to_account_info(), 
            &self.token_program, 
            token_amount
        )?;

        // 转账
        if token_a_amount > 0 {
            transfer_tokens(
                &self.token_a, 
                &self.user_token_a, 
                token_a_amount, 
                &self.token_a_mint, 
                self.swap.to_account_info(), 
                &self.token_program, 
                Some(&[&[
                    Swap::SWAP_SEEDS,
                    &[bump_swap]
                ]])
            )?;
            msg!("提取token_a: {}", token_a_amount);
        }

        if token_b_amount > 0 {
            transfer_tokens(
                &self.token_b, 
                &self.user_token_b, 
                token_b_amount, 
                &self.token_b_mint, 
                self.swap.to_account_info(), 
                &self.token_program, 
                Some(&[&[
                    Swap::SWAP_SEEDS,
                    &[bump_swap]
                ]])
            )?;
            msg!("提取token_b: {}", token_b_amount);
        }

        emit!(WithdrawAllEvent {
            user: self.user.key(),
            pool_amount: token_amount,
            token_a_amount,
            token_b_amount,
            withdraw_fee,
        });

        Ok(())
    }
}
