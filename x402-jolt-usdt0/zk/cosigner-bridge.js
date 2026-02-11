import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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

  // Write payload to temp file (Node.js fetch has issues with large payloads)
  const tmpFile = join(tmpdir(), `cosigner_req_${Date.now()}.json`);
  writeFileSync(tmpFile, body);

  try {
    const output = execSync(
      `curl -s -X POST "${COSIGNER_URL}/verify" -H "Content-Type: application/json" --max-time 300 -d @${tmpFile}`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const result = JSON.parse(output.trim());
    console.log(`[Cosigner] Response: approved=${result.approved}${result.reason ? `, reason=${result.reason}` : ''}`);
    return result;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}
