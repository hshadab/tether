import { createHash } from 'crypto';
import { ethers } from 'ethers';
import { getScenarioProof } from './proof-cache.js';
import { createPaymentBinding } from './proof-binding.js';
import { signTransferAuthorization } from '../x402/signing.js';
import { MNEMONIC } from '../x402/config.js';

/**
 * Load a scenario proof and create the payment + zkProof objects
 * ready for use as x402 headers.
 *
 * Uses real EIP-712 signing (TransferWithAuthorization) for the payment signature.
 *
 * @param {string} scenarioName - Scenario key (e.g. 'normal')
 * @param {object} paymentParams - { amount, payTo, chainId, token }
 * @returns {Promise<{ payment: object, zkProof: object, proofData: object }>}
 */
export async function loadScenarioProofWithBinding(scenarioName, paymentParams) {
  const proofData = getScenarioProof(scenarioName);
  const proofHash = createHash('sha256').update(proofData.proof || '').digest('hex');
  const binding = createPaymentBinding(paymentParams, proofHash);

  const wallet = ethers.Wallet.fromPhrase(MNEMONIC);
  const { authorization, signature } = await signTransferAuthorization(
    wallet,
    paymentParams.payTo,
    paymentParams.amount,
  );

  const payment = {
    signature,
    authorization,
    amount: paymentParams.amount,
    payTo: paymentParams.payTo,
    chainId: paymentParams.chainId,
    token: paymentParams.token,
    from: wallet.address,
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
