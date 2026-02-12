import { NETWORK, USDT0_ADDRESS, PRICE_USDT0, SERVER_PORT } from '../x402/config.js';

/**
 * Generate an A2A AgentCard for the ZK-402 Weather Agent.
 */
export function getAgentCard(req) {
  const host = req ? `${req.protocol}://${req.get('host')}` : `http://localhost:${SERVER_PORT}`;

  return {
    name: 'ZK-402 Weather Agent',
    description: 'Weather data with proof-gated USDT0 payments via x402 + JOLT-Atlas zkML',
    url: host,
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
    },
    skills: [
      {
        id: 'get-weather',
        name: 'Weather Lookup',
        description: 'Pay-per-request weather data with zkML proof verification. Requires USDT0 payment and a valid JOLT-Atlas ZK proof binding.',
      },
    ],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    extensions: {
      x402: {
        network: NETWORK,
        asset: 'USDT0',
        price: '0.0001',
        zkmlRequired: true,
      },
    },
  };
}
