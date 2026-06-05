import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { 
  createMint, 
  getOrCreateAssociatedTokenAccount, 
  mintTo, 
  TOKEN_PROGRAM_ID 
} from "@solana/spl-token";
import { assert } from "chai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const idlPath = path.resolve(__dirname, "../target/idl/univerz_solana_backend.json");
const rawIdl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

describe("univerz-solana-backend arena test suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  let programId: anchor.web3.PublicKey;
  const keypairPath = path.resolve(__dirname, "../target/deploy/univerz_solana_backend-keypair.json");
  const secretKeyString = fs.readFileSync(keypairPath, "utf8");
  const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
  programId = anchor.web3.Keypair.fromSecretKey(secretKey).publicKey;
  console.log("🎯 Dynamic Program ID resolved from keypair:", programId.toBase58());

  const program = new Program(rawIdl, programId, provider) as any;

  const authority = (provider.wallet as anchor.Wallet & { payer: anchor.web3.Keypair }).payer;
  const playerKeyPair = anchor.web3.Keypair.generate();
  
  let univMint: anchor.web3.PublicKey;
  let playerTokenAccount: anchor.web3.PublicKey;

  const gameConfigPDA = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("univerz-config")],
    programId
  )[0]!;

  const escrowVaultPDA = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("escrow-vault")],
    programId
  )[0]!;

  before(async () => {
    const signature = await connection.requestAirdrop(playerKeyPair.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    const latestBlockHash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: signature,
    });

    univMint = await createMint(connection, authority, authority.publicKey, null, 9);

    const playerAtaSetup = await getOrCreateAssociatedTokenAccount(
      connection,
      authority,
      univMint,
      playerKeyPair.publicKey
    );
    playerTokenAccount = playerAtaSetup.address;

    const startingTokens = 500 * 1_000_000_000;
    await mintTo(connection, authority, univMint, playerTokenAccount, authority, startingTokens);
  });

  it("🎯 Phase 1: Initializes the Global Arena Engine State Config", async () => {
    const initialAlpha = new anchor.BN(0);
    const initialBeta = new anchor.BN(0);
    const initialGamma = new anchor.BN(0);

    const tx = await program.methods
      .initializeArena(initialAlpha, initialBeta, initialGamma)
      .accounts({
        gameConfig: gameConfigPDA,
        authority: authority.publicKey,
        univMint: univMint,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any) 
      .rpc();

    console.log("✨ Arena initialized. Activation hash signature:", tx);

    const state = await program.account.gameConfig.fetch(gameConfigPDA);
    assert.equal(state.authority.toBase58(), authority.publicKey.toBase58());
    assert.equal(state.totalSpins.toNumber(), 0);
  });

  it("💸 Phase 2: Executes Spin Request Fee Escrow Routing Processing", async () => {
    const telemetrySeed = new anchor.BN(42424242);
    const balanceInfoBefore = await connection.getTokenAccountBalance(playerTokenAccount);
    const playerBalanceBefore = balanceInfoBefore.value.amount;

    const tx = await program.methods
      .executeSpinRequest(telemetrySeed)
      .accounts({
        gameConfig: gameConfigPDA,
        playerTokenAccount: playerTokenAccount,
        escrowVaultAccount: escrowVaultPDA,
        playerTokenAccountMint: univMint, // FIX: Changed key from univMint to playerTokenAccountMint
        playerAuthority: playerKeyPair.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId, 
      } as any) 
      .signers([playerKeyPair]) 
      .rpc();

    console.log("🚀 Spin executed successfully! Processing hash signature:", tx);

    const stateAfter = await program.account.gameConfig.fetch(gameConfigPDA);
    const balanceInfoAfter = await connection.getTokenAccountBalance(playerTokenAccount);
    const playerBalanceAfter = balanceInfoAfter.value.amount;

    const expectedCost = 10 * 1_000_000_000; 
    
    assert.equal(stateAfter.alphaPool.toNumber(), (expectedCost * 35) / 100);
    assert.equal(stateAfter.betaPool.toNumber(), (expectedCost * 10) / 100);
    assert.equal(stateAfter.gammaPool.toNumber(), (expectedCost * 5) / 100);
    assert.equal(stateAfter.treasuryPool.toNumber(), (expectedCost * 50) / 100);
    assert.equal(stateAfter.totalSpins.toNumber(), 1);

    assert.equal(
      BigInt(playerBalanceBefore) - BigInt(playerBalanceAfter),
      BigInt(expectedCost)
    );
  });
});