# ZK-402: No Proof, No Payment

> Extends [baghdadgherras/x402-usdt0](https://github.com/baghdadgherras/x402-usdt0) — the reference x402 + WDK + USDT0 payment demo on Plasma — by adding a cryptographically verified spending guardrail to the payment path. x402 enables agents to pay for APIs with USDT0. This project adds the missing trust layer — cryptographic proof that every autonomous agent payment was evaluated and authorized by an ML model, verifiable by anyone.

Trustless agentic commerce with cryptographically verified spending guardrails for USDT0 on [Plasma](https://www.plasma.to).

x402 lets AI agents pay for APIs autonomously. But autonomous spending creates a trust problem — who ensures the agent stays within policy, doesn't get manipulated, and doesn't overspend? Every HTTP payment is cryptographically bound to a Jolt-Atlas zkML proof that acts as an agent spending policy enforcer. If the proof doesn't match the payment, the cryptographic guardrail rejects it before anything touches the chain — no trust required. Payments settle in [USDT0](https://usdt0.to) on Plasma (chain ID 9745) via EIP-3009 `transferWithAuthorization`. Wallets are managed by [WDK](https://docs.wallet.tether.io). The [x402](https://www.x402.org/) protocol handles the HTTP payment negotiation.

**Stack:** WDK (wallet signing + key management) | USDT0 (payment token) | Plasma (settlement chain) | x402 (HTTP payment protocol)

### Upstream Projects

**[baghdadgherras/x402-usdt0](https://github.com/baghdadgherras/x402-usdt0)** — The base this project extends. Implements the standard x402 payment flow on Plasma using the official `@x402/*` SDK and WDK packages (`@tetherto/wdk-wallet-evm`). Client pays, server verifies the EIP-3009 signature, settlement happens on-chain. Clean baseline — no additional verification layer.

**[SemanticPay/wdk-wallet-evm-x402-facilitator](https://github.com/SemanticPay/wdk-wallet-evm-x402-facilitator)** — Adapter used by x402-usdt0 to bridge Tether WDK wallets (`WalletAccountEvm`) to the x402 `FacilitatorEvmSigner` interface. This project follows the same adapter pattern in `wdk/facilitator-adapter.js` (implemented with plain ethers.js rather than the full WDK initialization stack). Settlement uses `eip3009ABI` and `authorizationTypes` from `@x402/evm` to call `transferWithAuthorization` on USDT0.

**What this project adds:** A cryptographically verified spending guardrail for autonomous agent payments. The x402 middleware was reimplemented (rather than wrapping `@x402/express`) because the ZK proof binding check must run *inside* the payment verification path — it's not an optional add-on, it's a guardrail that every agent payment must pass through. Every USDT0 payment carries a zkML proof that an ML model evaluated the agent's transaction against spending policy (amount, recipient, chain, token). The proof is cryptographically bound to the payment via SHA-256 — tamper with any parameter and the cryptographic guardrail rejects it. Agents spend autonomously; users verify the proof instead of trusting any single party. Three attack scenarios demonstrate this in real-time.

## What This Does

Trustless agentic commerce — agents pay for APIs autonomously while every payment is cryptographically verified against spending policy. A weather API charges 0.0001 USDT0 per request using the x402 payment protocol. Every agent payment must pass through a cryptographically verified spending guardrail — an ML model running inside a [Jolt-Atlas](https://github.com/ICME-Lab/jolt-atlas) zkVM evaluates the transaction against the agent's spending policy and produces a cryptographic proof that the evaluation actually happened. The proof is bound to the payment amount, recipient, Plasma chain ID, and USDT0 token address — change any of these and the cryptographic guardrail rejects the payment.

```
Agent                          Server                        Cosigner (Rust)
  |                              |                              |
  |-- GET /weather -->           |                              |
  |<-- 402 + requirements --     |                              |
  |                              |                              |
  | [generate zkML proof via     |                              |
  |  Jolt-Atlas zkVM (~6s)]      |                              |
  | [sign EIP-3009 payment]      |                              |
  |                              |                              |
  |-- GET /weather ---------->   |                              |
  |   X-Payment: {sig}           |                              |
  |   X-ZK-Proof: {proof}        |                              |
  |                              |                              |
  |                [1. verify payment sig]                      |
  |                [2. check proof binding vs spending policy]  |
  |                              |-- POST /verify -->           |
  |                              |<-- approved:true --          |
  |                              |                              |
  |<-- 200 + weather data --     |                              |
```

Two gates must pass: (1) payment signature is valid, (2) agent spending policy — ZK proof binding matches payment parameters. If either fails, the agent's request is rejected.

## How It Works (Plain English)

A weather API charges a tiny fee (0.0001 USDT0) for every request using the HTTP 402 payment protocol. An AI agent pays autonomously, but every payment must pass through a cryptographically verified spending guardrail — a cryptographic proof that an ML model evaluated the agent's transaction against spending policy, verifiable by anyone without trusting the server.

Here's what happens:

1. **Agent asks for weather data.** The server replies "402 Payment Required" — pay 0.0001 USDT0 to this address on Plasma.

2. **Agent generates a live zkML proof.** The [Jolt-Atlas](https://github.com/ICME-Lab/jolt-atlas) zkVM prover runs an ONNX ML model that evaluates the agent's spending policy (~6s on first run, cached for subsequent scenarios). It says "the model evaluated the agent's spending policy and said AUTHORIZED." Critically, the proof is cryptographically bound to the exact payment parameters — the amount, recipient, chain, and token. Change any of these and the proof becomes invalid.

3. **Agent signs a payment and retries the request,** attaching both the payment signature and the ZK proof as HTTP headers (`X-Payment` and `X-ZK-Proof`).

4. **The server checks two gates:**
   - **Gate 1 (payment):** Is the payment signature valid and for the right amount?
   - **Gate 2 (agent spending policy):** Does the ZK proof binding match these exact payment parameters? The server recomputes a SHA-256 hash over the payment details and compares it to the hash embedded in the proof. If a compromised API inflates the price from 0.0001 to 10 USDT0, the hashes won't match — the cryptographic guardrail rejects the payment before anything touches the blockchain.

5. **If both gates pass,** the server forwards the proof to the cosigner (a Rust zkML verifier) for deeper verification that the ML model genuinely ran and approved.

6. **Only then does the server return the weather data to the agent.**

The demo runs three scenarios to show the cryptographic guardrail protecting agent payments: a normal flow (agent pays within policy, succeeds), a tampered amount (compromised API inflates price, rejected), and a tampered recipient (man-in-the-middle redirects payment, rejected). A React dashboard visualizes every step in real-time.

## Attack Scenarios

Three demo scenarios show the cryptographic guardrail protecting agent payments:

| Scenario | What Happens | Result |
|----------|-------------|--------|
| **Normal** | Agent pays within spending policy — proof and params match | 200 OK |
| **Tampered Amount** | Compromised API inflates price from 0.0001 to 10 USDT0 | 403 — Amount mismatch |
| **Tampered Recipient** | Man-in-the-middle redirects agent payment to `0xdead...` | 403 — Recipient mismatch |

All three use the same zkML proof (generated live on first run, cached for subsequent scenarios). The attack scenarios reuse the proof but send different payment parameters — the cryptographic guardrail catches the mismatch before anything reaches the cosigner or the chain. Agents spend autonomously; the authorization is trustless and verifiable by anyone.

## What's Real in This Demo

Every step in the demo pipeline is real — no simulated delays, no hardcoded timers, no pre-baked responses:

| Component | What Happens |
|-----------|-------------|
| **Jolt-Atlas zkVM prover** | Real ONNX model runs inside the [Jolt-Atlas](https://github.com/ICME-Lab/jolt-atlas) zkVM (~6s first run, cached after) |
| **HTTP 402 flow** | Real `GET /weather` returns 402, real retry with `X-Payment` + `X-ZK-Proof` headers |
| **Cosigner verification** | Real Rust SNARK verifier confirms the proof |
| **SHA-256 binding check** | Real binding recomputation in the middleware |
| **EIP-3009 settlement** | Real `transferWithAuthorization` on Plasma — watch balances change |
| **SSE-driven UI** | Dashboard reacts to real server events — no fixed dwells or timers |

The dashboard is event-driven: the prover node lights up when proof generation starts, and each subsequent step fires only when the server broadcasts the corresponding event.

## Project Structure

```
x402-jolt-usdt0/
├── package.json
├── .env.example
├── x402/
│   ├── config.js              # Network, token, pricing, paths
│   ├── server.js              # Express server + SSE + demo endpoints
│   ├── middleware.js           # ZK-402 agent spending policy middleware
│   ├── client.js              # CLI agent client for testing scenarios
│   └── facilitator.js         # Standalone facilitator service
├── zk/
│   ├── proof-binding.js       # Agent spending policy: SHA-256 binding of proof to payment params
│   ├── proof-cache.js         # Filesystem cache for pre-generated proofs
│   ├── prover-bridge.js       # JS → Rust prover binary
│   ├── cosigner-bridge.js     # JS → Rust cosigner HTTP
│   └── scenarios.js           # Three attack scenarios (agent spending policy demo)
├── wdk/
│   ├── facilitator-adapter.js # FacilitatorEvmSigner adapter (follows SemanticPay pattern)
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

## The ML Model (Agent Spending Policy)

The agent spending policy uses a real trained neural network (not a stub):

| Property | Value |
|----------|-------|
| Format | ONNX (12 KB) |
| Architecture | 3 fully connected layers with ReLU activations |
| Input | 64 features (one-hot encoded from 7 transaction attributes) |
| Output | 2 classes — AUTHORIZED (class 0) or DENIED (class 1) |
| Trained with | PyTorch, exported via `torch.onnx.export` |

**Input features** (mapped via `vocab.json`):

| Feature | Range | What it captures |
|---------|-------|-----------------|
| `budget` | 0–15 | User's remaining budget tier |
| `trust` | 0–7 | Trust score for the recipient |
| `amount` | 0–15 | Transaction amount category |
| `category` | 0–3 | Spending category |
| `velocity` | 0–7 | Recent transaction frequency |
| `day` | 0–7 | Day of week |
| `time` | 0–3 | Time of day bucket |

The prover runs this model inside a [Jolt-Atlas](https://github.com/ICME-Lab/jolt-atlas) zkVM and produces a zkML proof that the model genuinely executed and produced AUTHORIZED for the given agent transaction inputs. The cosigner independently verifies the proof by checking the zkML proof against pre-computed verification parameters and confirming the model hash (SHA-256 of the ONNX file) matches.

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
| `MNEMONIC` | Yes | BIP-39 seed phrase for the agent wallet (pays for requests) |
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

### 3. Generate proof cache (optional pre-warming)

The demo generates proofs live via the [Jolt-Atlas](https://github.com/ICME-Lab/jolt-atlas) zkVM prover (~6s on first scenario, then cached). You can optionally pre-warm the cache to skip the first proof generation:

```bash
npm run generate-cache
```

This will produce three files in `cache/proofs/`:
- `normal.json` — proof with matching payment params
- `tampered_amount.json` — same proof (attack differentiation at runtime)
- `tampered_recipient.json` — same proof (attack differentiation at runtime)

If you skip this step, the first scenario will generate the proof live and cache it automatically.

### 4. Fund the agent wallet

The agent wallet (derived from `MNEMONIC`) needs **USDT0** and a small amount of **XPL** (gas) on Plasma.

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

The cosigner runs on port 3001 and verifies zkML proofs.

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
- Autoplay through 3 scenarios (Normal, Tampered Amount, Tampered Recipient)
- Prominent scenario banner showing current scenario name, description, and expected outcome
- Live proving card with elapsed timer during real Jolt-Atlas zkVM proof generation
- Event-driven pipeline visualization (SSE — no hardcoded timers)
- Side-by-side binding comparison table for attack scenarios
- Real-time Plasma balance updates

### Run both together

```bash
npm run dev
```

### Test with the CLI agent

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

## How the Cryptographic Guardrail Works

The agent spending policy is enforced as a SHA-256 binding hash over `amount|payTo|chainId|token|proofHash`. Both the agent and server compute this independently — making verification trustless.

```
Agent generates proof for:           Agent sends payment for:
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

The cryptographic guardrail catches this before the cosigner is ever contacted — the agent's payment is blocked.

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

- [x] **Fund agent wallet** — Send USDT0 to the agent address on Plasma (or switch to Sepolia for testing)
- [ ] **Generate proof cache** — Run `npm run generate-cache` (runs the prover binary, ~10-30 min one-time)
- [x] **EIP-3009 signing** — Agent signs EIP-712 `TransferWithAuthorization`; demo flow uses `@x402/evm` types
- [x] **On-chain settlement** — Facilitator submits `transferWithAuthorization` on-chain via `@x402/evm` ABI
- [ ] **Payment signature verification** — Add full EIP-712 signature recovery and verification in `middleware.js` (currently checks structure only)

### Should Have

- [ ] **Proof expiry** — Add TTL to cached proofs so stale proofs are rejected
- [ ] **Replay protection** — Track used proof binding hashes to prevent proof reuse
- [ ] **Rate limiting** — Add per-agent rate limiting on the server
- [ ] **Error recovery in dashboard** — Handle SSE reconnection and server restart gracefully
- [ ] **HTTPS** — Add TLS termination for production deployment
- [ ] **Facilitator integration test** — End-to-end test: agent → server → cosigner → on-chain settlement

### Nice to Have

- [ ] **Multi-model support** — Allow different ONNX models for different risk tiers
- [ ] **Webhook notifications** — Notify external systems on payment verification events
- [ ] **Proof compression** — Compress proofs before base64 encoding to reduce header size
- [ ] **Batch payments** — Support multiple payments per proof for bulk API access
- [ ] **Dashboard auth** — Protect the demo dashboard in production
- [ ] **Monitoring** — Add Prometheus metrics for proof verification latency, success rates

## License

MIT
