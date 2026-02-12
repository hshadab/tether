import 'dotenv/config';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Plasma (default network)
const PLASMA_DEFAULTS = {
  USDT0_ADDRESS: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb',
  RPC_URL: 'https://rpc.plasma.to',
  CHAIN_ID: 9745,
  NETWORK: 'eip155:9745',
};

// Sepolia (fallback)
const SEPOLIA_DEFAULTS = {
  USDT0_ADDRESS: process.env.SEPOLIA_USDT_ADDRESS || '0x959413cfD31eBe4Bc81A57b284cD638b4Be88500',
  RPC_URL: process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/YOUR_KEY',
  CHAIN_ID: 11155111,
  NETWORK: 'eip155:11155111',
};

const useSepolia = process.env.USE_SEPOLIA === 'true';
const net = useSepolia ? SEPOLIA_DEFAULTS : PLASMA_DEFAULTS;

export const USDT0_ADDRESS = net.USDT0_ADDRESS;
export const RPC_URL = useSepolia ? net.RPC_URL : (process.env.PLASMA_RPC_URL || net.RPC_URL);
export const CHAIN_ID = net.CHAIN_ID;
export const NETWORK = net.NETWORK;
export const NETWORK_NAME = useSepolia ? 'Sepolia' : 'Plasma';

export const PRICE_USDT0 = 100; // 0.0001 USDT0 (6 decimals)

export const COSIGNER_URL = process.env.COSIGNER_URL || 'http://localhost:3001';
export const PROVER_BINARY = process.env.PROVER_BINARY || resolve(__dirname, '../../prover/target/release/zkml-prover');
export const MODELS_DIR = process.env.MODELS_DIR || resolve(__dirname, '../../models');
export const SRS_PATH = resolve(__dirname, '../../dory_srs_22_variables.srs');

export const SERVER_PORT = parseInt(process.env.SERVER_PORT || '4020', 10);
export const FACILITATOR_PORT = parseInt(process.env.FACILITATOR_PORT || '4021', 10);

export const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS || '';
export const MNEMONIC = process.env.MNEMONIC || '';
