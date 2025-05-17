//! 链下事件记录

use anchor_lang::prelude::*;


/// 池子初始化
#[event]
pub struct InitializeSwapEvent {
    pub swap: Pubkey,
    pub user: Pubkey,
    pub token_a: Pubkey,
    pub token_b: Pubkey,
    pub pool_mint: Pubkey,
    pub initial_a: u64,
    pub initial_b: u64,
    pub lp_issued: u64,
}


/// 双币种提取
#[event]
pub struct WithdrawAllEvent {
    pub user: Pubkey,
    pub pool_amount: u64,
    pub token_a_amount: u64,
    pub token_b_amount: u64,
    pub withdraw_fee: u64,
}


/// 单币种提取
#[event]
pub struct WithdrawSingleEvent {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub pool_token_amount: u64,
    pub destination_token_amount: u64,
    pub withdraw_fee: u64,
}


/// 存入流动性(双币)
#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub pool_mint: Pubkey,
    pub pool_token_amount: u64,
    pub token_a_amount: u64,
    pub token_b_amount: u64,
}


/// 存入流动性(单币)
#[event]
pub struct DepositSingleEvent {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub source_token_amount: u64,
    pub pool_token_amount: u64,
}

/// 兑换事件
#[event]
pub struct SwapEvent {
    pub user: Pubkey,
    pub user_source_token: Pubkey,
    pub user_destination_token: Pubkey,
    pub pool_source_token: Pubkey,
    pub pool_destination_token: Pubkey,
    pub from_mint: Pubkey,
    pub to_mint: Pubkey,
    pub amount_in: u64,
    pub amount_out: u64,
}