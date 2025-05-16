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

    #[msg("The withdrawal amount is too small to process")]
    WithdrawTooSmall,

    #[msg("General calculation failure due to overflow or underflow")]
    CalculationFailure,

    #[msg("Fee calculation failed due to overflow, underflow, or unexpected 0")]
    FeeCalculationFailure,

    #[msg("Given pool token amount results in zero trading tokens")]
    ZeroTradingTokens,

    #[msg("Conversion to u64 failed with an overflow or underflow")]
    ConversionFailure,

    #[msg("Swap instruction exceeds desired slippage limit")]
    ExceededSlippage,

    #[msg("The mint must be one of the swap's supported tokens")]
    InvalidMint,

    #[msg("Insufficient pool token balance")]
    InsufficientPoolTokenBalance,

    #[msg("User token balance is insufficient")]
    InsufficientTokenBalance,

    #[msg("The deposit pool token amount is too small")]
    DepositPoolTokenAmountTooSmall,

    #[msg("The deposit single token amount is too small")]
    DepositSingleAmountTooSmall,
}
