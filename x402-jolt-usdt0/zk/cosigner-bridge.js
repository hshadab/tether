import { COSIGNER_URL } from '../x402/config.js';

/**
 * Submit a proof to the cosigner service for SNARK verification.
 *
 * @param {{ proof, program_io, decision, model_hash }} proofResult
 * @param {{ to, amount, token }} txDetails
 * @param {string} modelHash
 * @returns {{ approved, signature, nonce, reason }}
 */
export async function verifyCosigner(proofResult, txDetails, modelHash) {
  console.log('[Cosigner] Submitting proof for verification...');

  const body = JSON.stringify({
    proof: proofResult.proof,
    program_io: proofResult.program_io,
    tx: txDetails,
    model_hash: modelHash || proofResult.model_hash,
  });

  console.log(`[Cosigner] Request body size: ${body.length} bytes`);

  const resp = await fetch(`${COSIGNER_URL}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(300_000), // 5 minute timeout
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Cosigner returned ${resp.status}: ${text}`);
  }

  const result = await resp.json();
  console.log(`[Cosigner] Response: approved=${result.approved}${result.reason ? `, reason=${result.reason}` : ''}`);
  return result;
}
