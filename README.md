# Trustless ML Guardrails for Tether WDK

Protect user funds with machine learning guardrails that **no one can bypass or fake** — not even the wallet operator.

This project adds an ML-based safety layer to any [Tether Wallet Development Kit (WDK)](https://docs.wallet.tether.io) wallet. Before a transfer goes through, a trained model evaluates the transaction for risk — unusual spending patterns, velocity spikes, budget overruns. If the model flags the transaction, the funds don't move. Period.

The key difference from traditional server-side checks: **cryptographic proofs** (via [Jolt Atlas](https://github.com/ICME-Lab/jolt-atlas) zkVM) guarantee the ML model actually ran and actually approved. No one can skip the check, swap the model, or forge an approval. Users and auditors can verify every decision independently.

## Why This Exists

Wallets today rely on server-side fraud checks that users have to trust blindly. There's no way to know whether a risk check actually happened, whether it used the right model, or whether someone with database access quietly whitelisted a suspicious transaction.

This is a real problem for custodial and semi-custodial wallets handling stablecoins at scale. Users deserve to know that the guardrails protecting their funds are actually in place — not just promised.

**zkML solves this.** The ML model runs inside a zero-knowledge virtual machine, which produces a cryptographic proof of the model's execution. That proof is publicly verifiable. Either the model approved the transaction with a valid proof, or the transfer doesn't happen.

**What this means in practice:**
- A compromised server **can't silently disable** fraud detection
- A malicious insider **can't swap the model** for a permissive one (the model hash is verified)
- A sophisticated attacker **can't forge an approval** — the proof is cryptographically bound to the model, inputs, and output
- Users and regulators **can independently verify** that every transfer was properly authorized

## How It Protects Funds

1. User initiates a 100 USDT transfer
2. The ML model evaluates the transaction against real-time signals — spending budget, trust score, transaction velocity, amount category, time of day
3. **If the model says AUTHORIZED:** a SNARK proof is generated proving the model genuinely approved this specific transaction
4. The co-signer independently verifies the proof and signs off only if it's valid
5. The WDK executes the transfer
6. **If the model says DENIED:** no proof is generated, the co-signer never signs, and the funds stay put

There's no way around step 3. Without a valid proof from the correct model, the co-signer won't sign, and the transfer can't execute.

## Use Cases

- **Fraud prevention** — Block unauthorized or suspicious transfers before funds leave the wallet. Unusual patterns (sudden large transfers, rapid-fire transactions, new recipients) get caught by the model and stopped with cryptographic certainty.
- **Spending guardrails** — Enforce budgets, daily limits, and category restrictions. A corporate treasury wallet can cap daily outflows; a consumer wallet can enforce self-set spending limits that can't be bypassed in a moment of weakness.
- **Risk-based authorization** — Low-risk transfers go through instantly. High-risk ones (large amounts, low trust scores, unusual velocity) are blocked or escalated. The model makes the call, and the proof ensures the call was legitimate.
- **Auditable compliance** — Every transfer carries a verifiable proof that the policy model ran. Regulators and auditors don't need to trust logs — they can verify the proofs directly.
- **Theft protection** — Even if an attacker obtains wallet credentials, the ML guardrails still block transactions that don't match the user's normal behavior. The attacker can't bypass the model because they can't forge the proof.

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
