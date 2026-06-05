import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { 
  createMint, 
  getOrCreateAssociatedTokenAccount, 
  mintTo, 
  TOKEN_PROGRAM_ID, 
  createTransferInstruction // 🧠 Added this explicit import!
} from "@solana/spl-token";
import { assert } from "chai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rawIdl = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../target/idl/univerz_solana_backend.json"), "utf8"));

describe("Univerz Arena & NFT Marketplace E2E Master Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const keypairPath = path.resolve(__dirname, "../target/deploy/univerz_solana_backend-keypair.json");
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")));
  const programId = anchor.web3.Keypair.fromSecretKey(secretKey).publicKey;
  const program = new Program(rawIdl, programId, provider) as any;

  const authority = (provider.wallet as anchor.Wallet & { payer: anchor.web3.Keypair }).payer;
  const player = anchor.web3.Keypair.generate(); // Plays the Arena, Buys the NFT
  const seller = anchor.web3.Keypair.generate(); // Sells the NFT
  const enclaveSigner = anchor.web3.Keypair.generate(); // Emulates Production Oracle Enclave Node
  
  let univMint: anchor.web3.PublicKey;
  let nftMint: anchor.web3.PublicKey;

  let playerUnivAta: anchor.web3.PublicKey;
  let sellerUnivAta: anchor.web3.PublicKey;
  let authorityUnivAta: anchor.web3.PublicKey;
  let sellerNftAta: anchor.web3.PublicKey;
  let playerNftAta: anchor.web3.PublicKey;

  const [gameConfigPDA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("univerz-config")], programId);
  const [escrowVaultPDA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("escrow-vault")], programId);
  const [userStatePDA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("user-state"), player.publicKey.toBuffer()], programId);

  let listingPDA: anchor.web3.PublicKey;
  let escrowNftVaultPDA: anchor.web3.PublicKey;

  before(async function () {
    // 1. Extend the Mocha hook limit to 60 seconds
    this.timeout(60000); 

    // 2. 🧠 FIX: Manually fund the player & seller accounts out of your deployment authority balance
    // This removes the need to hit the broken public Solana airdrop faucets completely!
    const fundPlayerTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: player.publicKey,
        lamports: 0.05 * anchor.web3.LAMPORTS_PER_SOL, // 🧠 Transfers 0.05 SOL to player for gas fees
      }),
      anchor.web3.SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: seller.publicKey,
        lamports: 0.05 * anchor.web3.LAMPORTS_PER_SOL, // 🧠 Transfers 0.05 SOL to seller for gas fees
      })
    );
    await anchor.web3.sendAndConfirmTransaction(connection, fundPlayerTx, [authority]);

    // 3. Create Mints (UNIV Token + 1 NFT)
    univMint = await createMint(connection, authority, authority.publicKey, null, 9);
    nftMint = await createMint(connection, authority, authority.publicKey, null, 0); // 0 decimals = NFT

    // 4. Setup ATAs
    playerUnivAta = (await getOrCreateAssociatedTokenAccount(connection, authority, univMint, player.publicKey)).address;
    sellerUnivAta = (await getOrCreateAssociatedTokenAccount(connection, authority, univMint, seller.publicKey)).address;
    authorityUnivAta = (await getOrCreateAssociatedTokenAccount(connection, authority, univMint, authority.publicKey)).address;
    sellerNftAta = (await getOrCreateAssociatedTokenAccount(connection, authority, nftMint, seller.publicKey)).address;
    playerNftAta = (await getOrCreateAssociatedTokenAccount(connection, authority, nftMint, player.publicKey)).address;

    // 5. Distribute Tokens (Player gets UNIV, Seller gets NFT)
    await mintTo(connection, authority, univMint, playerUnivAta, authority, 500 * 1_000_000_000); // 500 UNIV
    await mintTo(connection, authority, nftMint, sellerNftAta, authority, 1); // 1 NFT

    // 6. Derive Marketplace PDAs
    [listingPDA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("listing"), seller.publicKey.toBuffer(), nftMint.toBuffer()], programId);
    [escrowNftVaultPDA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("nft-vault"), listingPDA.toBuffer()], programId);
  });

  // ==================== 🎮 AMUSEMENT & ARENA TESTS ====================

  it("🎯 Initializes Arena Configurations with Seed Balances", async () => {
    // 1. Initialize the contract game configuration state
    await program.methods.initializeArena(
      new anchor.BN(100 * 1_000_000_000), 
      new anchor.BN(100 * 1_000_000_000), 
      new anchor.BN(100 * 1_000_000_000)
    )
    .accounts({ 
      gameConfig: gameConfigPDA, 
      authority: authority.publicKey, 
      univMint, 
      systemProgram: anchor.web3.SystemProgram.programId 
    })
    .rpc();

    // 🧠 FIX: Create an Associated Token Account for the authority wallet to hold the seed tokens first
    const authorityUnivAta = (await getOrCreateAssociatedTokenAccount(connection, authority, univMint, authority.publicKey)).address;
    
    // Mint 300 UNIV into the authority's own wallet
    await mintTo(
      connection,
      authority,
      univMint,
      authorityUnivAta,
      authority,
      300 * 1_000_000_000
    );

    // 🧠 Force-trigger the initialization of the escrow-vault token account by making a dummy player record or executing a spin request
    // Alternatively, we safely transfer tokens from the player into the vault once the spin request runs. 
    // To instantly fill the vault with the 300 UNIV seed tokens, let's execute a clean initialization helper transfer.
    
    const state = await program.account.gameConfig.fetch(gameConfigPDA);
    assert.equal(state.totalSpins.toNumber(), 0);
    assert.isFalse(state.isPaused);
  });

  it("💸 Executes Spin, Spawns UserState PDA, and Fractionalizes Fees", async () => {
    await program.methods.executeSpinRequest(new anchor.BN(999))
      .accounts({
        gameConfig: gameConfigPDA, 
        playerTokenAccount: playerUnivAta, 
        escrowVaultAccount: escrowVaultPDA,
        playerTokenAccountMint: univMint, 
        userState: userStatePDA, 
        playerAuthority: player.publicKey, 
        tokenProgram: TOKEN_PROGRAM_ID, 
        systemProgram: anchor.web3.SystemProgram.programId, 
      })
      .signers([player])
      .rpc();

    // 🧠 FIX: Using the officially imported spl-token transfer instruction instruction generator
    await anchor.web3.sendAndConfirmTransaction(
      connection,
      new anchor.web3.Transaction().add(
        createTransferInstruction(
          playerUnivAta,
          escrowVaultPDA,
          player.publicKey,
          300 * 1_000_000_000, // 300 UNIV backer seed
          [],
          TOKEN_PROGRAM_ID
        )
      ),
      [player]
    );

    const state = await program.account.gameConfig.fetch(gameConfigPDA);
    
    const treasuryAmt = state.treasuryPool ? state.treasuryPool.toNumber() : state.treasury_pool.toNumber();
    assert.equal(treasuryAmt, 5 * 1_000_000_000); 

    const userState = await program.account.userState.fetch(userStatePDA);
    assert.equal(userState.player.toBase58(), player.publicKey.toBase58());
  });

  it("🎲 Oracle Enclave Simulates a Winning Roll (Triggers Beta Major Payout)", async () => {
    const mockWinningRandomResult = new anchor.BN(4242);

    await program.methods.fulfillRandomness(mockWinningRandomResult)
      .accounts({ 
        gameConfig: gameConfigPDA, 
        function: programId, 
        userState: userStatePDA, 
        enclaveSigner: enclaveSigner.publicKey 
      })
      .signers([enclaveSigner])
      .rpc();

    const userState = await program.account.userState.fetch(userStatePDA);
    
    // 🧠 FIX: Flexible camelCase checking to resolve property structure reading crash
    const winnings = userState.pendingWinnings ? userState.pendingWinnings.toNumber() : userState.pending_winnings.toNumber();
    assert.isAbove(winnings, 0);
    msg(`Beta Pool prize ledger allocated to player state: ${winnings / 1_000_000_000} UNIV`);
  });

  it("💎 User Processes Asynchronous Claim to Drain Allocated Prize Balance", async () => {
    const playerBalanceBefore = await connection.getTokenAccountBalance(playerUnivAta);

    await program.methods.claimWinnings()
      .accounts({
        userState: userStatePDA, 
        escrowVaultAccount: escrowVaultPDA,
        escrow_vault_account: escrowVaultPDA, 
        playerTokenAccount: playerUnivAta, 
        playerAuthority: player.publicKey, 
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .signers([player])
      .rpc();

    const playerBalanceAfter = await connection.getTokenAccountBalance(playerUnivAta);
    assert.isAbove(BigInt(playerBalanceAfter.value.amount), BigInt(playerBalanceBefore.value.amount));

    const userStateCleaned = await program.account.userState.fetch(userStatePDA);
    
    // 🧠 FIX: Ensure camelCase reading property to avoid the undefined check crash!
    const winningsRemaining = userStateCleaned.pendingWinnings ? userStateCleaned.pendingWinnings.toNumber() : userStateCleaned.pending_winnings.toNumber();
    assert.equal(winningsRemaining, 0);
  });

  it("🛡️ Admin Toggles Circuit Breaker and Enforces Program Action Locking", async () => {
    // Admin toggles Pause setting to true
    await program.methods.updatePauseState(true)
      .accounts({ gameConfig: gameConfigPDA, authority: authority.publicKey })
      .rpc();

    const state = await program.account.gameConfig.fetch(gameConfigPDA);
    assert.isTrue(state.isPaused);

    // Attempting a spin under active pause conditions must crash the execution pipeline
    try {
      await program.methods.executeSpinRequest(new anchor.BN(111))
        .accounts({
          gameConfig: gameConfigPDA, playerTokenAccount: playerUnivAta, escrowVaultAccount: escrowVaultPDA,
          playerTokenAccountMint: univMint, userState: userStatePDA, playerAuthority: player.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId,
        }).signers([player]).rpc();
      assert.fail("Execution should have halted with an explicit circuit breaker error.");
    } catch (err: any) {
      assert.include(err.message, "ProgramIsPaused");
    }

    // Reactivate the program for subsequent operations
    await program.methods.updatePauseState(false)
      .accounts({ gameConfig: gameConfigPDA, authority: authority.publicKey })
      .rpc();
  });

  it("🏛️ Admin Core Harvests Platform Treasury Allocations to Governance Wallet", async () => {
    const authorityBalanceBefore = await connection.getTokenAccountBalance(authorityUnivAta);

    await program.methods.withdrawTreasury()
      .accounts({
        gameConfig: gameConfigPDA, 
        escrowVaultAccount: escrowVaultPDA,
        authorityTokenAccount: authorityUnivAta, 
        authority: authority.publicKey, 
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .rpc();

    const authorityBalanceAfter = await connection.getTokenAccountBalance(authorityUnivAta);
    assert.equal(
      BigInt(authorityBalanceAfter.value.amount) - BigInt(authorityBalanceBefore.value.amount),
      BigInt(5 * 1_000_000_000) // Extracted exactly the 5 UNIV platform fee from the spin test
    );

    const state = await program.account.gameConfig.fetch(gameConfigPDA);
    assert.equal(state.treasuryPool.toNumber(), 0);
  });

  // ==================== 🛒 OMNICHAIN NFT MARKETPLACE TESTS ====================

  it("🛒 Lists an NFT Asset for 100 UNIV Tokens into State Escrow Vaults", async () => {
    const price = new anchor.BN(100 * 1_000_000_000);
    
    await program.methods.listNft(price)
      .accounts({
        listing: listingPDA, 
        seller: seller.publicKey, 
        sellerNftAccount: sellerNftAta,
        escrowNftVault: escrowNftVaultPDA, 
        nftMint, 
        tokenProgram: TOKEN_PROGRAM_ID, 
        systemProgram: anchor.web3.SystemProgram.programId
      })
      .signers([seller])
      .rpc();

    const listingState = await program.account.listing.fetch(listingPDA);
    assert.equal(listingState.price.toNumber(), price.toNumber());

    // Verify Asset has been securely relocated to program physical custody
    const escrowBalance = await connection.getTokenAccountBalance(escrowNftVaultPDA);
    assert.equal(escrowBalance.value.amount, "1");
  });

  it("🛍️ Player Purchases the Escrowed NFT and Finalizes the On-Chain Atomic Swap", async () => {
    const sellerUnivBefore = await connection.getTokenAccountBalance(sellerUnivAta);

    await program.methods.buyNft()
      .accounts({
        listing: listingPDA, 
        buyer: player.publicKey, 
        seller: seller.publicKey,
        univTokenMint: univMint, 
        buyerUnivAccount: playerUnivAta, 
        sellerUnivAccount: sellerUnivAta,
        nftMint, 
        buyerNftAccount: playerNftAta, 
        escrowNftVault: escrowNftVaultPDA, 
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .signers([player])
      .rpc();

    // 1. Verify Seller safely extracted the 100 UNIV settlement value
    const sellerUnivAfter = await connection.getTokenAccountBalance(sellerUnivAta);
    assert.equal(
      BigInt(sellerUnivAfter.value.amount) - BigInt(sellerUnivBefore.value.amount),
      BigInt(100 * 1_000_000_000)
    );

    // 2. Verify Player received physical ownership transfer of the NFT
    const playerNftBalance = await connection.getTokenAccountBalance(playerNftAta);
    assert.equal(playerNftBalance.value.amount, "1");

    // 3. Verify Listing Account state entry has been cleared to zero and rent returned
    const listingAccountInfo = await connection.getAccountInfo(listingPDA);
    assert.isNull(listingAccountInfo);
  });
});

// Custom helper function to dump clean telemetry details into the mocha logs
function msg(text: string) {
  console.log(`    \x1b[36mℹ\x1b[0m \x1b[90m${text}\x1b[0m`);
}