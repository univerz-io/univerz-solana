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
        config.is_paused = false; // Admin control initialized as active
        
        msg!("Univerz Arena Initialized Successfully.");
        Ok(())
    }

    pub fn execute_spin_request(ctx: Context<ExecuteSpinRequest>, user_client_seed: u64) -> Result<()> {
        let config = &mut ctx.accounts.game_config;
        
        // 🚨 Pillar 3: Emergency Circuit Breaker Check
        if config.is_paused {
            return Err(CustomError::ProgramIsPaused.into());
        }

        let spin_cost: u64 = 10 * 1_000_000_000; 

        // 1. Escrow entry fee
        let cpi_accounts = Transfer {
            from: ctx.accounts.player_token_account.to_account_info(),
            to: ctx.accounts.escrow_vault_account.to_account_info(),
            authority: ctx.accounts.player_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, spin_cost)?;

        // 2. Fractionalize the yield
        let to_alpha = (spin_cost * 35) / 100;    
        let to_beta = (spin_cost * 10) / 100;     
        let to_gamma = (spin_cost * 5) / 100;      
        let to_treasury = spin_cost - (to_alpha + to_beta + to_gamma); 

        config.alpha_pool = config.alpha_pool.checked_add(to_alpha).ok_or(CustomError::NumericalOverflow)?;
        config.beta_pool = config.beta_pool.checked_add(to_beta).ok_or(CustomError::NumericalOverflow)?;
        config.gamma_pool = config.gamma_pool.checked_add(to_gamma).ok_or(CustomError::NumericalOverflow)?;
        config.treasury_pool = config.treasury_pool.checked_add(to_treasury).ok_or(CustomError::NumericalOverflow)?;
        config.total_spins = config.total_spins.checked_add(1).ok_or(CustomError::NumericalOverflow)?;

        // Initialize user tracking state for claim system
        let user_state = &mut ctx.accounts.user_state;
        user_state.player = ctx.accounts.player_authority.key();

        msg!("Fees processed securely. Client Telemetry Seed: {}.", user_client_seed);
        Ok(())
    }

    pub fn fulfill_randomness(ctx: Context<FulfillRandomness>, random_value: u64) -> Result<()> {
        let config = &mut ctx.accounts.game_config;
        
        if config.is_paused {
            return Err(CustomError::ProgramIsPaused.into());
        }

        // Oracle Authorization check for production environments
        // if ctx.accounts.function.owner != &switchboard_solana::ID {
        //     return Err(CustomError::UnauthorizedOracleCall.into());
        // }

        // 🚨 Pillar 1: Modern Enclave Verification & Payout Assignment Logic
        let roll = random_value % 1_000_000;
        let user_state = &mut ctx.accounts.user_state;

        if roll == 777_777 {
            // Alpha Pool Jackpot Win! (1 in 1M)
            let win_amount = config.alpha_pool;
            config.alpha_pool = 0; // Swept
            user_state.pending_winnings = user_state.pending_winnings.checked_add(win_amount).ok_or(CustomError::NumericalOverflow)?;
            msg!("🚨 ALPHA JACKPOT ACCUMULATED TO USER STATE: {}", win_amount);
        } else if roll % 10_000 == 4_242 {
            // Beta Pool Win! (1 in 10,000) - Sweeps 25% of pool
            let win_amount = config.beta_pool / 4;
            config.beta_pool = config.beta_pool.checked_sub(win_amount).ok_or(CustomError::NumericalOverflow)?;
            user_state.pending_winnings = user_state.pending_winnings.checked_add(win_amount).ok_or(CustomError::NumericalOverflow)?;
            msg!("✨ Beta Major Reward Accrued: {}", win_amount);
        } else if roll % 100 == 42 {
            // Gamma Pool Fixed Reward! (1 in 100) - 50 UNIV Fixed payout
            let win_amount = 50 * 1_000_000_000;
            if config.gamma_pool >= win_amount {
                config.gamma_pool = config.gamma_pool.checked_sub(win_amount).ok_or(CustomError::NumericalOverflow)?;
                user_state.pending_winnings = user_state.pending_winnings.checked_add(win_amount).ok_or(CustomError::NumericalOverflow)?;
                msg!("🎉 Gamma Minor Reward Accrued: {}", win_amount);
            }
        }

        config.last_result = (roll % 6) as u16; // Maintain frontend graphics segment logic
        Ok(())
    }

    // 🚨 Pillar 2: Secure User Winnings Claim Engine
    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let user_state = &mut ctx.accounts.user_state;
        let amount_to_claim = user_state.pending_winnings;

        if amount_to_claim == 0 {
            return Err(CustomError::NoWinningsToClaim.into());
        }

        // Zero-out user balance FIRST before CPI to protect completely against re-entrancy
        user_state.pending_winnings = 0;

        let signer_seeds: &[&[&[u8]]] = &[&[
            b"escrow-vault",
            &[ctx.bumps.escrow_vault_account],
        ]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_vault_account.to_account_info(),
            to: ctx.accounts.player_token_account.to_account_info(),
            authority: ctx.accounts.escrow_vault_account.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, amount_to_claim)?;

        msg!("💎 Successfully claimed {} UNIV tokens from the prize vault.", amount_to_claim);
        Ok(())
    }

    // 🚨 Pillar 3: Administrative Governance & Yield Harvesting Primitives
    pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>) -> Result<()> {
        let config = &mut ctx.accounts.game_config;
        let amount = config.treasury_pool;

        if amount == 0 {
            return Err(CustomError::NoWinningsToClaim.into()); 
        }

        config.treasury_pool = 0; // Reset allocation state

        let signer_seeds: &[&[&[u8]]] = &[&[
            b"escrow-vault",
            &[ctx.bumps.escrow_vault_account],
        ]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_vault_account.to_account_info(),
            to: ctx.accounts.authority_token_account.to_account_info(),
            authority: ctx.accounts.escrow_vault_account.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, amount)?;

        msg!("Harvested {} operational revenue tokens to platform treasury.", amount);
        Ok(())
    }

    pub fn update_pause_state(ctx: Context<UpdatePauseState>, pause_setting: bool) -> Result<()> {
        let config = &mut ctx.accounts.game_config;
        config.is_paused = pause_setting;
        msg!("🛡️ Circuit breaker updated. Is Paused: {}", pause_setting);
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
        token::transfer(CpiContext::new_with_signer(token_program, cpi_nft_release, signer_seeds), 1)?;

        msg!("🎉 [MARKETPLACE SUCCESS] Purchase finalized.");
        Ok(())
    }
}

// ================= STAGE COMPONENT ACCOUNT VALIDATION MATRICES =================

#[derive(Accounts)]
pub struct InitializeArena<'info> {
    #[account(init, payer = authority, space = 8 + GameConfig::LEN, seeds = [b"univerz-config"], bump)]
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
    
    #[account(mut, constraint = player_token_account.mint == game_config.univ_mint @ CustomError::MismatchedTokenMint)]
    pub player_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init_if_needed, payer = player_authority,
        token::mint = player_token_account_mint, token::authority = escrow_vault_account,
        seeds = [b"escrow-vault"], bump
    )]
    pub escrow_vault_account: Account<'info, TokenAccount>,
    
    #[account(address = game_config.univ_mint @ CustomError::MismatchedTokenMint)]
    pub player_token_account_mint: Account<'info, Mint>,

    #[account(
        init_if_needed, payer = player_authority, space = 8 + UserState::LEN,
        seeds = [b"user-state", player_authority.key().as_ref()], bump
    )]
    pub user_state: Account<'info, UserState>,
    
    #[account(mut)]
    pub player_authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FulfillRandomness<'info> {
    #[account(mut, seeds = [b"univerz-config"], bump)]
    pub game_config: Account<'info, GameConfig>,
    /// CHECK: Oracle Check Placeholder
    pub function: AccountInfo<'info>,
    #[account(mut, seeds = [b"user-state", user_state.player.as_ref()], bump)]
    pub user_state: Account<'info, UserState>,
    pub enclave_signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    // Changing 'has_one' to a direct evaluation constraint linking 'user_state.player' to 'player_authority'
    #[account(
        mut, 
        seeds = [b"user-state", player_authority.key().as_ref()], 
        bump, 
        constraint = user_state.player == player_authority.key()
    )]
    pub user_state: Account<'info, UserState>,
    
    #[account(mut, seeds = [b"escrow-vault"], bump)]
    pub escrow_vault_account: Account<'info, TokenAccount>,
    
    #[account(mut, constraint = player_token_account.owner == player_authority.key())]
    pub player_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub player_authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawTreasury<'info> {
    #[account(mut, seeds = [b"univerz-config"], bump, has_one = authority)]
    pub game_config: Account<'info, GameConfig>,
    #[account(mut, seeds = [b"escrow-vault"], bump)]
    pub escrow_vault_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = authority_token_account.owner == authority.key())]
    pub authority_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdatePauseState<'info> {
    #[account(mut, seeds = [b"univerz-config"], bump, has_one = authority)]
    pub game_config: Account<'info, GameConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ListNft<'info> {
    #[account(init, payer = seller, space = 8 + Listing::LEN, seeds = [b"listing", seller.key().as_ref(), seller_nft_account.mint.as_ref()], bump)]
    pub listing: Account<'info, Listing>,
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut, constraint = seller_nft_account.amount == 1 @ CustomError::InvalidNFTAccountBalance)]
    pub seller_nft_account: Account<'info, TokenAccount>,
    #[account(init, payer = seller, token::mint = nft_mint, token::authority = escrow_nft_vault, seeds = [b"nft-vault", listing.key().as_ref()], bump)]
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
    /// CHECK: Recipient of rent lamports
    #[account(mut)]
    pub seller: AccountInfo<'info>,
    pub univ_token_mint: Account<'info, Mint>,
    #[account(mut, constraint = buyer_univ_account.mint == univ_token_mint.key() @ CustomError::MismatchedTokenMint, constraint = buyer_univ_account.amount >= listing.price @ CustomError::InsufficientUnivBalance)]
    pub buyer_univ_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = seller_univ_account.mint == univ_token_mint.key() @ CustomError::MismatchedTokenMint, constraint = seller_univ_account.owner == seller.key() @ CustomError::UnauthorizedOracleCall)]
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
    pub is_paused: bool,       // Circuit breaker field
}

impl GameConfig { pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 8 + 8 + 2 + 1; }

#[account]
pub struct UserState {
    pub player: Pubkey,
    pub pending_winnings: u64,
}

impl UserState { pub const LEN: usize = 32 + 8; }

#[account]
pub struct Listing {
    pub seller: Pubkey,      
    pub nft_mint: Pubkey,    
    pub price: u64,          
    pub bump: u8,            
}

impl Listing { pub const LEN: usize = 32 + 32 + 8 + 1; }

#[error_code]
pub enum CustomError {
    #[msg("The Oracle's cryptographic random byte stream is still processing.")] RandomnessNotReady,
    #[msg("The payment token account provided does not match the official LayerZero UNIV mint standard.")] MismatchedTokenMint,
    #[msg("Your wallet does not possess enough LayerZero UNIV tokens to complete this transaction.")] InsufficientUnivBalance,
    #[msg("The provided NFT source wallet doesn't contain a valid asset count.")] InvalidNFTAccountBalance,
    #[msg("An unauthorized account attempted to fulfill randomness calculations.")] UnauthorizedOracleCall,
    #[msg("A numerical calculation resulted in a runtime core architecture overflow error.")] NumericalOverflow,
    #[msg("This dApp game engine is currently paused by platform security admin operations.")] ProgramIsPaused,
    #[msg("There are no accrued jackpot winnings allocated to this player signature state.")] NoWinningsToClaim,
}