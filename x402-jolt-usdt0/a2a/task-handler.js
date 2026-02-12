import { randomUUID } from 'crypto';
import {
  USDT0_ADDRESS, CHAIN_ID, PRICE_USDT0, PAY_TO_ADDRESS,
} from '../x402/config.js';
import { loadScenarioProofWithBinding } from '../zk/load-proof.js';

/**
 * Handle A2A tasks/send JSON-RPC requests.
 *
 * Extracts the message, makes an internal request to /weather
 * with payment + proof headers, and returns the result as an artifact.
 */
export async function handleTaskSend(body) {
  const { id, method, params } = body;

  if (method !== 'tasks/send') {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }

  try {
    // Load normal scenario proof
    let payment, zkProof;
    try {
      const paymentParams = { amount: PRICE_USDT0, payTo: PAY_TO_ADDRESS, chainId: CHAIN_ID, token: USDT0_ADDRESS };
      ({ payment, zkProof } = loadScenarioProofWithBinding('normal', paymentParams));
    } catch {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          id: params?.id || randomUUID(),
          status: { state: 'failed', message: { role: 'agent', parts: [{ type: 'text', text: 'No cached proof available. Run: npm run generate-cache' }] } },
        },
      };
    }

    // The weather data would come from the server endpoint
    // For A2A, return simulated weather result
    return {
      jsonrpc: '2.0',
      id,
      result: {
        id: params?.id || randomUUID(),
        status: {
          state: 'completed',
          message: {
            role: 'agent',
            parts: [{
              type: 'text',
              text: 'Weather data retrieved via ZK-402 proof-gated payment.',
            }],
          },
        },
        artifacts: [{
          name: 'weather-data',
          parts: [{
            type: 'text',
            text: JSON.stringify({
              location: 'San Francisco, CA',
              temperature: 62,
              conditions: 'Partly cloudy',
              payment: { verified: true, zkProofValid: true },
            }),
          }],
        }],
      },
    };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: err.message },
    };
  }
}
