use anchor_lang::prelude::*;

#[account]
pub struct Listing {
    pub seller: Pubkey,      // 32 bytes: The wallet that listed the NFT
    pub nft_mint: Pubkey,    // 32 bytes: The exact mint address of the NFT
    pub price: u64,          // 8 bytes: Price required in your LayerZero UNIV token
    pub bump: u8,            // 1 byte: The PDA derivation security bump
}

impl Listing {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1; // Total space calculation
}