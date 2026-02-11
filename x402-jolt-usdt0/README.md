# ZK-402: No Proof, No Payment

> Extends [baghdadgherras/x402-usdt0](https://github.com/baghdadgherras/x402-usdt0) — the reference x402 + WDK + USDT0 payment demo on Plasma — by adding zero-knowledge ML proof verification as a core primitive in the payment path. Community contribution and partnership PoC for the Tether ecosystem.

Zero-knowledge proof-gated USDT0 micropayments on [Plasma](https://www.plasma.to), built natively on the Tether stack.

Every HTTP payment is cryptographically bound to a JOLT-Atlas zkML proof. If the proof doesn't match the payment, the payment is rejected before it ever touches the chain. Payments settle in [USDT0](https://usdt0.to) on Plasma (chain ID 9745). Wallets are managed by [Tether WDK](https://docs.wallet.tether.io). The [x402](https://www.x402.org/) protocol handles the HTTP payment negotiation.

**Tether primitives used:** WDK (wallet signing + key management) | USDT0 (payment token) | Plasma (settlement chain) | x402 (HTTP payment protocol)

### How This Relates to x402-usdt0

[baghdadgherras/x402-usdt0](https://github.com/baghdadgherras/x402-usdt0) implements the standard x402 payment flow on Plasma using the official `@x402/*` SDK and WDK packages. It's the clean baseline: client pays, server verifies the signature, settlement happens on-chain.

This project takes that same payment concept and rebuilds the middleware with zkML verification baked in. The x402 flow was reimplemented (rather than wrapping `@x402/express`) because the ZK proof binding check must run *inside* the payment verification path — it's not an optional add-on, it's a gate that every payment must pass through.

**What's new here:** Every USDT0 payment carries a SNARK proof that an ML model authorized the transaction for these exact parameters (amount, recipient, chain, token). The proof is cryptographically bound to the payment via SHA-256 — tamper with any parameter and the binding breaks. Three attack scenarios demonstrate this in real-time.

## What This Does

A weather API charges 0.0001 USDT0 per request using the x402 payment protocol. Every payment must include a ZK proof that the ML authorization model approved the transaction for these exact parameters. The proof is cryptographically bound to the payment amount, recipient, Plasma chain ID, and USDT0 token address — change any of these and the proof becomes invalid.

```
Client                         Server                        Cosigner (Rust)
  |                              |                              |
  |-- GET /weather -->           |                              |
  |<-- 402 + requirements --     |                              |
  |                              |                              |
  | [load ZK proof from cache]   |                              |
  | [sign EIP-3009 payment]      |                              |
  |                              |                              |
  |-- GET /weather ---------->   |                              |
  |   X-Payment: {sig}           |                              |
  |   X-ZK-Proof: {proof}        |                              |
  |                              |                              |
  |                [1. verify payment sig]                      |
  |                [2. check proof binding vs payment params]   |
  |                              |-- POST /verify -->           |
  |                              |<-- approved:true --          |
  |                              |                              |
  |<-- 200 + weather data --     |                              |
```

Two gates must pass: (1) payment signature is valid, (2) ZK proof binding matches payment parameters. If either fails, the request is rejected.

## How It Works (Plain English)

A weather API charges a tiny fee (0.0001 USDT0) for every request using the HTTP 402 payment protocol. But instead of just paying and getting data, every payment must come with a cryptographic proof that an ML model approved the transaction.

Here's what happens:

1. **Client asks for weather data.** The server replies "402 Payment Required" — pay 0.0001 USDT0 to this address on Plasma.

2. **Client loads a pre-generated ZK proof.** This proof was created by a Rust prover that ran an ONNX ML model inside a Jolt zkVM. It says "the model looked at the transaction features and said AUTHORIZED." Critically, the proof is cryptographically bound to the exact payment parameters — the amount, recipient, chain, and token. Change any of these and the proof becomes invalid.

3. **Client signs a payment and retries the request,** attaching both the payment signature and the ZK proof as HTTP headers (`X-Payment` and `X-ZK-Proof`).

4. **The server checks two gates:**
   - **Gate 1 (payment):** Is the payment signature valid and for the right amount?
   - **Gate 2 (proof binding):** Does the ZK proof match these exact payment parameters? The server recomputes a SHA-256 hash over the payment details and compares it to the hash embedded in the proof. If an attacker changes the amount from 0.0001 to 10 USDT0, the hashes won't match — rejected before anything touches the blockchain.

5. **If both gates pass,** the server optionally forwards the proof to the cosigner (a Rust SNARK verifier) for deeper verification that the ML model genuinely ran and approved.

6. **Only then does the server return the weather data.**

The demo runs three scenarios to show this protection in action: a normal flow (succeeds), a tampered amount (caught at binding check), and a tampered recipient (caught at binding check). A React dashboard visualizes every step in real-time.

## Attack Scenarios

Three demo scenarios show how proof binding protects against payment manipulation:

| Scenario | What Happens | Result |
|----------|-------------|--------|
| **Normal** | Proof and payment params match | 200 OK |
| **Tampered Amount** | Attacker changes amount from 0.0001 to 10 USDT0 | 403 — Amount mismatch |
| **Tampered Recipient** | Attacker redirects payment to `0xdead...` | 403 — Recipient mismatch |

All three use the same cached ZK proof. The attack scenarios reuse the proof but send different payment parameters — the binding check catches the mismatch before anything reaches the cosigner or the chain.

## Project Structure

```
x402-jolt-usdt0/
├── package.json
├── .env.example
├── x402/
│   ├── config.js              # Network, token, pricing, paths
│   ├── server.js              # Express server + SSE + demo endpoints
│   ├── middleware.js           # ZK-402 dual-gate middleware
│   ├── client.js              # CLI client for testing scenarios
│   └── facilitator.js         # Standalone facilitator service
├── zk/
│   ├── proof-binding.js       # SHA-256 binding of proof to payment params
│   ├── proof-cache.js         # Filesystem cache for pre-generated proofs
│   ├── prover-bridge.js       # JS → Rust prover binary
│   ├── cosigner-bridge.js     # JS → Rust cosigner HTTP
│   └── scenarios.js           # Three attack scenario definitions
├── wdk/
│   ├── facilitator-adapter.js # WDK wallet → FacilitatorEvmSigner adapter
│   └── proof-gated-adapter.js # Decorator: verify proof before writeContract()
├── a2a/
│   ├── agent-card.js          # /.well-known/agent.json (A2A AgentCard)
│   └── task-handler.js        # JSON-RPC tasks/send handler
├── demo/
│   ├── http/                  # React + Vite dashboard
│   │   ├── src/App.jsx        # SSE timeline + scenario selector
│   │   └── vite.config.js     # Proxy config to server
│   └── mcp/
│       └── server.js          # MCP server for Claude Desktop
├── scripts/
│   └── fund-demo-wallet.js    # Wallet funding helper (balances + instructions)
├── cache/
│   ├── generate-cache.js      # One-time proof generation script
│   └── proofs/                # Cached proof JSON files
├── docker-compose.yml
└── docker/
    ├── Dockerfile.server
    └── Dockerfile.dashboard
```

## Prerequisites

These must be built/available before running:

| Component | Location | Notes |
|-----------|----------|-------|
| Prover binary | `../prover/target/release/zkml-prover` | Rust CLI, ~36MB compiled |
| Cosigner binary | `../cosigner/target/release/zkml-cosigner` | Rust HTTP service, ~36MB compiled |
| ONNX model | `../models/authorization.onnx` | 12KB trained model |
| Vocabulary | `../models/vocab.json` | 6KB feature mapping |
| SRS params | `../dory_srs_22_variables.srs` | 216KB Dory parameters |
| Node.js | 20+ | ES modules |

## Setup

### 1. Install dependencies

```bash
cd x402-jolt-usdt0
npm install
cd demo/http && npm install && cd ../..
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `MNEMONIC` | Yes | BIP-39 seed phrase for the client wallet (pays for requests) |
| `PAY_TO_ADDRESS` | Yes | Server wallet address (receives payments) |
| `COSIGNER_PRIVATE_KEY` | Yes | Hex private key for cosigner (no 0x prefix) |
| `COSIGNER_URL` | No | Default: `http://localhost:3001` |
| `PROVER_BINARY` | No | Default: `../prover/target/release/zkml-prover` |
| `MODELS_DIR` | No | Default: `../models` |
| `SERVER_PORT` | No | Default: `4020` |
| `FACILITATOR_PORT` | No | Default: `4021` |
| `USE_SEPOLIA` | No | Set `true` to use Sepolia testnet instead of Plasma |
| `SEPOLIA_RPC_URL` | No | Required if `USE_SEPOLIA=true` |
| `PLASMA_RPC_URL` | No | Default: `https://rpc.plasma.to` |

### 3. Generate proof cache (one-time)

This runs the prover binary once to generate a ZK proof. The same proof is reused for all three demo scenarios.

```bash
npm run generate-cache
```

This will produce three files in `cache/proofs/`:
- `normal.json` — proof with matching payment params
- `tampered_amount.json` — same proof (attack differentiation at runtime)
- `tampered_recipient.json` — same proof (attack differentiation at runtime)

### 4. Fund the client wallet

The client wallet (derived from `MNEMONIC`) needs **USDT0** and a small amount of **XPL** (gas) on Plasma.

> **Important:** Do NOT use the Hardhat default mnemonic (`test test ... junk`).
> USDT0 on Plasma blacklists its well-known addresses. Generate a fresh one:
> `node -e "import('ethers').then(e => console.log(e.Wallet.createRandom().mnemonic.phrase))"`

**Check your wallet address and balances:**
```bash
npm run fund-wallet
```

**How to fund it:**

| What | How |
|------|-----|
| USDT0 | Bridge USDT from any chain → Plasma (listed as **XPL**) via [Stargate](https://stargate.finance/bridge). If you only have USDC, swap USDC → USDT first (e.g. Uniswap on Arbitrum), then bridge. |
| XPL (gas) | Stargate may bundle some XPL automatically. If not, bridge a small amount of ETH to Plasma via Stargate. 0.005 XPL is enough for hundreds of transactions. |
| Sepolia (free) | Set `USE_SEPOLIA=true` in `.env`, use faucet tokens — no bridging needed. |

**Amount:** 0.05 USDT0 is enough for ~500 demo requests (0.0001 USDT0 each).

## Running

### Start the cosigner

```bash
cd ../cosigner
COSIGNER_PRIVATE_KEY=<key> cargo run --release
# Or use the pre-built binary:
COSIGNER_PRIVATE_KEY=<key> ./target/release/zkml-cosigner
```

The cosigner runs on port 3001 and verifies SNARK proofs.

### Start the server

```bash
npm run server
```

Starts on port 4020 with:
- `GET /weather` — ZK-402 protected endpoint
- `GET /events` — SSE stream for dashboard
- `POST /demo/start-flow` — trigger demo scenarios
- `GET /.well-known/agent.json` — A2A AgentCard
- `GET /health` — status check

### Start the dashboard

```bash
npm run dashboard
```

Opens at `http://localhost:5173` with:
- Scenario selector (Normal, Tampered Amount, Tampered Recipient)
- Real-time SSE verification timeline
- Side-by-side binding comparison table
- Proof visualizer

### Run both together

```bash
npm run dev
```

### Test with the CLI client

```bash
# Normal flow — should return 200 + weather data
SCENARIO=normal npm run client

# Tampered amount — should return 403
SCENARIO=tampered_amount npm run client

# Tampered recipient — should return 403
SCENARIO=tampered_recipient npm run client
```

## Docker

```bash
# Set env vars
export COSIGNER_PRIVATE_KEY=<key>
export MNEMONIC="<seed phrase>"
export PAY_TO_ADDRESS=<address>

# Start all services
docker compose up

# Services:
#   cosigner  → port 3001
#   server    → port 4020
#   dashboard → port 5173
```

The cosigner container has a 120-second startup period for model preprocessing.

## A2A & MCP

### A2A AgentCard

```bash
curl http://localhost:4020/.well-known/agent.json
```

Returns an AgentCard advertising the ZK-402 weather skill with x402 payment extension.

### MCP Server (Claude Desktop)

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "zk-402-weather": {
      "command": "node",
      "args": ["/path/to/x402-jolt-usdt0/demo/mcp/server.js"],
      "env": {
        "ZK402_SERVER_URL": "http://localhost:4020"
      }
    }
  }
}
```

Provides a `get-weather` tool that handles the full x402 + ZK proof flow.

## How Proof Binding Works

The binding is a SHA-256 hash over `amount|payTo|chainId|token|proofHash`. Both the client and server compute this independently.

```
Client generates proof for:          Client sends payment for:
  amount  = 100                        amount  = 100          ✓ match
  payTo   = 0xServer                   payTo   = 0xServer     ✓ match
  chainId = 9745                       chainId = 9745         ✓ match
  token   = 0xUSDT0                    token   = 0xUSDT0      ✓ match
  → binding_hash = SHA-256(...)        → recompute and compare ✓
```

In a tampered-amount attack:
```
Proof binding:                       Payment header:
  amount = 100 (0.0001 USDT0)         amount = 10000000 (10 USDT0)  ✗ MISMATCH
  → 403 Forbidden: "Amount mismatch: proof bound to 100, payment requests 10000000"
```

The server catches this before the cosigner is ever contacted.

## Network Configuration

| Setting | Plasma (default) | Sepolia (fallback) |
|---------|-------------------|-------------------|
| Chain ID | 9745 | 11155111 |
| RPC | `https://rpc.plasma.to` | Configurable |
| USDT0 | `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb` | `0x959413cfD31eBe4Bc81A57b284cD638b4Be88500` |
| Network | `eip155:9745` | `eip155:11155111` |
| Gas token | XPL (small amount needed for tx fees) | Sepolia ETH |

Switch to Sepolia by setting `USE_SEPOLIA=true` in `.env`.

---

## TODO: Remaining Work for Full Production

### Must Have

- [ ] **Fund client wallet** — Send USDT0 to the client address on Plasma (or switch to Sepolia for testing)
- [ ] **Generate proof cache** — Run `npm run generate-cache` (runs the prover binary, ~10-30 min one-time)
- [ ] **EIP-3009 signing** — Replace placeholder signature in `client.js` with real EIP-712 `TransferWithAuthorization` signing via WDK or ethers
- [ ] **On-chain settlement** — Implement `receiveWithAuthorization` call in `facilitator.js` `/settle` endpoint using the WDK adapter
- [ ] **Payment signature verification** — Add full EIP-712 signature recovery and verification in `middleware.js` (currently checks structure only)

### Should Have

- [ ] **Proof expiry** — Add TTL to cached proofs so stale proofs are rejected
- [ ] **Replay protection** — Track used proof binding hashes to prevent proof reuse
- [ ] **Rate limiting** — Add per-client rate limiting on the server
- [ ] **Error recovery in dashboard** — Handle SSE reconnection and server restart gracefully
- [ ] **HTTPS** — Add TLS termination for production deployment
- [ ] **Facilitator integration test** — End-to-end test: client → server → cosigner → on-chain settlement

### Nice to Have

- [ ] **Multi-model support** — Allow different ONNX models for different risk tiers
- [ ] **Webhook notifications** — Notify external systems on payment verification events
- [ ] **Proof compression** — Compress proofs before base64 encoding to reduce header size
- [ ] **Batch payments** — Support multiple payments per proof for bulk API access
- [ ] **Dashboard auth** — Protect the demo dashboard in production
- [ ] **Monitoring** — Add Prometheus metrics for proof verification latency, success rates

## License

MIT
