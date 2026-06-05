use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::Listing;

// 🛒 1. LIST NFT FOR SALE
#[derive(Accounts)]
pub struct ListNft<'info> {
    #[account(
        init,
        payer = seller,
        space = Listing::LEN,
        seeds = [b"listing", seller.key().as_ref(), seller_nft_account.mint.as_ref()],
        bump
    )]
    pub listing: Account<'info, Listing>,

    #[account(mut)]
    pub seller: Signer<'info>,

    /// The seller's actual token wallet holding the NFT
    #[account(mut)]
    pub seller_nft_account: Account<'info, TokenAccount>,

    /// The secure Program Escrow wallet that will hold the NFT safely while listed
    #[account(
        mut,
        seeds = [b"nft-vault", listing.key().as_ref()],
        bump
    )]
    pub escrow_nft_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn exec_list_nft(ctx: Context<ListNft>, price: u64) -> Result<()> {
    let listing = &mut ctx.accounts.listing;
    listing.seller = ctx.accounts.seller.key();
    listing.nft_mint = ctx.accounts.seller_nft_account.mint;
    listing.price = price;
    listing.bump = ctx.bumps.listing;

    // Move the NFT from the seller's wallet into the Marketplace Escrow Vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.seller_nft_account.to_account_info(),
        to: ctx.accounts.escrow_nft_vault.to_account_info(),
        authority: ctx.accounts.seller.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    token::transfer(CpiContext::new(cpi_program, cpi_accounts), 1)?;

    msg!("NFT listed successfully for {} UNIV tokens.", price);
    Ok(())
}

// 💳 2. BUY NFT WITH LAYERZERO UNIV TOKENS
#[derive(Accounts)]
pub struct BuyNft<'info> {
    #[account(
        mut,
        close = seller, // Closes the data account and gives rent money back to seller
        has_one = seller,
    )]
    pub listing: Account<'info, Listing>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: Recipient of the funds (the original seller)
    #[account(mut)]
    pub seller: AccountInfo<'info>,

    /// The buyer's LayerZero UNIV token wallet
    #[account(mut)]
    pub buyer_univ_account: Account<'info, TokenAccount>,

    /// The seller's LayerZero UNIV token wallet receiving the payment
    #[account(mut)]
    pub seller_univ_account: Account<'info, TokenAccount>,

    /// The buyer's target token wallet where the NFT will be sent
    #[account(mut)]
    pub buyer_nft_account: Account<'info, TokenAccount>,

    /// The secure Program Escrow wallet currently holding the NFT
    #[account(
        mut,
        seeds = [b"nft-vault", listing.key().as_ref()],
        bump
    )]
    pub escrow_nft_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn exec_buy_nft(ctx: Context<BuyNft>) -> Result<()> {
    let listing = &ctx.accounts.listing;

    // SECURITY CHECK: Verify the buyer is paying with the official UNIV token layout, not fake tokens
    // Replace with your real deployed LayerZero UNIV Mint public key later
    // require_keys_eq!(ctx.accounts.buyer_univ_account.mint, YOUR_UNIV_MINT_CONSTANT);

    // CPI: Transfer LayerZero UNIV tokens from Buyer directly to Seller
    let cpi_payment = Transfer {
        from: ctx.accounts.buyer_univ_account.to_account_info(),
        to: ctx.accounts.seller_univ_account.to_account_info(),
        authority: ctx.accounts.buyer.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_payment),
        listing.price,
    )?;

    // CPI: Release NFT from the Program Escrow Vault directly to the Buyer
    let listing_key = listing.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"nft-vault",
        listing_key.as_ref(),
        &[ctx.bumps.escrow_nft_vault],
    ]];

    let cpi_nft_release = Transfer {
        from: ctx.accounts.escrow_nft_vault.to_account_info(),
        to: ctx.accounts.buyer_nft_account.to_account_info(),
        authority: ctx.accounts.escrow_nft_vault.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_nft_release, signer_seeds),
        1,
    )?;

    msg!("Purchase complete! NFT transferred to buyer.");
    Ok(())
}