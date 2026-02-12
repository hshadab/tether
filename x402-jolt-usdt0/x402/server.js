import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { randomBytes } from 'crypto';
import { ethers } from 'ethers';
import { eip3009ABI, authorizationTypes } from '@x402/evm';
import {
  USDT0_ADDRESS, CHAIN_ID, NETWORK, NETWORK_NAME,
  PRICE_USDT0, PAY_TO_ADDRESS, SERVER_PORT, COSIGNER_URL,
  RPC_URL, MNEMONIC,
} from './config.js';
import { createZk402Middleware } from './middleware.js';
import { STEPS } from '../shared/event-steps.js';
import { scenarios } from '../zk/scenarios.js';
import { runProverAsync } from '../zk/prover-bridge.js';
import { getAgentCard } from '../a2a/agent-card.js';
import { handleTaskSend } from '../a2a/task-handler.js';

// --- x402 EIP-3009 settlement (TransferWithAuthorization) ---

const EIP712_DOMAIN = {
  name: 'USDT0',
  version: '1',
  chainId: CHAIN_ID,
  verifyingContract: USDT0_ADDRESS,
};

/**
 * Client signs an EIP-712 TransferWithAuthorization message.
 * Returns the authorization object + signature.
 */
async function signTransferAuthorization(clientWallet, to, value) {
  const nonce = '0x' + randomBytes(32).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: clientWallet.address,
    to,
    value: String(value),
    validAfter: String(now - 600),
    validBefore: String(now + 3600),
    nonce,
  };

  const signature = await clientWallet.signTypedData(
    EIP712_DOMAIN,
    authorizationTypes,
    authorization,
  );

  return { authorization, signature };
}

/**
 * Facilitator submits the signed transferWithAuthorization on-chain.
 * Uses the facilitator wallet (from MNEMONIC) to pay gas.
 */
async function settleX402(authorization, signature) {
  if (!MNEMONIC) throw new Error('No MNEMONIC configured — cannot settle on-chain');
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const facilitator = ethers.Wallet.fromPhrase(MNEMONIC).connect(provider);
  const usdt0 = new ethers.Contract(USDT0_ADDRESS, eip3009ABI, facilitator);

  const sig = ethers.Signature.from(signature);
  const tx = await usdt0.transferWithAuthorization(
    authorization.from,
    authorization.to,
    BigInt(authorization.value),
    BigInt(authorization.validAfter),
    BigInt(authorization.validBefore),
    authorization.nonce,
    sig.v,
    sig.r,
    sig.s,
  );
  const receipt = await tx.wait();
  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    from: authorization.from,
    to: authorization.to,
    value: authorization.value,
    facilitator: facilitator.address,
    method: 'transferWithAuthorization (EIP-3009)',
  };
}

const app = express();
app.use(cors());
app.use(express.json());

// --- SSE ---

const sseClients = [];

function broadcast(event) {
  const payload = {
    ...event,
    timestamp: Date.now(),
  };
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    client.write(data);
  }
}

app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(`data: ${JSON.stringify({ step: 'connected', title: 'Connected', description: 'SSE stream established.', actor: 'Server', status: 'success', timestamp: Date.now() })}\n\n`);

  sseClients.push(res);
  req.on('close', () => {
    const idx = sseClients.indexOf(res);
    if (idx >= 0) sseClients.splice(idx, 1);
  });
});

// --- ZK-402 protected endpoint ---

const zk402 = createZk402Middleware({
  amount: PRICE_USDT0,
  payTo: PAY_TO_ADDRESS,
  chainId: CHAIN_ID,
  token: USDT0_ADDRESS,
  network: NETWORK,
  broadcast,
});

app.get('/weather', zk402, (req, res) => {
  const weatherData = {
    location: 'San Francisco, CA',
    temperature: 62,
    unit: 'fahrenheit',
    conditions: 'Partly cloudy',
    humidity: 68,
    wind: { speed: 12, direction: 'WSW' },
    forecast: 'Clearing skies expected by evening',
    timestamp: new Date().toISOString(),
    payment: {
      amount: PRICE_USDT0,
      token: USDT0_ADDRESS,
      network: NETWORK,
      verified: true,
      zkProofValid: true,
    },
  };

  res.json(weatherData);
});

// --- Demo endpoints ---

app.post('/demo/start-flow', async (req, res) => {
  const { scenario: scenarioName = 'normal' } = req.body;
  const scenario = scenarios[scenarioName];

  if (!scenario) {
    return res.status(400).json({ error: `Unknown scenario: ${scenarioName}` });
  }

  // 1. Reset
  broadcast({
    step: STEPS.FLOW_RESET,
    title: 'Flow Reset',
    description: `Starting ${scenario.name} scenario.`,
    actor: 'Client',
    status: 'info',
    details: { scenario: scenarioName, description: scenario.description, expectedOutcome: scenario.expectedOutcome },
  });

  try {
    // 2. Generate zkML proof (real async prover)
    broadcast({
      step: STEPS.PROOF_GENERATING,
      title: 'Generating zkML Proof',
      description: 'Running ONNX model inside Jolt zkVM...',
      actor: 'Client',
      status: 'pending',
      details: { features: scenario.features, scenarioName },
    });

    const proofData = await runProverAsync(
      scenario.features,
      scenario.proofPaymentParams,
      { useCache: true },
    );

    // 3. Broadcast proof received with metadata
    broadcast({
      step: STEPS.PROOF_RECEIVED,
      title: proofData.fromCache ? 'ZK Proof Loaded (Cached)' : 'ZK Proof Generated',
      description: proofData.fromCache
        ? `Client loaded cached proof, decision: ${proofData.decision}`
        : `Proof generated in ${proofData.elapsed}ms, decision: ${proofData.decision}`,
      actor: 'Client',
      status: 'success',
      details: {
        decision: proofData.decision,
        model_hash: proofData.model_hash,
        proofSize: (proofData.proof || '').length,
        fromCache: proofData.fromCache,
        elapsed: proofData.elapsed,
        scenarioName,
      },
    });

    // 4. Sign EIP-3009 TransferWithAuthorization for actual (potentially tampered) params
    const clientWallet = ethers.Wallet.fromPhrase(MNEMONIC);
    const { authorization, signature: authSignature } = await signTransferAuthorization(
      clientWallet,
      scenario.actualPaymentParams.payTo,
      scenario.actualPaymentParams.amount,
    );

    const payment = {
      signature: authSignature,
      authorization,
      amount: scenario.actualPaymentParams.amount,
      payTo: scenario.actualPaymentParams.payTo,
      chainId: scenario.actualPaymentParams.chainId,
      token: scenario.actualPaymentParams.token,
      from: clientWallet.address,
    };

    const zkProof = {
      proof: proofData.proof,
      program_io: proofData.program_io,
      decision: proofData.decision,
      model_hash: proofData.model_hash,
      payment_binding: proofData.payment_binding,
    };

    // 5. Real HTTP GET /weather (no headers) → expect 402
    const baseUrl = `http://localhost:${SERVER_PORT}`;
    const bare = await fetch(`${baseUrl}/weather`);
    if (bare.status !== 402) {
      console.warn(`[Demo] Expected 402 from /weather, got ${bare.status}`);
    }
    // (middleware broadcasts payment_required via SSE automatically)

    // 6. Real HTTP GET /weather with payment + proof + defer-completion headers
    const paymentHeader = Buffer.from(JSON.stringify(payment)).toString('base64');
    const zkProofHeader = Buffer.from(JSON.stringify(zkProof)).toString('base64');

    const paidResp = await fetch(`${baseUrl}/weather`, {
      headers: {
        'X-Payment': paymentHeader,
        'X-ZK-Proof': zkProofHeader,
        'X-Defer-Completion': '1',
      },
    });

    // 7. Handle result
    if (!paidResp.ok) {
      // Middleware already broadcast failure events (zkml_proof_rejected, verify_completed on failure path)
      // But for 403 from binding mismatch the middleware broadcasts verify_completed itself
      // unless deferred — since we defer, we need to broadcast verify_completed for failures too
      const errBody = await paidResp.json().catch(() => ({}));

      broadcast({
        step: STEPS.VERIFY_COMPLETED,
        title: 'Verification Failed',
        description: `Attack blocked: ${errBody.reason || paidResp.statusText}`,
        actor: 'Server',
        status: 'failure',
      });

      return res.json({ success: false, reason: errBody.reason || paidResp.statusText, scenario: scenarioName });
    }

    // 8. Success path: settle on-chain, then broadcast completion
    let settlement = null;
    try {
      broadcast({
        step: STEPS.SETTLEMENT_PENDING,
        title: 'Settling on Plasma…',
        description: `Submitting transferWithAuthorization for ${PRICE_USDT0} units USDT0.`,
        actor: 'Plasma',
        status: 'info',
      });

      settlement = await settleX402(authorization, authSignature);
      broadcast({
        step: STEPS.SETTLEMENT_COMPLETED,
        title: 'x402 USDT0 Settlement',
        description: `${PRICE_USDT0} units USDT0 settled via transferWithAuthorization on Plasma.`,
        actor: 'Plasma',
        status: 'success',
        details: settlement,
      });
      console.log(`[x402 Settlement] TX confirmed: ${settlement.txHash} (EIP-3009 transferWithAuthorization)`);
    } catch (err) {
      broadcast({
        step: STEPS.SETTLEMENT_COMPLETED,
        title: 'Settlement Failed',
        description: `x402 settlement failed: ${err.message}`,
        actor: 'Plasma',
        status: 'failure',
        details: { error: err.message },
      });
      console.error(`[x402 Settlement] Failed: ${err.message}`);
    }

    broadcast({
      step: STEPS.VERIFY_COMPLETED,
      title: 'Verification & Settlement Complete',
      description: settlement?.txHash
        ? `All gates passed. ${PRICE_USDT0} units USDT0 settled on Plasma.`
        : 'All gates passed. Settlement attempted.',
      actor: 'Server',
      status: 'success',
      details: settlement ? { txHash: settlement.txHash } : undefined,
    });

    res.json({ success: true, scenario: scenarioName, settlement });
  } catch (err) {
    broadcast({
      step: 'flow_error',
      title: 'Flow Error',
      description: err.message,
      actor: 'Server',
      status: 'failure',
      details: { error: err.message },
    });
    res.status(500).json({ error: err.message });
  }
});

app.post('/demo/reset', (req, res) => {
  broadcast({
    step: STEPS.FLOW_RESET,
    title: 'Flow Reset',
    description: 'Timeline cleared.',
    actor: 'Server',
    status: 'info',
  });
  res.json({ success: true });
});

app.get('/demo/status', (req, res) => {
  const clientWallet = MNEMONIC ? ethers.Wallet.fromPhrase(MNEMONIC) : null;
  res.json({
    connectedClients: sseClients.length,
    serverAddress: PAY_TO_ADDRESS,
    network: NETWORK_NAME,
    chainId: CHAIN_ID,
    token: USDT0_ADDRESS,
    cosignerUrl: COSIGNER_URL,
    explorerUrl: RPC_URL.includes('sepolia') ? 'https://sepolia.etherscan.io' : 'https://plasmascan.to',
    rpcUrl: RPC_URL,
    clientAddress: clientWallet?.address || '',
    price: PRICE_USDT0,
  });
});

// --- A2A ---

app.get('/.well-known/agent.json', (req, res) => {
  res.json(getAgentCard(req));
});

app.post('/a2a/tasks/send', async (req, res) => {
  const result = await handleTaskSend(req.body);
  res.json(result);
});

// --- Health ---

app.get('/health', async (req, res) => {
  let cosignerStatus = 'unknown';
  try {
    const resp = await fetch(`${COSIGNER_URL}/health`);
    cosignerStatus = resp.ok ? 'healthy' : 'unhealthy';
  } catch {
    cosignerStatus = 'unreachable';
  }

  res.json({
    status: 'ok',
    network: NETWORK_NAME,
    chainId: CHAIN_ID,
    token: USDT0_ADDRESS,
    payTo: PAY_TO_ADDRESS,
    price: PRICE_USDT0,
    cosigner: { url: COSIGNER_URL, status: cosignerStatus },
    sseClients: sseClients.length,
  });
});

// --- Start ---

app.listen(SERVER_PORT, () => {
  console.log(`\n  ZK-402 Server`);
  console.log(`  Network:    ${NETWORK_NAME} (${CHAIN_ID})`);
  console.log(`  Token:      ${USDT0_ADDRESS}`);
  console.log(`  Pay To:     ${PAY_TO_ADDRESS}`);
  console.log(`  Price:      ${PRICE_USDT0} (0.0001 USDT0)`);
  console.log(`  Cosigner:   ${COSIGNER_URL}`);
  console.log(`  Listening:  http://localhost:${SERVER_PORT}`);
  console.log(`  Dashboard:  http://localhost:5173`);
  console.log();
});
