#!/usr/bin/env node
import 'dotenv/config';
import { ethers } from 'ethers';

const PLASMA_RPC = 'https://rpc.plasma.to';
const PLASMA_CHAIN_ID = 9745;
const USDT0_ADDRESS = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb';

const HARDHAT_MNEMONIC = 'test test test test test test test test test test test junk';

// Minimal ERC-20 ABI for balanceOf
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

async function main() {
  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic) {
    console.error('Error: MNEMONIC env var is required.');
    console.error('Usage: MNEMONIC="your twelve words ..." npm run fund-wallet');
    process.exit(1);
  }

  if (mnemonic.trim() === HARDHAT_MNEMONIC) {
    console.error('WARNING: You are using the Hardhat default mnemonic.');
    console.error('USDT0 on Plasma blacklists its well-known addresses.');
    console.error('Generate a fresh mnemonic:');
    console.error('  node -e "import(\'ethers\').then(e => console.log(e.Wallet.createRandom().mnemonic.phrase))"');
    process.exit(1);
  }

  const wallet = ethers.Wallet.fromPhrase(mnemonic);
  const address = wallet.address;

  console.log('='.repeat(60));
  console.log('  Plasma Demo Wallet Funding Helper');
  console.log('='.repeat(60));
  console.log();
  console.log(`  Derived wallet address: ${address}`);
  console.log();

  // Query current balances
  const provider = new ethers.JsonRpcProvider(PLASMA_RPC);
  try {
    const xplBalance = await provider.getBalance(address);
    const usdt0 = new ethers.Contract(USDT0_ADDRESS, ERC20_ABI, provider);
    const usdt0Balance = await usdt0.balanceOf(address);

    console.log('  Current balances on Plasma:');
    console.log(`    XPL (gas):  ${ethers.formatEther(xplBalance)}`);
    console.log(`    USDT0:      ${ethers.formatUnits(usdt0Balance, 6)}`);
  } catch (err) {
    console.log('  (Could not fetch balances — RPC may be unreachable)');
  }

  console.log();
  console.log('-'.repeat(60));
  console.log('  Steps to fund this wallet via MetaMask:');
  console.log('-'.repeat(60));
  console.log();
  console.log('  1. Add the Plasma network to MetaMask:');
  console.log('     - Network name: Plasma');
  console.log(`     - RPC URL:      ${PLASMA_RPC}`);
  console.log(`     - Chain ID:     ${PLASMA_CHAIN_ID}`);
  console.log('     - Currency:     XPL');
  console.log(`     - Explorer:     https://plasmascan.to`);
  console.log();
  console.log('  2. Import the USDT0 token in MetaMask:');
  console.log(`     - Token address: ${USDT0_ADDRESS}`);
  console.log('     - Symbol:        USDT0');
  console.log('     - Decimals:      6');
  console.log();
  console.log('  3. Bridge USDT to Plasma via Stargate:');
  console.log('     - Go to https://stargate.finance/bridge');
  console.log('     - Source: any chain with USDT (Arbitrum is cheapest)');
  console.log('     - Destination: XPL (Plasma)');
  console.log('     - Token: USDT -> USDT0');
  console.log('     - Note: If you only have USDC, swap to USDT first');
  console.log('       (e.g. Uniswap on Arbitrum), then bridge.');
  console.log('     - Stargate uses a "Bus" system — transfers may take');
  console.log('       up to ~40 minutes to arrive.');
  console.log();
  console.log('  4. Send USDT0 to the derived wallet address:');
  console.log(`     - To: ${address}`);
  console.log('     - Amount: 0.05 USDT0 is enough for ~500 requests');
  console.log();
  console.log('  5. Send XPL (gas) on Plasma to the derived wallet address:');
  console.log(`     - To: ${address}`);
  console.log('     - Amount: 0.005 XPL (enough for hundreds of transactions)');
  console.log();
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
