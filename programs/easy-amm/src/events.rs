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