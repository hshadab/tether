# Trustless Risk Gating for Tether WDK

Add machine learning-based transaction authorization to any WDK transfer flow. Cryptographic proofs guarantee the ML model ran correctly - no trust required.

## What This Does

This project lets you **gate token transfers with an ML model** and prove the model actually approved the transaction. The proof is cryptographically verifiable by anyone, making the authorization trustless.

**Example flow:**
1. User wants to send 100 USDT
2. Your ML model evaluates the transaction (budget, trust score, velocity, etc.)
3. If approved: a cryptographic proof is generated showing the model said "yes"
4. A co-signer verifies the proof and signs off
5. WDK executes the transfer

If the model says "no" or the proof is invalid, the transfer is blocked.

## Why This Matters for WDK Developers

### The Problem
You want to add smart authorization rules to your wallet - fraud detection, spending limits, risk scoring. But how do you prove your rules actually ran? How do you prevent someone from bypassing the check?

### The Solution
Zero-knowledge proofs make it trustless. The ML model runs inside a zkVM (Jolt), which produces a proof that:
- The correct model was used (verified by hash)
- The model received the claimed inputs
- The model output was "AUTHORIZED"

Anyone can verify the proof independently. The co-signer only approves transfers with valid proofs. No valid proof = no transfer.

### Benefits

| Feature | Benefit |
|---------|---------|
| **Trustless verification** | Anyone can verify the proof - no need to trust the server |
| **Verifiable ML** | Prove the model ran correctly without revealing weights |
| **Drop-in for WDK** | Works with existing `account.transfer()` calls |
| **Tamper-proof** | Can't bypass the model or forge approvals |
| **Replay protection** | Each approval has a unique nonce |

## Use Cases

- **Fraud detection** - Block suspicious transactions before they execute
- **Spending policies** - Enforce daily limits, category restrictions, velocity checks
- **Risk scoring** - Require additional approval for high-risk transfers
- **Compliance rules** - Prove that policy checks ran on every transaction
- **Multi-party authorization** - ML model as one signer in a multi-sig-like flow

## Quick Start

### Run the Real Demo (Sepolia Testnet)

This executes actual zkML proofs and real token transfers:

```bash
# 1. Start the co-signer (verifies proofs)
cd cosigner
COSIGNER_PRIVATE_KEY=$(openssl rand -hex 32) cargo run --release

# 2. Run the demo (in another terminal)
cd client
npm install
export COSIGNER_URL=http://localhost:3001
export SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<your-key>
export SEED_PHRASE="<your-12-word-mnemonic>"
export TEST_USDT_ADDRESS=0x959413cfD31eBe4Bc81A57b284cD638b4Be88500
npm run demo
```

The demo runs two scenarios:
- **Low-risk transaction** (high budget, high trust) → AUTHORIZED → transfer executes
- **High-risk transaction** (low budget, low trust) → DENIED → transfer blocked

### View the Interactive Visualization

To understand the flow visually:

```bash
cd demo
npm start
# Open http://localhost:8080
```

Note: The browser UI is a visualization of the flow. It simulates the steps for demonstration purposes. Run `npm run demo` in the client folder for real proofs and real transfers.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  YOUR APP                                                        │
│  ─────────                                                       │
│  1. Collect transaction features (amount, trust, velocity...)   │
│  2. Call gatedTransfer() instead of account.transfer()          │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  PROVER (Rust CLI)                                               │
│  ────────────────                                                │
│  • Runs your ONNX model inside Jolt zkVM                        │
│  • Outputs: AUTHORIZED/DENIED + cryptographic proof             │
│  • Proof size: ~110KB                                           │
└─────────────────────────┬───────────────────────────────────────┘
                          │ (if AUTHORIZED)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  CO-SIGNER (Rust HTTP Service)                                   │
│  ─────────────────────────────                                   │
│  • Verifies the proof matches the expected model                │
│  • Checks model output == AUTHORIZED                            │
│  • Signs approval with nonce (replay protection)                │
└─────────────────────────┬───────────────────────────────────────┘
                          │ (if proof valid)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  WDK TRANSFER                                                    │
│  ────────────                                                    │
│  • account.transfer() executes normally                         │
│  • Transaction lands on-chain                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Integration Example

```typescript
import { gatedTransfer } from "./gated-transfer";

// Instead of calling account.transfer() directly...
const result = await gatedTransfer(
  {
    budget: 15,      // User's remaining budget tier
    trust: 7,        // Trust score (0-10)
    amount: 3,       // Amount category
    category: 0,     // Spending category
    velocity: 2,     // Recent transaction velocity
    day: 1,          // Day of week
    time: 1,         // Time of day bucket
  },
  recipientAddress,
  "100000000", // 100 USDT (6 decimals)
  config,
  executeTransfer  // Your WDK transfer function
);

if (result.success) {
  console.log(`Transfer complete: ${result.txHash}`);
} else {
  console.log(`Blocked: ${result.reason}`);
}
```

## Verified on Sepolia

Real transactions executed through this system:

| Type | Address/Hash |
|------|--------------|
| **Token Contract** | [0x959413cfD31eBe4Bc81A57b284cD638b4Be88500](https://sepolia.etherscan.io/address/0x959413cfD31eBe4Bc81A57b284cD638b4Be88500) |
| **Example Transfer** | [0x39f5669338276e54f2491ec521409d11b15cf56a25589d747e518cd5be18b913](https://sepolia.etherscan.io/tx/0x39f5669338276e54f2491ec521409d11b15cf56a25589d747e518cd5be18b913) |

## Project Structure

```
├── client/          # TypeScript SDK - orchestrates the flow
├── prover/          # Rust CLI - generates zkML proofs
├── cosigner/        # Rust HTTP service - verifies proofs
├── contracts/       # Solidity - test token (Foundry)
├── models/          # ONNX model + vocabulary
└── demo/            # Browser visualization
```

## Technical Details

### Prerequisites

- Rust 1.88+ (via `rust-toolchain.toml`)
- Node.js 20+
- Foundry (for contracts)
- [jolt-atlas](https://github.com/a16z/jolt) cloned at `../jolt-atlas/`

### Environment Variables

Copy `.env.example` to `.env`:

| Variable | Description |
|----------|-------------|
| `SEED_PHRASE` | BIP-39 mnemonic for WDK wallet |
| `SEPOLIA_RPC_URL` | Ethereum Sepolia RPC endpoint |
| `TEST_USDT_ADDRESS` | Deployed test token address |
| `COSIGNER_URL` | Co-signer endpoint (default: `http://localhost:3001`) |
| `COSIGNER_PRIVATE_KEY` | Hex private key for co-signer |

### Running Tests

```bash
# Contract tests
cd contracts && make test

# Client tests
cd client && npm test
```

### Docker Deployment

```bash
docker compose up -d cosigner
docker compose logs -f cosigner
```

## How the Proof Works

1. **Model hash verification** - Both prover and co-signer compute SHA256 of the ONNX model. If they don't match, the proof is rejected. This prevents model swapping.

2. **SNARK proof** - Jolt generates a proof that the model execution was correct. The co-signer verifies this proof against pre-computed verification parameters.

3. **Output check** - The proof includes the model's output. The co-signer confirms the output class is "AUTHORIZED" (class 0).

4. **Replay protection** - Each approval includes a monotonic nonce. The same proof can't be reused.

## Built With

- [Tether WDK](https://docs.wallet.tether.io) - Self-custodial wallet SDK
- [Jolt](https://github.com/a16z/jolt) - High-performance zkVM from a16z
- [ONNX](https://onnx.ai) - ML model format

## License

MIT
