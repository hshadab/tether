import { execFileSync, execFile } from 'child_process';
import { createHash } from 'crypto';
import { PROVER_BINARY, MODELS_DIR } from '../x402/config.js';
import { getCachedProof, cacheProof } from './proof-cache.js';
import { createPaymentBinding } from './proof-binding.js';

/**
 * Run the zkML prover binary to generate a proof.
 *
 * @param {object} features - Transaction features (budget, trust, amount, category, velocity, day, time)
 * @param {object} paymentParams - Payment parameters { amount, payTo, chainId, token }
 * @param {object} options - { useCache: boolean }
 * @returns {{ proof, program_io, decision, model_hash, payment_binding }}
 */
export function runProver(features, paymentParams, { useCache = true } = {}) {
  // Check cache first
  if (useCache) {
    const cached = getCachedProof(paymentParams, features);
    if (cached) {
      console.log('[Prover] Using cached proof');
      return cached;
    }
  }

  console.log(`[Prover] Running zkML inference for features: ${JSON.stringify(features)}`);
  const startTime = Date.now();

  const output = execFileSync(PROVER_BINARY, [JSON.stringify(features)], {
    encoding: 'utf-8',
    maxBuffer: 100 * 1024 * 1024, // 100MB
    timeout: 900_000, // 15 minutes
    env: {
      ...process.env,
      MODELS_DIR,
    },
  });

  const elapsed = Date.now() - startTime;
  console.log(`[Prover] Completed in ${elapsed}ms`);

  // Prover outputs debug info followed by JSON on the last line
  const lines = output.trim().split('\n');
  const jsonLine = lines[lines.length - 1];
  const result = JSON.parse(jsonLine);

  console.log(`[Prover] Decision: ${result.decision}`);

  // Compute proof hash and create payment binding
  const proofHash = createHash('sha256').update(result.proof).digest('hex');
  result.payment_binding = createPaymentBinding(paymentParams, proofHash);

  // Cache the result
  if (useCache) {
    cacheProof(paymentParams, features, result);
  }

  return result;
}

/**
 * Run the zkML prover binary asynchronously (non-blocking).
 *
 * @param {object} features - Transaction features (budget, trust, amount, category, velocity, day, time)
 * @param {object} paymentParams - Payment parameters { amount, payTo, chainId, token }
 * @param {object} options - { useCache: boolean }
 * @returns {Promise<{ proof, program_io, decision, model_hash, payment_binding, fromCache: boolean, elapsed: number }>}
 */
export function runProverAsync(features, paymentParams, { useCache = true } = {}) {
  // Check cache first
  if (useCache) {
    const cached = getCachedProof(paymentParams, features);
    if (cached) {
      console.log('[Prover] Using cached proof');
      return Promise.resolve({ ...cached, fromCache: true, elapsed: 0 });
    }
  }

  console.log(`[Prover] Running zkML inference (async) for features: ${JSON.stringify(features)}`);
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    execFile(
      PROVER_BINARY,
      [JSON.stringify(features)],
      {
        encoding: 'utf-8',
        maxBuffer: 100 * 1024 * 1024, // 100MB
        timeout: 900_000, // 15 minutes
        env: {
          ...process.env,
          MODELS_DIR,
        },
      },
      (err, stdout, stderr) => {
        if (err) {
          console.error(`[Prover] Async prover failed: ${err.message}`);
          if (stderr) console.error(`[Prover] stderr: ${stderr}`);
          return reject(err);
        }

        const elapsed = Date.now() - startTime;
        console.log(`[Prover] Completed in ${elapsed}ms`);

        try {
          // Prover outputs debug info followed by JSON on the last line
          const lines = stdout.trim().split('\n');
          const jsonLine = lines[lines.length - 1];
          const result = JSON.parse(jsonLine);

          console.log(`[Prover] Decision: ${result.decision}`);

          // Compute proof hash and create payment binding
          const proofHash = createHash('sha256').update(result.proof).digest('hex');
          result.payment_binding = createPaymentBinding(paymentParams, proofHash);

          // Cache the result
          if (useCache) {
            cacheProof(paymentParams, features, result);
          }

          resolve({ ...result, fromCache: false, elapsed });
        } catch (parseErr) {
          console.error(`[Prover] Failed to parse output: ${parseErr.message}`);
          reject(parseErr);
        }
      }
    );
  });
}
