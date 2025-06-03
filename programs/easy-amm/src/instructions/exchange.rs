//! 兑换

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::{
        spl_token_2022::{
            extension::{
                transfer_fee::TransferFeeConfig, BaseStateWithExtensions, StateWithExtensions,
            },
            state::Mint as Mint_2022,
        },
        ID as TOKEN_2022_PROGRAM_ID,
    },
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{error::SwapError, events::SwapEvent, state::Swap};

use super::shared::{calculate_exchange_amount, to_u64, transfer_tokens};

#[derive(Accounts)]
pub struct Exchange<'info> {
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
        init_if_needed,
        payer = user,
        associated_token::mint = token_a_mint,
        associated_token::authority = user
    )]
    pub user_token_a: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_b_mint,
        associated_token::authority = user
    )]
    pub user_token_b: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [
            swap.key().as_ref(),
            Swap::POOL_MINT_SEEDS
        ],
        bump = swap.pool_mint_bump_seed,
        mint::authority = swap
    )]
    pub pool_mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> Exchange<'info> {
    pub fn process(
        &self,
        bump_swap: u8,
        a_to_b: bool,
        amount_in: u64,
        minimum_amount_out: u64,
    ) -> Result<()> {
        let (
            user_source_token,
            user_destination_token,
            pool_source_token,
            pool_destination_token,
            source_mint,
            destination_mint,
        ) = if a_to_b {
            (
                &self.user_token_a,
                &self.user_token_b,
                &self.token_a,
                &self.token_b,
                &self.token_a_mint,
                &self.token_b_mint,
            )
        } else {
            (
                &self.user_token_b,
                &self.user_token_a,
                &self.token_b,
                &self.token_a,
                &self.token_b_mint,
                &self.token_a_mint,
            )
        };

        let source_mint_info = source_mint.to_account_info();
        let source_mint_data = source_mint_info.data.borrow();
        let destination_mint_info = destination_mint.to_account_info();
        let destination_mint_data = destination_mint_info.data.borrow();
        let mut a_mint_2022_data: Option<StateWithExtensions<Mint_2022>> = None;
        let mut b_mint_2022_data: Option<StateWithExtensions<Mint_2022>> = None;

        if source_mint_info.owner == &TOKEN_2022_PROGRAM_ID {
            a_mint_2022_data = Some(StateWithExtensions::<Mint_2022>::unpack(&source_mint_data)?);
        }

        if destination_mint_info.owner == &TOKEN_2022_PROGRAM_ID {
            b_mint_2022_data = Some(StateWithExtensions::<Mint_2022>::unpack(&destination_mint_data)?);
        }

        // 计算扣除转账手续费后的 amount_in
        let actual_amount_in = if let Some(data) = &a_mint_2022_data {
            Self::amount_after_transfer_fee(amount_in, data, true)?
        } else {
            amount_in
        };

        // 初步计算实际参与兑换和能兑换到的代币数量
        let (source_amount_swapped, destination_amount_swapped) = calculate_exchange_amount(
            u128::from(self.swap.trade_fees), 
            u128::from(actual_amount_in), 
            u128::from(pool_source_token.amount), 
            u128::from(pool_destination_token.amount)
        ).ok_or(SwapError::ZeroTradingTokens)?;

        // 计算用户实际需要支付的 token
        let source_amount_swapped = to_u64(source_amount_swapped)?;
        let source_transfer_amount = if let Some(data) = &a_mint_2022_data {
            Self::amount_after_transfer_fee(source_amount_swapped, data, false)?
        } else {
            source_amount_swapped
        };

        if source_transfer_amount > user_source_token.amount {
            return err!(SwapError::InsufficientTokenBalance)
        }

        // 判断是否超过最小兑换量
        let destination_amount_swapped = to_u64(destination_amount_swapped)?;
        let destination_transfer_amount = if let Some(data) = &b_mint_2022_data {
            let amount_received = Self::amount_after_transfer_fee(
                destination_amount_swapped, 
                data, 
                false,
            )?;

            if amount_received < minimum_amount_out {
                return err!(SwapError::ExceededSlippage);
            }
            amount_received
        } else {
            if destination_amount_swapped < minimum_amount_out {
                return err!(SwapError::ExceededSlippage);
            }
            destination_amount_swapped
        };


        // 用户转账
        transfer_tokens(
            user_source_token, 
            pool_source_token, 
            source_transfer_amount, 
            source_mint, 
            self.user.to_account_info(), 
            &self.token_program, 
            None
        )?;
        msg!("兑换(用户转账): {}", source_transfer_amount);

        // 池子转账
        transfer_tokens(
            pool_destination_token, 
            user_destination_token, 
            destination_transfer_amount, 
            destination_mint, 
            self.swap.to_account_info(), 
            &self.token_program, 
            Some(&[&[
                Swap::SWAP_SEEDS,
                &[bump_swap]
            ]])
        )?;
        msg!("兑换(池子转账): {}", destination_transfer_amount);

        emit!(SwapEvent {
            user: self.user.key(),
            user_source_token: user_source_token.key(),
            user_destination_token: user_destination_token.key(),
            pool_source_token: pool_source_token.key(),
            pool_destination_token: pool_destination_token.key(),
            from_mint: source_mint.key(),
            to_mint: destination_mint.key(),
            amount_in: source_transfer_amount,
            amount_out: destination_transfer_amount,
        });

        Ok(())
    }

    fn amount_after_transfer_fee<'a>(
        amount: u64,
        data: &StateWithExtensions<'a, Mint_2022>,
        sub: bool
    ) -> Result<u64> {
        let epoch = Clock::get()?.epoch;
        if let Ok(transfer_fee_config) = data.get_extension::<TransferFeeConfig>() {
            let fee = transfer_fee_config
                .calculate_epoch_fee(epoch, amount)
                .ok_or(SwapError::FeeCalculationFailure)?;
            if sub {
                Ok(amount.saturating_sub(fee))
            } else {
                Ok(amount.saturating_add(fee))
            }
        } else {
            Ok(amount)
        }
    }
}
