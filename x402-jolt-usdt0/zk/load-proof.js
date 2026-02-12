import { createHash } from 'crypto';
import { getScenarioProof } from './proof-cache.js';
import { createPaymentBinding } from './proof-binding.js';

/**
 * Load a scenario proof and create the payment + zkProof objects
 * ready for use as x402 headers.
 *
 * @param {string} scenarioName - Scenario key (e.g. 'normal')
 * @param {object} paymentParams - { amount, payTo, chainId, token }
 * @returns {{ payment: object, zkProof: object, proofData: object }}
 */
export function loadScenarioProofWithBinding(scenarioName, paymentParams) {
  const proofData = getScenarioProof(scenarioName);
  const proofHash = createHash('sha256').update(proofData.proof || '').digest('hex');
  const binding = createPaymentBinding(paymentParams, proofHash);

  const payment = {
    signature: '0x' + 'ab'.repeat(65),
    amount: paymentParams.amount,
    payTo: paymentParams.payTo,
    chainId: paymentParams.chainId,
    token: paymentParams.token,
  };

  const zkProof = {
    proof: proofData.proof,
    program_io: proofData.program_io,
    decision: proofData.decision,
    model_hash: proofData.model_hash,
    payment_binding: binding,
  };

  return { payment, zkProof, proofData };
}
