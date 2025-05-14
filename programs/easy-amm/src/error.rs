use anchor_lang::prelude::*;


#[error_code]
pub enum SwapError {
    #[msg("Token A mint and Token B mint must be different")]
    DuplicateMint,

    #[msg("Trade fee exceeds maximum allowed limit")]
    TradeFeeTooHigh,

    #[msg("Withdrawal fee exceeds maximum allowed limit")]
    WithdrawFeeTooHigh,

    #[msg("Initial token amount must be greater than zero")]
    ZeroInitialLiquidity,

    #[msg("The payer and user accounts must be different")]
    PayerAndUserCannotBeSame,
}
