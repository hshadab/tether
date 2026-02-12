import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createHash } from 'crypto';
import {
  USDT0_ADDRESS, CHAIN_ID, NETWORK, NETWORK_NAME,
  FACILITATOR_PORT, PAY_TO_ADDRESS,
} from './config.js';
import { verifyPaymentBinding } from '../zk/proof-binding.js';
import { verifyCosigner } from '../zk/cosigner-bridge.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

/**
 * POST /verify — Verify payment + ZK proof
 */
app.post('/verify', async (req, res) => {
  const { payment, zkProof } = req.body;

  if (!payment || !zkProof) {
    return res.status(400).json({ error: 'Missing payment or zkProof in request body' });
  }

  // Verify binding
  const paymentParams = {
    amount: payment.amount,
    payTo: payment.payTo,
    chainId: CHAIN_ID,
    token: USDT0_ADDRESS,
  };

  const proofHash = createHash('sha256').update(zkProof.proof || '').digest('hex');
  const bindingResult = verifyPaymentBinding(zkProof.payment_binding, paymentParams, proofHash);

  if (!bindingResult.valid) {
    return res.status(403).json({
      approved: false,
      reason: bindingResult.reason,
    });
  }

  // proof verification via cosigner
  try {
    const cosignerResult = await verifyCosigner(
      zkProof,
      { to: payment.payTo, amount: String(payment.amount), token: USDT0_ADDRESS },
      zkProof.model_hash
    );
    return res.json(cosignerResult);
  } catch (err) {
    return res.status(500).json({
      approved: false,
      reason: `Cosigner error: ${err.message}`,
    });
  }
});

/**
 * POST /settle — Execute on-chain settlement (receiveWithAuthorization)
 */
app.post('/settle', async (req, res) => {
  // Placeholder: in production this would call receiveWithAuthorization on USDT0
  const { payment, authorization } = req.body;
  console.log(`[Facilitator] Settlement requested for amount=${payment?.amount} to=${payment?.payTo}`);

  res.json({
    settled: false,
    reason: 'Settlement not yet implemented — requires funded facilitator wallet on Plasma.',
    payment,
  });
});

/**
 * GET /supported — Return supported verification schemes
 */
app.get('/supported', (req, res) => {
  res.json({
    schemes: ['exact'],
    networks: [NETWORK],
    assets: [USDT0_ADDRESS],
    zkml: true,
  });
});

/**
 * GET /health
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    facilitator: PAY_TO_ADDRESS,
    network: NETWORK_NAME,
    chainId: CHAIN_ID,
  });
});

app.listen(FACILITATOR_PORT, () => {
  console.log(`\n  ZK-402 Facilitator`);
  console.log(`  Network:    ${NETWORK_NAME} (${CHAIN_ID})`);
  console.log(`  Address:    ${PAY_TO_ADDRESS}`);
  console.log(`  Listening:  http://localhost:${FACILITATOR_PORT}`);
  console.log();
});
