import 'dotenv/config';
import { createHash, randomBytes } from 'crypto';
import { ethers } from 'ethers';
import {
  USDT0_ADDRESS, CHAIN_ID, NETWORK, PRICE_USDT0,
  PAY_TO_ADDRESS, SERVER_PORT, MNEMONIC,
} from './config.js';
import { scenarios } from '../zk/scenarios.js';
import { getScenarioProof } from '../zk/proof-cache.js';
import { createPaymentBinding } from '../zk/proof-binding.js';

const SCENARIO = process.env.SCENARIO || 'normal';
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

async function main() {
  const scenario = scenarios[SCENARIO];
  if (!scenario) {
    console.error(`Unknown scenario: ${SCENARIO}`);
    console.error(`Available: ${Object.keys(scenarios).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n  ZK-402 Client`);
  console.log(`  Scenario:  ${scenario.name}`);
  console.log(`  Expected:  ${scenario.expectedOutcome}`);
  console.log();

  // Step 1: Request the protected resource (no payment)
  console.log('[Client] GET /weather (no payment)...');
  const initialResp = await fetch(`${SERVER_URL}/weather`);

  if (initialResp.status !== 402) {
    console.log(`[Client] Unexpected status: ${initialResp.status}`);
    const body = await initialResp.text();
    console.log(body);
    return;
  }

  const requirements = await initialResp.json();
  console.log(`[Client] Got 402 — Payment required:`);
  console.log(`  Amount: ${requirements.x402.accepts[0].maxAmountRequired}`);
  console.log(`  Asset:  ${requirements.x402.accepts[0].asset}`);
  console.log(`  PayTo:  ${requirements.x402.accepts[0].payTo}`);
  console.log(`  zkML:   ${requirements.x402.accepts[0].extra?.zkmlRequired ? 'required' : 'not required'}`);

  // Step 2: Load cached proof
  console.log(`\n[Client] Loading cached proof for scenario "${SCENARIO}"...`);
  let proofData;
  try {
    proofData = getScenarioProof(SCENARIO);
  } catch {
    // Attack scenarios use the same proof as normal
    proofData = getScenarioProof('normal');
  }
  console.log(`[Client] Proof loaded. Decision: ${proofData.decision}, model_hash: ${proofData.model_hash?.slice(0, 16)}...`);

  // Step 3: Create binding from proof's payment params
  const proofHash = createHash('sha256').update(proofData.proof || '').digest('hex');
  const binding = createPaymentBinding(scenario.proofPaymentParams, proofHash);
  console.log(`[Client] Binding created: hash=${binding.binding_hash.slice(0, 16)}...`);

  // Step 4: Sign payment with actual (potentially tampered) params
  const wallet = ethers.Wallet.fromPhrase(MNEMONIC);
  console.log(`[Client] Wallet address: ${wallet.address}`);

  const payment = {
    signature: await wallet.signMessage(
      `x402:${scenario.actualPaymentParams.amount}:${scenario.actualPaymentParams.payTo}:${CHAIN_ID}`
    ),
    amount: scenario.actualPaymentParams.amount,
    payTo: scenario.actualPaymentParams.payTo,
    chainId: scenario.actualPaymentParams.chainId,
    token: scenario.actualPaymentParams.token,
    from: wallet.address,
    nonce: '0x' + randomBytes(32).toString('hex'),
  };

  const zkProof = {
    proof: proofData.proof,
    program_io: proofData.program_io,
    decision: proofData.decision,
    model_hash: proofData.model_hash,
    payment_binding: binding,
  };

  // Step 5: Retry with payment + proof headers
  const paymentHeader = Buffer.from(JSON.stringify(payment)).toString('base64');
  const zkProofHeader = Buffer.from(JSON.stringify(zkProof)).toString('base64');

  console.log(`\n[Client] GET /weather with X-Payment (${paymentHeader.length}B) + X-ZK-Proof (${zkProofHeader.length}B)...`);

  const resp = await fetch(`${SERVER_URL}/weather`, {
    headers: {
      'X-Payment': paymentHeader,
      'X-ZK-Proof': zkProofHeader,
    },
  });

  console.log(`\n[Client] Response: ${resp.status}`);
  const body = await resp.json();
  console.log(JSON.stringify(body, null, 2));

  if (resp.status === 200) {
    console.log('\n  Result: ACCESS GRANTED');
  } else if (resp.status === 403) {
    console.log(`\n  Result: BLOCKED — ${body.reason}`);
  } else {
    console.log(`\n  Result: Unexpected status ${resp.status}`);
  }
}

main().catch(console.error);
