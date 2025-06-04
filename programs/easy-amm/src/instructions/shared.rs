//! 公用函数
//! 转账、铸币、计算手续费、池币兑换

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    Mint, 
    TokenAccount, 
    TokenInterface,
    transfer_checked,
    TransferChecked,
    mint_to_checked,
    MintToChecked,
    BurnChecked,
    burn_checked
};
use spl_math::{checked_ceil_div::CheckedCeilDiv, precise_number::PreciseNumber};

use crate::{error::SwapError, state::Swap};


pub fn transfer_tokens<'info>(
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    amount: u64,
    mint: &InterfaceAccount<'info, Mint>,
    authority: AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
    signer_seeds: Option<&[&[&[u8]]]>
) -> Result<()> {
    let cpi = match signer_seeds {
        Some(seeds) => CpiContext::new_with_signer(
            token_program.to_account_info(), 
            TransferChecked {
                from: from.to_account_info(), 
                mint: mint.to_account_info(), 
                to: to.to_account_info(), 
                authority: authority,
            }, 
            seeds
        ),
        None => CpiContext::new(
            token_program.to_account_info(),
            TransferChecked {
                from: from.to_account_info(), 
                mint: mint.to_account_info(), 
                to: to.to_account_info(), 
                authority: authority
            } 
        )

    };

    transfer_checked(cpi, amount, mint.decimals)
}


/// 铸造代币
pub fn mint_tokens<'info>(
    mint: &InterfaceAccount<'info, Mint>,
    destination: &InterfaceAccount<'info, TokenAccount>,
    amount: u64,
    authority: AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
    signer_seeds: &[&[&[u8]]]
) -> Result<()> {
    mint_to_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(), 
            MintToChecked { 
                mint: mint.to_account_info(), 
                to: destination.to_account_info(), 
                authority: authority
            },
            signer_seeds
        ), 
        amount, 
        mint.decimals
    )
}


/// 销毁代币
pub fn burn_tokens<'info>(
    from: &InterfaceAccount<'info, TokenAccount>, // 要销毁token的账户
    mint: &InterfaceAccount<'info, Mint>,
    authority: AccountInfo<'info>,               // owner or PDA
    token_program: &Interface<'info, TokenInterface>,
    amount: u64
) -> Result<()> {
    burn_checked(
        CpiContext::new(
            token_program.to_account_info(), 
            BurnChecked { 
                mint: mint.to_account_info(), 
                from: from.to_account_info(), 
                authority: authority 
            }
        ), 
        amount, 
        mint.decimals
    )
}


/// 计算反向交易所需的输入数量，即为了获得指定的输出，需要多少输入
pub fn pre_trading_fee_amoun(amounts: u128, fee_amount: u128) -> Option<u128> {
    if fee_amount == 0 {
        Some(amounts)
    } else {
        let fee_denominator = u128::from(Swap::FEES_BASIS_POINTS);
        let numerator = amounts.checked_mul(fee_denominator)?;
        let denominator = fee_denominator.checked_sub(fee_amount)?;

        numerator.checked_add(denominator)?
            .checked_sub(1)?
            .checked_div(denominator)
    }
}


/// 手续费计算逻辑，向下取整
pub fn calculation_fee(amounts: u128, fee_amount: u128) -> Option<u128> {
    if fee_amount == 0 {
        Some(0)
    } else {
        let fee = amounts
            .checked_mul(fee_amount)?
            .checked_div(u128::from(Swap::FEES_BASIS_POINTS))?;
        if fee == 0 {
            Some(0)
        } else {
            Some(fee)
        }
    }
}



pub fn to_u64(val: u128) -> Result<u64> {
    val.try_into().map_err(|_| error!(SwapError::ConversionFailure))
}


/// 根据提供的池子代币数量、总交易代币数量和池子代币总供应量，计算可兑换的交易代币数量。
/// 计算可兑换的交易代币数量。
pub fn pool_tokens_to_trading_tokens(
    ceiling: bool,
    pool_tokens: u128,
    pool_token_supply: u128,
    swap_token_a_amount: u128,
    swap_token_b_amount: u128, 
) -> Option<(u128, u128)> {
    let mut token_a_amount = pool_tokens
        .checked_mul(swap_token_a_amount)?
        .checked_div(pool_token_supply)?;

    let mut token_b_amount = pool_tokens
        .checked_mul(swap_token_b_amount)?
        .checked_div(pool_token_supply)?;

    if ceiling {
        let token_a_remainder = pool_tokens
            .checked_mul(swap_token_a_amount)?
            .checked_rem(pool_token_supply)?;
        if token_a_remainder > 0 && token_a_amount > 0 {
            token_a_amount += 1;
        }

        let token_b_remainder = pool_tokens
            .checked_mul(swap_token_b_amount)?
            .checked_rem(pool_token_supply)?;
        if token_b_remainder > 0 && token_b_amount > 0 {
            token_b_amount += 1;
        }
    }
    
    Some((token_a_amount, token_b_amount))
}


/// 根据指定的 token A 或 B 提取数量，计算需要销毁的池子代币数量
pub fn withdraw_single_token_type_exact_out(
    trade_fee_amount: u128,
    source_amount: u128,
    swap_token_amount: u128,
    pool_supply: u128,
) -> Option<u128> {
    // 由于我们希望计算出为了获得精确的输出，需要多少池子代币，
    // 因此我们需要获取“源代币数量的一半”兑换为另一种代币时所产生的反向交易手续费
    let half_source_amount = source_amount.checked_add(1)?.checked_div(2)?;

    let trade_fee_source_amount = pre_trading_fee_amoun(
        half_source_amount, 
        trade_fee_amount
    )?;

    let source_amount = source_amount
        .checked_sub(half_source_amount)?
        .checked_add(trade_fee_source_amount)?;

    let swap_source_amount = PreciseNumber::new(swap_token_amount)?;
    let source_amount = PreciseNumber::new(source_amount)?;
    let ratio = source_amount.checked_div(&swap_source_amount)?;
    let one = PreciseNumber::new(1)?;
    let base = one.checked_sub(&ratio)
        .unwrap_or_else(|| PreciseNumber::new(0).unwrap());

    let root = one.checked_sub(&base.sqrt()?)?;

    let pool_tokens = PreciseNumber::new(pool_supply)?
        .checked_mul(&root)?;

    pool_tokens.ceiling()?.to_imprecise()
}


/// 根据存入的 token A 或 B 数量，计算可以获得的池子代币数量
pub fn deposit_single_token_type(
    trade_fee_amount: u128,
    source_amount: u128,
    swap_token_amount: u128,
    pool_supply: u128
) -> Option<u128> {
    // 获取在将“源代币数量的一半”兑换为另一种代币时产生的交易手续费
    let half_source_amount = std::cmp::max(1, source_amount.checked_div(2)?);
    let tred_fee = calculation_fee(half_source_amount, trade_fee_amount)?;
    let source_amount = source_amount.checked_sub(tred_fee)?;

    let swap_source_amount = PreciseNumber::new(swap_token_amount)?;
    let source_amount = PreciseNumber::new(source_amount)?;
    let ratio = source_amount.checked_div(&swap_source_amount)?;
    let one = PreciseNumber::new(1)?;
    let base = one.checked_add(&ratio)?;
    let root = base.sqrt()?.checked_sub(&one)?;
    let pool_tokens = PreciseNumber::new(pool_supply)?
        .checked_mul(&root)?;

    pool_tokens.floor()?.to_imprecise()
}


/// 计算能兑换到的代币
pub fn calculate_exchange_amount(
    trade_fee_amount: u128,
    source_amount: u128,
    swap_source_amount: u128,
    swap_destination_amount: u128,
) -> Option<(u128, u128)> {
    let trade_fee = calculation_fee(source_amount, trade_fee_amount)?;
    let source_amount_less_fess = source_amount.checked_sub(trade_fee)?;

    let invariant = swap_source_amount.checked_mul(swap_destination_amount)?;
    let new_swap_source_amount = swap_source_amount.checked_add(source_amount_less_fess)?;
    let (new_swap_destination_amount, new_swap_source_amount) = invariant
        .checked_ceil_div(new_swap_source_amount)?;

    let source_amount_swapped = new_swap_source_amount.checked_sub(swap_source_amount)?;
    let destination_amount_swapped = swap_destination_amount
        .checked_sub(new_swap_destination_amount)?;

    let source_amount_swapped = source_amount_swapped.checked_add(trade_fee)?;
    
    Some((source_amount_swapped, destination_amount_swapped))
}