//! 池子全局账户

use anchor_lang::prelude::*;


#[account]
pub struct Swap {
    pub token_a: Pubkey,
    pub token_b: Pubkey,
    pub pool_fee_account: Pubkey,
    pub pool_mint: Pubkey,
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    pub trade_fees: u16,
    pub withdraw_fees: u16,
    pub swap_bump_seed: u8,
    pub pool_mint_bump_seed: u8,
    pub token_a_bump_seed: u8,
    pub token_b_bump_seed: u8,
}

impl Swap {
    pub const SWAP_SPACE: usize = 208;
    pub const SWAP_SEEDS: &'static [u8] = b"easy-amm";
    pub const TOKEN_A_SEEDS: &'static [u8] = b"token_a";
    pub const TOKEN_B_SEEDS: &'static [u8] = b"token_b";
    pub const POOL_MINT_SEEDS: &'static [u8] = b"lp_mint";

    pub const FEES_BASIS_POINTS: u16 = 10_000;
    pub const INITIAL_SWAP_POOL_AMOUNT: u64 = 1_000_000_000;
    pub const MAX_TRADE_FEES: u16 = 5_000;
    pub const MAX_WITHDRAW_FEES: u16 = 5_000;
}
