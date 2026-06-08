// get-lz-options.js
const { Connection, PublicKey } = require("@solana/web3.js");
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");
const { Options } = require("@layerzerolabs/lz-v2-utilities");
const dotenv = require("dotenv");

// Load local environment configurations (.env file)
dotenv.config();

// RPC Connection Configuration
const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

// ==================== CONFIGURATION CONSTANTS ====================
// ⚠️ REPLACE THIS with your actual deployed $UNIV Token Mint address on Solana Mainnet
const UNIV_MINT_RAW_ADDRESS = "YourActualSolanaUNIVMintAddressHere"; 
const TARGET_SOL_WALLET_RAW_ADDRESS = "9xuzkvHT9reezoEN315KYNJDCQoMBWnkfAnT4prVFn5R";
// =================================================================

async function run() {
  if (UNIV_MINT_RAW_ADDRESS === "YourActualSolanaUNIVMintAddressHere") {
    console.error("\x1b[31m%s\x1b[0m", "❌ ERROR: You must swap 'YourActualSolanaUNIVMintAddressHere' with your true Solana $UNIV Mint address before executing.");
    process.exit(1);
  }

  console.log("🔍 Checking Solana account registration state...");
  const connection = new Connection(SOLANA_RPC, "confirmed");
  const UNIV_MINT_ADDRESS = new PublicKey(UNIV_MINT_RAW_ADDRESS);
  const TARGET_SOL_WALLET = new PublicKey(TARGET_SOL_WALLET_RAW_ADDRESS);

  // 1. Calculate the Target Associated Token Account (ATA) Address
  const expectedAta = getAssociatedTokenAddressSync(
    UNIV_MINT_ADDRESS,
    TARGET_SOL_WALLET
  );
  console.log(`📍 Derived Destination ATA address: ${expectedAta.toBase58()}`);

  // 2. Query Solana network to see if it is already initialized
  let ataExists = false;
  try {
    const accountInfo = await connection.getAccountInfo(expectedAta);
    if (accountInfo !== null) {
      ataExists = true;
      console.log("\x1b[32m%s\x1b[0m", "✅ Target ATA is already registered on Solana.");
    } else {
      console.log("\x1b[33m%s\x1b[0m", "⚠️ Target ATA does not exist on Solana. Rent funding will be included.");
    }
  } catch (error) {
    console.log("⚠️ RPC query timed out or failed. Defaulting safely to dynamic rent payload.");
  }

  // 3. Formulate the LayerZero V2 Options Struct
  const computeUnits = BigInt(200000); // 200k standard LayerZero compute limit for Solana delivery
  let optionsBuilder = Options.newOptions();

  if (ataExists) {
    // Target account is ready, pass 0 lamports for rent funding
    optionsBuilder = optionsBuilder.addExecutorLzReceiveOption(computeUnits, BigInt(0));
  } else {
    // Target account doesn't exist, request LayerZero to auto-fund the 2,039,280 lamport rent fee on destination
    optionsBuilder = optionsBuilder.addExecutorLzReceiveOption(computeUnits, BigInt(2039280));
  }

  const hexOptions = optionsBuilder.toHex();
  
  console.log("\n=================================================================================");
  console.log("\x1b[36m%s\x1b[0m", "🚀 LAYERZERO V2 EXTRAOPTIONS HEX GENERATED SUCCESSFULLY!");
  console.log("=================================================================================");
  console.log(`\n${hexOptions}\n`);
  console.log("=================================================================================");
  console.log("Use the Hex string above as your '_sendParam.extraOptions' parameter in Step 5.");
}

run().catch((err) => {
  console.error("Critical Execution Failure:", err);
});