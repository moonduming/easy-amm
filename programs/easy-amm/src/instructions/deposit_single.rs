use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_interface::{Mint, TokenAccount, TokenInterface}};

use crate::{error::SwapError, events::DepositSingleEvent, shared::{deposit_single_token_type, mint_tokens, to_u64, transfer_tokens}, state::Swap};


#[derive(Accounts)]
pub struct DepositSingle<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [Swap::SWAP_SEEDS],
        bump
    )]
    pub swap: Box<Account<'info, Swap>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = user
    )]
    pub user_token: Box<InterfaceAccount<'info, TokenAccount>>,

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
        init_if_needed,
        payer = user,
        associated_token::mint = pool_mint,
        associated_token::authority = user
    )]
    pub user_mint_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>
}


impl<'info> DepositSingle<'info> {
    pub fn process(
        &self,
        bump_swap: u8,
        source_token_amount: u64,
        minimum_pool_token_amount: u64
    ) -> Result<()> {
        require_gt!(source_token_amount, 0, SwapError::DepositSingleAmountTooSmall);

        if self.mint.key() != self.swap.token_a_mint 
            && self.mint.key() != self.swap.token_b_mint 
        {
            return err!(SwapError::InvalidMint);
        }

        if source_token_amount > self.user_token.amount {
            return err!(SwapError::InsufficientTokenBalance);
        }

        // 计算能兑换到的 池币
        let pool_token_amount = deposit_single_token_type(
            u128::from(self.swap.trade_fees), 
            u128::from(source_token_amount), 
            u128::from(self.pool_token.amount), 
            u128::from(self.pool_mint.supply)
        ).ok_or(SwapError::ZeroTradingTokens)?;

        let pool_token_amount = to_u64(pool_token_amount)?;

        if pool_token_amount < minimum_pool_token_amount {
            return err!(SwapError::ExceededSlippage);
        }

        if pool_token_amount == 0 {
            return err!(SwapError::ZeroTradingTokens);
        }

        // 转账
        transfer_tokens(
            &self.user_token, 
            &self.pool_token, 
            source_token_amount, 
            &self.mint, 
            self.user.to_account_info(), 
            &self.token_program, 
            None
        )?;
        msg!("转账(单币存入): {}", source_token_amount);

        // 铸币
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
        msg!("铸币(单币存入): {}", pool_token_amount);

        emit!(DepositSingleEvent {
            user: self.user.key(),
            mint: self.mint.key(),
            source_token_amount,
            pool_token_amount,
        });

        Ok(())
    }
}
