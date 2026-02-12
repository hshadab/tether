import { createHash } from 'crypto';

/**
 * Create a binding between a ZK proof and payment parameters.
 * The binding hash ensures the proof was generated for these exact payment params.
 */
export function createPaymentBinding({ amount, payTo, chainId, token }, proofHash) {
  const preimage = `${amount}|${payTo}|${chainId}|${token}|${proofHash}`;
  const binding_hash = createHash('sha256').update(preimage).digest('hex');
  return { amount, payTo, chainId, token, binding_hash };
}

/**
 * Verify that a payment binding matches the given payment parameters and proof hash.
 * Returns { valid, reason? }.
 */
export function verifyPaymentBinding(binding, paymentParams, proofHash) {
  if (binding.amount !== paymentParams.amount) {
    return { valid: false, reason: `Amount mismatch: proof bound to ${binding.amount}, payment requests ${paymentParams.amount}` };
  }
  if (binding.payTo.toLowerCase() !== paymentParams.payTo.toLowerCase()) {
    return { valid: false, reason: `Recipient mismatch: proof bound to ${binding.payTo}, payment requests ${paymentParams.payTo}` };
  }
  if (binding.chainId !== paymentParams.chainId) {
    return { valid: false, reason: `Chain ID mismatch: proof bound to ${binding.chainId}, payment requests ${paymentParams.chainId}` };
  }
  if (binding.token.toLowerCase() !== paymentParams.token.toLowerCase()) {
    return { valid: false, reason: `Token mismatch: proof bound to ${binding.token}, payment requests ${paymentParams.token}` };
  }

  // Recompute binding hash
  const preimage = `${binding.amount}|${binding.payTo}|${binding.chainId}|${binding.token}|${proofHash}`;
  const expectedHash = createHash('sha256').update(preimage).digest('hex');
  if (binding.binding_hash !== expectedHash) {
    return { valid: false, reason: 'Binding hash integrity check failed' };
  }

  return { valid: true };
}
