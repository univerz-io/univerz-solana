const { Connection, PublicKey } = require("@solana/web3.js");
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");
const { Options } = require("@layerzerolabs/lz-v2-utilities");
const dotenv = require("dotenv");

dotenv.config();
const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

// Pulls the Mint Address straight from your terminal argument
const UNIV_MINT_RAW_ADDRESS = process.argv[2]; 
const TARGET_SOL_WALLET_RAW_ADDRESS = "9xuzkvHT9reezoEN315KYNJDCQoMBWnkfAnT4prVFn5R";

async function run() {
  if (!UNIV_MINT_RAW_ADDRESS || UNIV_MINT_RAW_ADDRESS.length < 32) {
    console.error("\x1b[31m%s\x1b[0m", "❌ ERROR: Please append your Solana $UNIV Mint Address to the command.");
    console.log("\nUsage: node get-lz-options.js <YOUR_SOLANA_MINT_ADDRESS>\n");
    process.exit(1);
  }

  console.log("🔍 Checking Solana account registration state...");
  const connection = new Connection(SOLANA_RPC, "confirmed");
  
  let UNIV_MINT_ADDRESS;
  try {
    UNIV_MINT_ADDRESS = new PublicKey(UNIV_MINT_RAW_ADDRESS);
  } catch (err) {
    console.error("\x1b[31m%s\x1b[0m", "❌ ERROR: Provided token mint address string is not a valid Solana Public Key.");
    process.exit(1);
  }
  
  const TARGET_SOL_WALLET = new PublicKey(TARGET_SOL_WALLET_RAW_ADDRESS);

  const expectedAta = getAssociatedTokenAddressSync(
    UNIV_MINT_ADDRESS,
    TARGET_SOL_WALLET
  );
  console.log(`📍 Derived Destination ATA address: ${expectedAta.toBase58()}`);

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
    console.log("⚠️ RPC query defaulted. Assuming account creation needed.");
  }

  const computeUnits = BigInt(200000);
  let optionsBuilder = Options.newOptions();

  if (ataExists) {
    optionsBuilder = optionsBuilder.addExecutorLzReceiveOption(computeUnits, BigInt(0));
  } else {
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
