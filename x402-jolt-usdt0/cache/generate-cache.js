import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runProver } from '../zk/prover-bridge.js';
import { USDT0_ADDRESS, CHAIN_ID, PAY_TO_ADDRESS } from '../x402/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROOFS_DIR = resolve(__dirname, 'proofs');

if (!existsSync(PROOFS_DIR)) {
  mkdirSync(PROOFS_DIR, { recursive: true });
}

const features = {
  budget: 15,
  trust: 7,
  amount: 8,
  category: 0,
  velocity: 2,
  day: 1,
  time: 1,
};

const paymentParams = {
  amount: 100,
  payTo: PAY_TO_ADDRESS,
  chainId: CHAIN_ID,
  token: USDT0_ADDRESS,
};

async function main() {
  console.log('=== ZK-402 Proof Cache Generator ===\n');
  console.log('Payment params:', JSON.stringify(paymentParams));
  console.log('Features:', JSON.stringify(features));
  console.log('\nGenerating proof (this will run the prover binary)...\n');

  // Generate ONE proof — all scenarios reuse it
  const result = runProver(features, paymentParams, { useCache: false });

  console.log(`\nDecision: ${result.decision}`);
  console.log(`Model hash: ${result.model_hash}`);
  console.log(`Proof size: ${(result.proof || '').length} chars`);
  console.log(`Binding hash: ${result.payment_binding?.binding_hash}`);

  // Save as normal.json
  const normalPath = resolve(PROOFS_DIR, 'normal.json');
  writeFileSync(normalPath, JSON.stringify(result, null, 2));
  console.log(`\nSaved: ${normalPath}`);

  // Copy to tampered scenarios — same proof, attack differentiation happens at runtime
  const tamperedAmountPath = resolve(PROOFS_DIR, 'tampered_amount.json');
  const tamperedRecipientPath = resolve(PROOFS_DIR, 'tampered_recipient.json');
  copyFileSync(normalPath, tamperedAmountPath);
  copyFileSync(normalPath, tamperedRecipientPath);
  console.log(`Copied: ${tamperedAmountPath}`);
  console.log(`Copied: ${tamperedRecipientPath}`);

  console.log('\nCache generation complete.');
}

main().catch((err) => {
  console.error('Cache generation failed:', err.message);
  process.exit(1);
});
