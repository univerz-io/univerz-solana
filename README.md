# Univerz Solana Infrastructure
This repository contains the Solana smart contract for the Univerz decentralized storage marketplace. It handles high-frequency payments and logs data CIDs to the blockchain.

## Project Details
- **Network:** Solana Devnet
- **Program ID:** `3gCoSwHdyPhvwKGrUMQKrgsJNsSa8fPS2R5EufYVUgNi`
- **Treasury Address:** `2uaTgGDra1bm4hv93i1yTUQ1RwYBofS4UNnpZXMW6KM4`

## Core Logic
The program accepts SOL/USDC payments and emits a `StoragePaymentEvent` containing:
1. The User's Public Key
2. The Amount Paid
3. The **Storacha CID** (Pointer to Filecoin storage)

## Development
- Framework: Anchor 0.32.1
- Language: Rust 1.95.0

### Build & Deploy
```bash
anchor build
anchor deploy