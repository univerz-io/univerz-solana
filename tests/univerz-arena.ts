import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rawIdl = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../target/idl/univerz_solana_backend.json"), "utf8"));

describe("Univerz Arena & NFT Marketplace E2E", () => {
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
  
  let univMint: anchor.web3.PublicKey;
  let nftMint: anchor.web3.PublicKey;

  let playerUnivAta: anchor.web3.PublicKey;
  let sellerUnivAta: anchor.web3.PublicKey;
  let sellerNftAta: anchor.web3.PublicKey;
  let playerNftAta: anchor.web3.PublicKey;

  const [gameConfigPDA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("univerz-config")], programId);
  const [escrowVaultPDA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("escrow-vault")], programId);

  let listingPDA: anchor.web3.PublicKey;
  let escrowNftVaultPDA: anchor.web3.PublicKey;

  // Change "async () => {" to "async function () {"
  before(async function () {
    // 1. Extend the Mocha hook limit to 60 seconds
    this.timeout(60000); 

    // 2. Fund Wallets
    await connection.confirmTransaction(await connection.requestAirdrop(player.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL));
    await connection.confirmTransaction(await connection.requestAirdrop(seller.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL));

    // 3. Create Mints (UNIV Token + 1 NFT)
    univMint = await createMint(connection, authority, authority.publicKey, null, 9);
    nftMint = await createMint(connection, authority, authority.publicKey, null, 0); // 0 decimals = NFT

    // 4. Setup ATAs
    playerUnivAta = (await getOrCreateAssociatedTokenAccount(connection, authority, univMint, player.publicKey)).address;
    sellerUnivAta = (await getOrCreateAssociatedTokenAccount(connection, authority, univMint, seller.publicKey)).address;
    sellerNftAta = (await getOrCreateAssociatedTokenAccount(connection, authority, nftMint, seller.publicKey)).address;
    playerNftAta = (await getOrCreateAssociatedTokenAccount(connection, authority, nftMint, player.publicKey)).address;

    // 5. Distribute Tokens (Player gets UNIV, Seller gets NFT)
    await mintTo(connection, authority, univMint, playerUnivAta, authority, 500 * 1_000_000_000); // 500 UNIV
    await mintTo(connection, authority, nftMint, sellerNftAta, authority, 1); // 1 NFT

    // 6. Derive Marketplace PDAs
    [listingPDA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("listing"), seller.publicKey.toBuffer(), nftMint.toBuffer()], programId);
    [escrowNftVaultPDA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("nft-vault"), listingPDA.toBuffer()], programId);
  });

  // --- ARENA TESTS ---
  it("🎯 Initializes Arena", async () => {
    await program.methods.initializeArena(new anchor.BN(0), new anchor.BN(0), new anchor.BN(0))
      .accounts({ gameConfig: gameConfigPDA, authority: authority.publicKey, univMint, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();
    const state = await program.account.gameConfig.fetch(gameConfigPDA);
    assert.equal(state.totalSpins.toNumber(), 0);
  });

  it("💸 Executes Spin & Routes Fees", async () => {
    await program.methods.executeSpinRequest(new anchor.BN(42))
      .accounts({
        gameConfig: gameConfigPDA, playerTokenAccount: playerUnivAta, escrowVaultAccount: escrowVaultPDA,
        playerTokenAccountMint: univMint, playerAuthority: player.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId, 
      }).signers([player]).rpc();

    const state = await program.account.gameConfig.fetch(gameConfigPDA);
    assert.equal(state.totalSpins.toNumber(), 1);
    assert.equal(state.treasuryPool.toNumber(), 5 * 1_000_000_000); // 50% of 10 UNIV
  });

  // --- MARKETPLACE TESTS ---
  it("🛒 Lists an NFT for 100 UNIV", async () => {
    const price = new anchor.BN(100 * 1_000_000_000);
    
    await program.methods.listNft(price)
      .accounts({
        listing: listingPDA, seller: seller.publicKey, sellerNftAccount: sellerNftAta,
        escrowNftVault: escrowNftVaultPDA, nftMint, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId
      }).signers([seller]).rpc();

    const listingState = await program.account.listing.fetch(listingPDA);
    assert.equal(listingState.price.toNumber(), price.toNumber());

    // Verify NFT is in Escrow
    const escrowBalance = await connection.getTokenAccountBalance(escrowNftVaultPDA);
    assert.equal(escrowBalance.value.amount, "1");
  });

  it("🛍️ Player Buys the NFT using UNIV Tokens", async () => {
    const sellerUnivBefore = await connection.getTokenAccountBalance(sellerUnivAta);

    await program.methods.buyNft()
      .accounts({
        listing: listingPDA, buyer: player.publicKey, seller: seller.publicKey,
        univTokenMint: univMint, buyerUnivAccount: playerUnivAta, sellerUnivAccount: sellerUnivAta,
        nftMint, buyerNftAccount: playerNftAta, escrowNftVault: escrowNftVaultPDA, tokenProgram: TOKEN_PROGRAM_ID
      }).signers([player]).rpc();

    // 1. Check Seller received 100 UNIV
    const sellerUnivAfter = await connection.getTokenAccountBalance(sellerUnivAta);
    assert.equal(
      BigInt(sellerUnivAfter.value.amount) - BigInt(sellerUnivBefore.value.amount),
      BigInt(100 * 1_000_000_000)
    );

    // 2. Check Player received the NFT
    const playerNftBalance = await connection.getTokenAccountBalance(playerNftAta);
    assert.equal(playerNftBalance.value.amount, "1");

    // 3. Check Listing Account was closed (Rent returned)
    const listingAccountInfo = await connection.getAccountInfo(listingPDA);
    assert.isNull(listingAccountInfo);
  });
});