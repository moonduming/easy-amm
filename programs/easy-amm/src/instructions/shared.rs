use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    Mint, 
    TokenAccount, 
    TokenInterface,
    transfer_checked,
    TransferChecked,
    mint_to_checked,
    MintToChecked
};


pub fn transfer_tokens<'info>(
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    amount: u64,
    mint: &InterfaceAccount<'info, Mint>,
    authority: AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>
) -> Result<()> {
    transfer_checked(
        CpiContext::new(
            token_program.to_account_info(), 
            TransferChecked { 
                from: from.to_account_info(), 
                mint: mint.to_account_info(), 
                to: to.to_account_info(), 
                authority: authority
            }
        ), 
        amount, 
        mint.decimals
    )
}


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
