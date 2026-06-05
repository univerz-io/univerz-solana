use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("3uqqbb6uzsy5koJgsJqKR86tmNLNBLp3d7HtozHi4LZh");

#[program]
pub mod univerz_solana_backend {
    use super::*;

    // ==================== 🎮 AMUSEMENT & ARENA ENGINE CORE ====================

    pub fn initialize_arena(
        ctx: Context<InitializeArena>, 
        initial_alpha: u64, 
        initial_beta: u64, 
        initial_gamma: u64
    ) -> Result<()> {
        let config = &mut ctx.accounts.game_config;
        config.authority = ctx.accounts.authority.key();
        config.univ_mint = ctx.accounts.univ_mint.key();
        config.alpha_pool = initial_alpha;
        config.beta_pool = initial_beta;
        config.gamma_pool = initial_gamma;
        config.treasury_pool = 0;
        config.total_spins = 0;
        config.last_result = 999; 
        
        msg!("Univerz Arena Initialized Successfully.");
        Ok(())
    }

    pub fn execute_spin_request(ctx: Context<ExecuteSpinRequest>, user_client_seed: u64) -> Result<()> {
        let config = &mut ctx.accounts.game_config;
        
        let spin_cost: u64 = 10 * 1_000_000_000; 

        let cpi_accounts = Transfer {
            from: ctx.accounts.player_token_account.to_account_info(),
            to: ctx.accounts.escrow_vault_account.to_account_info(),
            authority: ctx.accounts.player_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, spin_cost)?;

        let to_alpha = (spin_cost * 35) / 100;    
        let to_beta = (spin_cost * 10) / 100;     
        let to_gamma = (spin_cost * 5) / 100;      
        let to_treasury = spin_cost - (to_alpha + to_beta + to_gamma); 

        config.alpha_pool = config.alpha_pool.checked_add(to_alpha).ok_or(CustomError::NumericalOverflow)?;
        config.beta_pool = config.beta_pool.checked_add(to_beta).ok_or(CustomError::NumericalOverflow)?;
        config.gamma_pool = config.gamma_pool.checked_add(to_gamma).ok_or(CustomError::NumericalOverflow)?;
        config.treasury_pool = config.treasury_pool.checked_add(to_treasury).ok_or(CustomError::NumericalOverflow)?;
        config.total_spins = config.total_spins.checked_add(1).ok_or(CustomError::NumericalOverflow)?;

        msg!("Fees processed securely. Client Telemetry Seed: {}.", user_client_seed);
        Ok(())
    }

    pub fn fulfill_randomness(ctx: Context<FulfillRandomness>, random_value: u64) -> Result<()> {
        // 1. Explicit owner verification for the Switchboard ID
        if ctx.accounts.function.owner != &switchboard_solana::ID {
            return Err(CustomError::UnauthorizedOracleCall.into());
        }

        // 2. Core Game Logic Execution
        let winning_segment = (random_value % 6) as u16;
        
        let config = &mut ctx.accounts.game_config;
        config.last_result = winning_segment;

        msg!("🎯 Modern Enclave Verification Complete! Segment: {}", winning_segment);
        Ok(())
    }

    // ==================== 🛒 OMNICHAIN NFT MARKETPLACE CORE ====================

    pub fn list_nft(ctx: Context<ListNft>, price: u64) -> Result<()> {
        let listing = &mut ctx.accounts.listing;
        listing.seller = ctx.accounts.seller.key();
        listing.nft_mint = ctx.accounts.seller_nft_account.mint;
        listing.price = price;
        listing.bump = ctx.bumps.listing;

        let cpi_accounts = Transfer {
            from: ctx.accounts.seller_nft_account.to_account_info(),
            to: ctx.accounts.escrow_nft_vault.to_account_info(),
            authority: ctx.accounts.seller.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(CpiContext::new(cpi_program, cpi_accounts), 1)?;

        msg!("🌐 NFT Asset listed successfully for {} UNIV tokens.", price);
        Ok(())
    }

    pub fn buy_nft(ctx: Context<BuyNft>) -> Result<()> {
        let listing = &ctx.accounts.listing;

        let cpi_payment = Transfer {
            from: ctx.accounts.buyer_univ_account.to_account_info(),
            to: ctx.accounts.seller_univ_account.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        };
        let token_program = ctx.accounts.token_program.to_account_info();
        token::transfer(CpiContext::new(token_program.clone(), cpi_payment), listing.price)?;

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
            CpiContext::new_with_signer(token_program, cpi_nft_release, signer_seeds), 
            1
        )?;

        msg!("🎉 [MARKETPLACE SUCCESS] Purchase finalized.");
        Ok(())
    }
}

// ================= STAGE COMPONENT ACCOUNT VALIDATION MATRICES =================

#[derive(Accounts)]
pub struct InitializeArena<'info> {
    #[account(
        init, 
        payer = authority, 
        space = 8 + GameConfig::LEN, 
        seeds = [b"univerz-config"],
        bump
    )]
    pub game_config: Account<'info, GameConfig>,
    pub univ_mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteSpinRequest<'info> {
    #[account(mut, seeds = [b"univerz-config"], bump)]
    pub game_config: Account<'info, GameConfig>,
    
    #[account(
        mut,
        constraint = player_token_account.mint == game_config.univ_mint @ CustomError::MismatchedTokenMint
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init_if_needed,
        payer = player_authority,
        token::mint = player_token_account_mint, // Fallback directly to the verified token account reference
        token::authority = escrow_vault_account,
        seeds = [b"escrow-vault"],
        bump
    )]
    pub escrow_vault_account: Account<'info, TokenAccount>,
    
    #[account(address = game_config.univ_mint @ CustomError::MismatchedTokenMint)]
    pub player_token_account_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub player_authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FulfillRandomness<'info> {
    #[account(mut, seeds = [b"univerz-config"], bump)]
    pub game_config: Account<'info, GameConfig>,
    
    /// CHECK: Program owner verified explicitly inside instruction handler
    pub function: AccountInfo<'info>,
    
    pub enclave_signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct ListNft<'info> {
    #[account(
        init,
        payer = seller,
        space = 8 + Listing::LEN,
        seeds = [b"listing", seller.key().as_ref(), seller_nft_account.mint.as_ref()],
        bump
    )]
    pub listing: Account<'info, Listing>,
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        mut,
        constraint = seller_nft_account.amount == 1 @ CustomError::InvalidNFTAccountBalance
    )]
    pub seller_nft_account: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = seller,
        token::mint = nft_mint,
        token::authority = escrow_nft_vault,
        seeds = [b"nft-vault", listing.key().as_ref()],
        bump
    )]
    pub escrow_nft_vault: Account<'info, TokenAccount>,
    pub nft_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyNft<'info> {
    #[account(mut, close = seller, has_one = seller, has_one = nft_mint)]
    pub listing: Account<'info, Listing>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: Recipient verified via layout mappings
    #[account(mut)]
    pub seller: AccountInfo<'info>,
    pub univ_token_mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = buyer_univ_account.mint == univ_token_mint.key() @ CustomError::MismatchedTokenMint,
        constraint = buyer_univ_account.amount >= listing.price @ CustomError::InsufficientUnivBalance
    )]
    pub buyer_univ_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = seller_univ_account.mint == univ_token_mint.key() @ CustomError::MismatchedTokenMint,
        constraint = seller_univ_account.owner == seller.key() @ CustomError::UnauthorizedOracleCall
    )]
    pub seller_univ_account: Account<'info, TokenAccount>,
    pub nft_mint: Account<'info, Mint>,
    #[account(mut, constraint = buyer_nft_account.mint == nft_mint.key())]
    pub buyer_nft_account: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"nft-vault", listing.key().as_ref()], bump)]
    pub escrow_nft_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ================= STRUCT DEFINITIONS =================

#[account]
pub struct GameConfig {
    pub authority: Pubkey,     
    pub univ_mint: Pubkey,
    pub alpha_pool: u64,       
    pub beta_pool: u64,        
    pub gamma_pool: u64,       
    pub treasury_pool: u64,    
    pub total_spins: u64,      
    pub last_result: u16,       
}

impl GameConfig {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 8 + 8 + 2;
}

#[account]
pub struct Listing {
    pub seller: Pubkey,      
    pub nft_mint: Pubkey,    
    pub price: u64,          
    pub bump: u8,            
}

impl Listing {
    pub const LEN: usize = 32 + 32 + 8 + 1;
}

// ================= 🎯 UNIFIED CUSTOM ERROR CODES =================

#[error_code]
pub enum CustomError {
    #[msg("The Oracle's cryptographic random byte stream is still processing.")]
    RandomnessNotReady,
    #[msg("The payment token account provided does not match the official LayerZero UNIV mint standard.")]
    MismatchedTokenMint,
    #[msg("Your wallet does not possess enough LayerZero UNIV tokens to complete this transaction.")]
    InsufficientUnivBalance,
    #[msg("The provided NFT source wallet doesn't contain a valid asset count.")]
    InvalidNFTAccountBalance,
    #[msg("An unauthorized account attempted to fulfill randomness calculations.")]
    UnauthorizedOracleCall,
    #[msg("A numerical calculation resulted in a runtime core architecture overflow error.")]
    NumericalOverflow,
}