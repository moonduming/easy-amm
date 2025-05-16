use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_interface::{Mint, TokenAccount, TokenInterface}};

use crate::{error::SwapError, events::WithdrawSingleEvent, shared::{burn_tokens, calculation_fee, to_u64, transfer_tokens, withdraw_single_token_type_exact_out}, state::Swap};


#[derive(Accounts)]
pub struct WithdrawSingle<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        seeds = [Swap::SWAP_SEEDS],
        bump
    )]
    pub swap: Box<Account<'info, Swap>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = swap
    )]
    pub pool_token: Box<InterfaceAccount<'info, TokenAccount>>,

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
        mut,
        token::mint = swap.pool_mint,
        token::authority = user
    )]
    pub user_mint_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user
    )]
    pub user_token: Box<InterfaceAccount<'info, TokenAccount>>,

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


impl<'info> WithdrawSingle<'info> {
    pub fn process(
        &self, 
        bump_swap: u8,
        destination_token_amount: u64,
        maximum_pool_token_amount: u64,
    ) -> Result<()> {
        require_gt!(destination_token_amount, 0, SwapError::WithdrawTooSmall);
        if self.mint.key() != self.swap.token_a_mint 
            && self.mint.key() != self.swap.token_b_mint 
        {
            return err!(SwapError::InvalidMint);
        }

        let swap_token_amount = self.pool_token.amount;
        // 计算需要消耗的池币
        let burn_pool_token_amount = withdraw_single_token_type_exact_out(
            u128::from(self.swap.trade_fees), 
            u128::from(destination_token_amount), 
            u128::from(swap_token_amount), 
            u128::from(self.pool_mint.supply)
        ).ok_or(SwapError::ZeroTradingTokens)?;

        // 计算手续费
        let withdraw_fee = if self.pool_fee_account.key() == self.user_mint_account.key() {
            0
        } else {
            calculation_fee(
                u128::from(burn_pool_token_amount), 
                u128::from(self.swap.withdraw_fees)
            ).ok_or(SwapError::FeeCalculationFailure)?
        };

        let pool_token_amount = burn_pool_token_amount
            .checked_add(withdraw_fee)
            .ok_or(SwapError::CalculationFailure)?;
        
        let pool_token_amount = to_u64(pool_token_amount)?;

        if pool_token_amount > maximum_pool_token_amount {
            return err!(SwapError::ExceededSlippage);
        }

        if pool_token_amount > self.user_mint_account.amount {
            return err!(SwapError::InsufficientPoolTokenBalance);
        }

        let withdraw_fee = to_u64(withdraw_fee)?;
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
            msg!("提取手续费(提取单币种): {}", withdraw_fee);
        }

        // 销毁池币
        burn_tokens(
            &self.user_mint_account, 
            &self.pool_mint, 
            self.user.to_account_info(), 
            &self.token_program, 
            to_u64(burn_pool_token_amount)?
        )?;
        msg!("销毁池币(但币种提取): {}", burn_pool_token_amount);

        // 转账
        transfer_tokens(
            &self.pool_token, 
            &self.user_token, 
            destination_token_amount, 
            &self.mint, 
            self.swap.to_account_info(), 
            &self.token_program, 
            Some(&[&[
                Swap::SWAP_SEEDS,
                &[bump_swap]
            ]])
        )?;
        msg!("转账(单币种提取): {}", destination_token_amount);

        emit!(WithdrawSingleEvent {
            user: self.user.key(),
            mint: self.mint.key(),
            pool_token_amount,
            destination_token_amount,
            withdraw_fee: withdraw_fee,
        });

        Ok(())
    }
}
