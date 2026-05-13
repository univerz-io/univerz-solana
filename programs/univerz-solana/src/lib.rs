use anchor_lang::prelude::*;
use anchor_lang::system_program;

// We will update this ID in the next step
declare_id!("85PufcSJM7TrTW7Bw99wKpH3MKpvmq1pr7gzZFrnf57");

#[program]
pub mod univerz_solana {
    use super::*;

    pub fn pay_for_storage(ctx: Context<PayForStorage>, amount: u64, cid: String) -> Result<()> {
        // 1. Transfer SOL from user to the treasury
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;

        // 2. Log the event so we can track which CID was paid for
        emit!(StoragePaymentEvent {
            user: *ctx.accounts.user.key,
            amount,
            storacha_cid: cid,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct PayForStorage<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    /// CHECK: The Univerz treasury wallet
    pub treasury: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct StoragePaymentEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub storacha_cid: String,
}