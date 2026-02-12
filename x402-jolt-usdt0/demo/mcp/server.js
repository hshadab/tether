import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { appendFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_FILE = resolve(__dirname, 'mcp-calls.json');

const server = new Server(
  { name: 'zk-402-weather', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get-weather',
      description: 'Get weather data via ZK-402 proof-gated USDT0 payment. Requires a running ZK-402 server with cached proofs.',
      inputSchema: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'Location for weather data (currently returns SF data)' },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'get-weather') {
    return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true };
  }

  const serverUrl = process.env.ZK402_SERVER_URL || 'http://localhost:4020';

  try {
    // Step 1: Request without payment to get 402 requirements
    const initialResp = await fetch(`${serverUrl}/weather`);
    if (initialResp.status !== 402) {
      return { content: [{ type: 'text', text: `Unexpected response: ${initialResp.status}` }], isError: true };
    }

    // Step 2: Load cached proof
    const { loadScenarioProofWithBinding } = await import('../../zk/load-proof.js');
    const { USDT0_ADDRESS, CHAIN_ID, PRICE_USDT0, PAY_TO_ADDRESS } = await import('../../x402/config.js');

    const paymentParams = { amount: PRICE_USDT0, payTo: PAY_TO_ADDRESS, chainId: CHAIN_ID, token: USDT0_ADDRESS };
    const { payment, zkProof } = loadScenarioProofWithBinding('normal', paymentParams);

    const paymentHeader = Buffer.from(JSON.stringify(payment)).toString('base64');
    const zkProofHeader = Buffer.from(JSON.stringify(zkProof)).toString('base64');

    // Step 3: Request with payment + proof
    const resp = await fetch(`${serverUrl}/weather`, {
      headers: {
        'X-Payment': paymentHeader,
        'X-ZK-Proof': zkProofHeader,
      },
    });

    const data = await resp.json();

    // Log the call
    try {
      appendFileSync(LOG_FILE, JSON.stringify({ timestamp: new Date().toISOString(), status: resp.status, data }) + '\n');
    } catch (e) { console.error('[MCP] Log write failed:', e.message); }

    if (resp.status === 200) {
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } else {
      return { content: [{ type: 'text', text: `ZK-402 verification failed (${resp.status}): ${JSON.stringify(data)}` }], isError: true };
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
