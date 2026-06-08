// src/services/layerZeroService.ts
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Options } from "@layerzerolabs/lz-v2-utilities";

// Setup stable network configurations with strict fallback type-narrowing
const SOLANA_RPC: string = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

// Target configurations mapped with explicit address parameters
const UNIV_MINT_RAW_ADDRESS = "YourActualSolanaUNIVMintAddressHere";
const TARGET_SOL_WALLET_RAW_ADDRESS = "9xuzkvHT9reezoEN315KYNJDCQoMBWnkfAnT4prVFn5R";

/**
 * Service to pre-evaluate destination account parameters and generate
 * the exact LayerZero execution options without TypeScript type leaks.
 */
export async function prepareCrossChainOptions(): Promise<string> {
  // Guard against unconfigured placeholder strings to prevent silent execution crashes
  if (UNIV_MINT_RAW_ADDRESS === "YourActualSolanaUNIVMintAddressHere") {
    throw new Error("[LayerZero Service] Critical Error: UNIV_MINT_RAW_ADDRESS is still using the placeholder string.");
  }

  const UNIV_MINT_ADDRESS = new PublicKey(UNIV_MINT_RAW_ADDRESS);
  const TARGET_SOL_WALLET = new PublicKey(TARGET_SOL_WALLET_RAW_ADDRESS);
  
  const connection = new Connection(SOLANA_RPC, "confirmed");

  // 1. Derive what the Associated Token Account address must be on Solana
  const expectedAta = getAssociatedTokenAddressSync(
    UNIV_MINT_ADDRESS,
    TARGET_SOL_WALLET
  );

  let ataExists = false;
  try {
    // 2. Query Solana ledger for account registration status
    const accountInfo = await connection.getAccountInfo(expectedAta);
    if (accountInfo !== null) {
      ataExists = true;
      console.log(`[LayerZero Service] Destination ATA found: ${expectedAta.toBase58()}`);
    }
  } catch (error) {
    console.log("[LayerZero Service] ATA not found or network query defaulted. Assuming account creation needed.");
  }

  // 3. Build LayerZero V2 Execution Matrix
  // Explicitly casting values to BigInt matching the strict LayerZero V2 SDK type signatures
  const computeUnits: bigint = BigInt(200000);
  let optionsBuilder = Options.newOptions();
  
  if (ataExists) {
    // Scenario A: ATA exists, pass 0 extra native gas for Rent (Cast to BigInt)
    const zeroNativeGas: bigint = BigInt(0);
    optionsBuilder = optionsBuilder.addExecutorLzReceiveOption(computeUnits, zeroNativeGas);
  } else {
    console.log("[LayerZero Service] Target requires Rent-Exemption delivery funding (~0.00204 SOL).");
    // Scenario B: Append standard rent lamports needed for an SPL Token allocation (Cast to BigInt)
    const rentLamportsGas: bigint = BigInt(2039280);
    optionsBuilder = optionsBuilder.addExecutorLzReceiveOption(computeUnits, rentLamportsGas);
  }

  // Convert layout struct parameters into an explicit hex string mapping
  const hexOptions: string = optionsBuilder.toHex();
  console.log(`[LayerZero Service] Generated Option Matrix: ${hexOptions}`);
  
  return hexOptions;
}