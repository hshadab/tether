import { USDT0_ADDRESS, CHAIN_ID, PAY_TO_ADDRESS } from '../x402/config.js';

// Shared features for all scenarios — an authorized transaction
const SHARED_FEATURES = {
  budget: 15,
  trust: 7,
  amount: 8,
  category: 0,
  velocity: 2,
  day: 1,
  time: 1,
};

const ATTACKER_ADDRESS = '0x000000000000000000000000000000000000dEaD';

/**
 * Three attack scenarios for demonstrating ZK-402 proof binding.
 *
 * All use the same cached proof (generated for normal params).
 * Attack scenarios diverge at runtime by sending different payment params
 * while reusing the proof bound to normal params.
 */
export const scenarios = {
  normal: {
    name: 'Normal Flow',
    description: 'Legitimate payment — proof and payment params match.',
    expectedOutcome: '200 OK + weather data',
    features: SHARED_FEATURES,
    proofPaymentParams: {
      amount: 100,
      payTo: PAY_TO_ADDRESS,
      chainId: CHAIN_ID,
      token: USDT0_ADDRESS,
    },
    actualPaymentParams: {
      amount: 100,
      payTo: PAY_TO_ADDRESS,
      chainId: CHAIN_ID,
      token: USDT0_ADDRESS,
    },
  },

  tampered_amount: {
    name: 'Tampered Amount',
    description: 'Attacker inflates amount to 10 USDT0 but reuses proof bound to 0.0001 USDT0.',
    expectedOutcome: '403 Forbidden — Amount mismatch',
    features: SHARED_FEATURES,
    proofPaymentParams: {
      amount: 100,
      payTo: PAY_TO_ADDRESS,
      chainId: CHAIN_ID,
      token: USDT0_ADDRESS,
    },
    actualPaymentParams: {
      amount: 10000000, // 10 USDT0 instead of 0.0001
      payTo: PAY_TO_ADDRESS,
      chainId: CHAIN_ID,
      token: USDT0_ADDRESS,
    },
  },

  tampered_recipient: {
    name: 'Tampered Recipient',
    description: 'Attacker redirects payment to a different address but reuses proof bound to legitimate payTo.',
    expectedOutcome: '403 Forbidden — Recipient mismatch',
    features: SHARED_FEATURES,
    proofPaymentParams: {
      amount: 100,
      payTo: PAY_TO_ADDRESS,
      chainId: CHAIN_ID,
      token: USDT0_ADDRESS,
    },
    actualPaymentParams: {
      amount: 100,
      payTo: ATTACKER_ADDRESS,
      chainId: CHAIN_ID,
      token: USDT0_ADDRESS,
    },
  },
};
