# Cryptographically Verifiable Spending Guardrails for USDT0 on Plasma

> Extends [baghdadgherras/x402-usdt0](https://github.com/baghdadgherras/x402-usdt0) — the reference x402 payment demo on Plasma — by adding a cryptographically verifiable spending guardrail to the payment path. Where the original demonstrates x402 payments with WDK + USDT0, this PoC adds a ZK proof that an ML model authorized every transaction for these exact parameters — making the payment rail tamper-evident and auditable without trusting any single party.

**Trustless, cryptographically verifiable spending guardrails for USDT0.** This project integrates zkML verification natively into the [Tether WDK](https://docs.wallet.tether.io) payment path, settling in [USDT0](https://usdt0.to) on [Plasma](https://www.plasma.to).

Every piece of this system is built directly on Tether primitives:

| Layer | Tether Primitive | What It Does Here |
|-------|-----------------|-------------------|
| **Wallet** | [Tether WDK](https://docs.wallet.tether.io) | Signs transactions, manages keys, executes transfers |
| **Token** | [USDT0](https://usdt0.to) | The payment unit — omnichain USDT via LayerZero |
| **Chain** | [Plasma](https://www.plasma.to) (chain ID 9745) | Where payments settle — Tether's own L1 |
| **Protocol** | [x402](https://www.x402.org/) | HTTP-native micropayments in USDT0 |

WDK is the signing and wallet layer. USDT0 is the real payment rail. Plasma is the default network. The ZK proof is the spending guardrail — cryptographically verifiable by anyone, forgeable by no one. No party can skip the ML check, swap the model, or forge an approval.

## What This Does

A trustless, cryptographically verifiable spending guardrail that evaluates every transaction for risk — spending patterns, velocity, trust scores — before it can execute. Unlike server-side fraud checks that users have to trust blindly, the ML model runs inside a zero-knowledge VM ([Jolt-Atlas](https://github.com/ICME-Lab/jolt-atlas)), producing a cryptographic proof that the evaluation actually happened. Anyone can verify the guardrail ran; no one can forge that it did. No trust required — only math.

**WDK integration:** The spending guardrail sits between `gatedTransfer()` and `account.transfer()`. The WDK wallet won't execute the transfer unless the zkML proof is valid and the cosigner has signed off.

**USDT0 binding:** Every payment is denominated in real USDT0. The proof is cryptographically bound to the token address, payment amount, and recipient — change any of these and the proof becomes invalid.

**Plasma settlement:** Plasma is the default settlement chain. The x402 server, client, and facilitator all point to `rpc.plasma.to` (chain ID 9745) out of the box. Settlement uses EIP-3009 `transferWithAuthorization` — trustless, non-custodial, and gasless for the payer.

## How It Protects Funds

```
User initiates 100 USDT0 transfer via WDK
         │
         ▼
┌─────────────────────────────────────────────┐
│  ML MODEL (inside Jolt-Atlas zkVM)           │
│  Evaluates: budget, trust, velocity,        │
│  amount, category, time of day              │
│  Output: AUTHORIZED or DENIED               │
│  + cryptographic proof of execution         │
└──────────────────┬──────────────────────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
    AUTHORIZED            DENIED
    + SNARK proof         No proof generated
         │                   │
         ▼                   ▼
┌──────────────────┐  ┌──────────────────┐
│  CO-SIGNER       │  │  TRANSFER        │
│  Verifies proof  │  │  BLOCKED         │
│  Signs approval  │  │  Funds stay put  │
└────────┬─────────┘  └──────────────────┘
         │
         ▼
┌──────────────────┐
│  WDK TRANSFER    │
│  USDT0 on Plasma │
│  Tx lands on-    │
│  chain           │
└──────────────────┘
```

Without a valid proof from the correct model, the cosigner won't sign and the WDK transfer can't execute. The spending guardrail is trustless and cryptographically verifiable — users verify the proof themselves rather than trusting a server's word.

## x402 Demo: Proof-Gated Payments in USDT0

The `x402-jolt-usdt0/` directory demonstrates zkML proofs integrated into the [x402 payment protocol](https://www.x402.org/) — HTTP-native micropayments where every request costs 0.0001 USDT0 on Plasma.

**How it works in plain English:**

A weather API charges a tiny fee per request. Instead of an API key, the client pays per-request using HTTP 402. Every payment must pass through a verifiable spending guardrail — a ZK proof that an ML model approved the transaction for these exact parameters.

1. **Client requests weather data.** Server replies "402 Payment Required" — pay 0.0001 USDT0 to this address on Plasma.

2. **Client generates a live zkML proof** via the [Jolt-Atlas](https://github.com/ICME-Lab/jolt-atlas) zkVM prover (~6s on first run, cached for subsequent scenarios). The proof is cryptographically bound to the exact payment parameters — amount, recipient, chain ID 9745, and the USDT0 token address.

3. **Client signs the USDT0 payment** via WDK and retries the request with both the payment signature and ZK proof attached as HTTP headers.

4. **Server checks two gates:**
   - **Payment gate:** Is the USDT0 payment signature valid?
   - **Spending guardrail gate:** Does the ZK proof binding match these exact payment parameters? If an attacker changes the amount from 0.0001 to 10 USDT0, the SHA-256 binding hash won't match — the guardrail rejects it before anything hits Plasma.

5. **Cosigner verifies the SNARK** — confirming the ML model genuinely ran and approved.

6. **Weather data returned.** Payment settles in USDT0 on Plasma.

The demo includes three scenarios:
- **Normal flow** — proof and payment match, 200 OK
- **Tampered amount** — attacker inflates USDT0 amount, 403 — spending guardrail rejects
- **Tampered recipient** — attacker redirects payment, 403 — spending guardrail rejects

A React dashboard visualizes every step in real-time via Server-Sent Events — the UI is fully event-driven with no hardcoded timers.

**What's real:** Live Jolt-Atlas prover (~6s), real HTTP 402 flow, real cosigner SNARK verification, real EIP-3009 settlement on Plasma, real-time SSE-driven pipeline.

See [`x402-jolt-usdt0/README.md`](x402-jolt-usdt0/README.md) for full setup and usage.

## Use Cases for WDK Wallets

- **Fraud prevention** — Block suspicious USDT0 transfers before they leave the wallet. The spending guardrail catches unusual patterns and the proof guarantees the check actually ran.
- **Budget enforcement** — Enforce spending limits, daily caps, and category restrictions on USDT0 transfers. The guardrail is cryptographically verifiable — can't be bypassed or forged.
- **Risk-based authorization** — Low-risk USDT0 transfers go through instantly. High-risk ones are blocked. The model decides, the proof ensures it was legitimate.
- **Auditable compliance** — Every USDT0 transfer carries a verifiable proof of ML evaluation. Auditors verify the spending guardrail directly — trustless auditability instead of trusting logs.
- **Theft protection** — Even with stolen credentials, the spending guardrail blocks transfers that don't match normal behavior. The attacker can't forge the proof.

## Quick Start

### x402 Demo (Plasma — Real USDT0)

```bash
# 1. Start the cosigner (verifies proofs)
cd cosigner
COSIGNER_PRIVATE_KEY=$(openssl rand -hex 32) cargo run --release

# 2. Fund the client wallet with USDT0 on Plasma
cd x402-jolt-usdt0
cp .env.example .env   # edit MNEMONIC, PAY_TO_ADDRESS, COSIGNER_PRIVATE_KEY
npm install
npm run fund-wallet    # shows address + balances + funding instructions

# 3. (Optional) Pre-warm proof cache — demo generates proofs live if skipped
npm run generate-cache

# 4. Start the server + dashboard
npm run dev
# Open http://localhost:5173
```

### WDK Client Demo (Sepolia Testnet)

```bash
cd client
npm install
export COSIGNER_URL=http://localhost:3001
export SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<your-key>
export SEED_PHRASE="<your-12-word-mnemonic>"
export TEST_USDT_ADDRESS=0x959413cfD31eBe4Bc81A57b284cD638b4Be88500
npm run demo
```

Runs two scenarios: low-risk (AUTHORIZED, transfer executes) and high-risk (DENIED, transfer blocked).

## Integration Example

```typescript
import { gatedTransfer } from "./gated-transfer";

// Drop-in replacement for account.transfer() in any WDK wallet
const result = await gatedTransfer(
  {
    budget: 15,      // User's remaining budget tier (0-15)
    trust: 7,        // Trust score (0-7)
    amount: 3,       // Amount category (0-15)
    category: 0,     // Spending category (0-3)
    velocity: 2,     // Recent transaction velocity (0-7)
    day: 1,          // Day of week (0-7)
    time: 1,         // Time of day bucket (0-3)
  },
  recipientAddress,
  "100000000", // 100 USDT0 (6 decimals)
  config,
  executeTransfer  // Your WDK transfer function
);

if (result.success) {
  console.log(`Transfer complete: ${result.txHash}`);
} else {
  console.log(`Blocked: ${result.reason}`);
}
```

## Project Structure

```
├── client/              # TypeScript SDK - orchestrates the gated transfer flow
├── prover/              # Rust CLI - generates zkML proofs via Jolt-Atlas zkVM
├── cosigner/            # Rust HTTP service - verifies SNARK proofs
├── contracts/           # Solidity - test token (Foundry)
├── models/              # ONNX model + vocabulary
├── demo/                # Browser visualization
└── x402-jolt-usdt0/     # x402 payment protocol + zkML on Plasma
    ├── x402/            #   Express server, client, facilitator, middleware
    ├── zk/              #   Proof binding, caching, prover/cosigner bridges
    ├── wdk/             #   WDK wallet adapter + proof-gated decorator
    ├── demo/            #   React dashboard (SSE timeline) + MCP server
    ├── a2a/             #   A2A AgentCard + task handler
    ├── cache/           #   Pre-generated proof cache
    └── scripts/         #   Wallet funding helper
```

## How the Proof Works

1. **Model hash verification** — Both prover and cosigner compute SHA256 of the ONNX model. If they don't match, the proof is rejected. This prevents model swapping.

2. **SNARK proof** — Jolt-Atlas generates a proof that the model execution was correct. The cosigner verifies this against pre-computed verification parameters.

3. **Output check** — The proof includes the model's output. The cosigner confirms the output class is "AUTHORIZED" (class 0).

4. **Replay protection** — Each approval includes a monotonic nonce. The same proof can't be reused.

## Technical Details

### Prerequisites

- Rust 1.88+ (via `rust-toolchain.toml`)
- Node.js 20+
- Foundry (for contracts)
- [jolt-atlas](https://github.com/ICME-Lab/jolt-atlas) cloned at `../jolt-atlas/`

### Environment Variables

Copy `.env.example` to `.env`:

| Variable | Description |
|----------|-------------|
| `MNEMONIC` | BIP-39 mnemonic for x402 client wallet (Plasma) |
| `PAY_TO_ADDRESS` | Server wallet address that receives USDT0 payments |
| `COSIGNER_PRIVATE_KEY` | Hex private key for cosigner (no 0x prefix) |
| `COSIGNER_URL` | Cosigner endpoint (default: `http://localhost:3001`) |
| `SEED_PHRASE` | BIP-39 mnemonic for WDK wallet (Sepolia client SDK) |
| `SEPOLIA_RPC_URL` | Ethereum Sepolia RPC endpoint |
| `TEST_USDT_ADDRESS` | Deployed test token address (Sepolia) |

See `x402-jolt-usdt0/.env.example` for the full list of x402-specific variables.

### Running Tests

```bash
# Contract tests
cd contracts && make test

# Rust tests (prover + cosigner)
cd prover && cargo test
cd cosigner && cargo test

# Client tests
cd client && npm test
```

### Docker Deployment

```bash
# Root docker-compose: cosigner only
docker compose up -d cosigner
docker compose logs -f cosigner

# x402 docker-compose: cosigner + server + dashboard
cd x402-jolt-usdt0
docker compose up
```

## Verified on Sepolia

Real transactions executed through this system:

| Type | Address/Hash |
|------|--------------|
| **Token Contract** | [0x959413cfD31eBe4Bc81A57b284cD638b4Be88500](https://sepolia.etherscan.io/address/0x959413cfD31eBe4Bc81A57b284cD638b4Be88500) |
| **Example Transfer** | [0x39f5669338276e54f2491ec521409d11b15cf56a25589d747e518cd5be18b913](https://sepolia.etherscan.io/tx/0x39f5669338276e54f2491ec521409d11b15cf56a25589d747e518cd5be18b913) |

## Relationship to Upstream Projects

### [baghdadgherras/x402-usdt0](https://github.com/baghdadgherras/x402-usdt0)

The base this project extends. It implements the standard x402 payment flow on Plasma: client sends a request, server responds 402, client signs an EIP-3009 USDT0 payment via WDK, server verifies and settles on-chain using the official `@x402/*` SDK. Clean baseline — x402 + WDK + USDT0 on Plasma, no additional verification.

**This project rebuilds that payment flow with a trustless spending guardrail as a mandatory gate.** The x402 middleware was reimplemented (rather than wrapping `@x402/express`) because the ZK proof binding check needs to run *inside* the payment verification path, not alongside it. Every payment must carry a cryptographic proof that an ML model approved the transaction for these exact parameters — making the guardrail trustless and verifiable by anyone.

### [SemanticPay/wdk-wallet-evm-x402-facilitator](https://github.com/SemanticPay/wdk-wallet-evm-x402-facilitator)

The adapter that bridges Tether WDK wallets to the x402 facilitator interface. It wraps `@tetherto/wdk-wallet-evm` (`WalletAccountEvm`) to implement `FacilitatorEvmSigner` from `@x402/evm` — the interface that the x402 settlement layer expects for on-chain operations like `writeContract()`, `sendTransaction()`, and `verifyTypedData()`.

`x402-usdt0` uses this adapter directly. This project follows the same `FacilitatorEvmSigner` pattern in `wdk/facilitator-adapter.js` but implements it with plain ethers.js (since the zkML layer operates independently of the full WDK initialization flow). Settlement uses `eip3009ABI` and `authorizationTypes` from `@x402/evm` to call `transferWithAuthorization` on USDT0.

### What the zkML layer adds

| | x402-usdt0 (base) | x402-jolt-usdt0 (this project) |
|---|---|---|
| Payment protocol | x402 via `@x402/*` SDK | x402 reimplemented with proof gates |
| Wallet | WDK via [`wdk-wallet-evm-x402-facilitator`](https://github.com/SemanticPay/wdk-wallet-evm-x402-facilitator) | Same `FacilitatorEvmSigner` pattern (ethers.js adapter) |
| Settlement | EIP-3009 `transferWithAuthorization` | EIP-3009 `transferWithAuthorization` (via `@x402/evm` ABI) |
| Token | USDT0 on Plasma | USDT0 on Plasma |
| Authorization | Payment signature only | Payment signature + trustless spending guardrail (SNARK proof of ML execution) |
| Tamper detection | None — valid signature = valid payment | Spending guardrail: SHA-256 binding catches tampered amounts/recipients |
| ML verification | None | Jolt-Atlas zkVM proves the ONNX model ran correctly |
| Cosigner | None | Rust SNARK verifier in the payment path |
| Attack demos | None | 3 scenarios (normal, tampered amount, tampered recipient) |

The goal is to show that a trustless spending guardrail can be a native layer in the payment stack — not an external service, but a cryptographic primitive that makes every USDT0 payment provably authorized without trusting any single party.

## Built With

- [x402-usdt0](https://github.com/baghdadgherras/x402-usdt0) — Reference x402 + WDK + USDT0 payment demo this project extends
- [wdk-wallet-evm-x402-facilitator](https://github.com/SemanticPay/wdk-wallet-evm-x402-facilitator) — WDK → x402 `FacilitatorEvmSigner` adapter (pattern followed here)
- [Tether WDK](https://docs.wallet.tether.io) — Self-custodial wallet SDK
- [USDT0](https://usdt0.to) — Omnichain USDT via LayerZero
- [Plasma](https://www.plasma.to) — Tether's L1 (chain ID 9745)
- [x402](https://www.x402.org/) — HTTP-native payment protocol
- [Jolt-Atlas](https://github.com/ICME-Lab/jolt-atlas) — zkML prover by ICME Labs
- [ONNX](https://onnx.ai) — ML model format

## License

MIT
