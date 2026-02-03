import WalletManagerEvm from "@tetherto/wdk-wallet-evm";

/**
 * Create a real WDK-based transfer function for ERC-20 tokens.
 * Uses Tether's Wallet Development Kit (WDK) for self-custodial transfers.
 *
 * @see https://docs.wallet.tether.io/sdk/get-started
 * @see https://github.com/tetherto/wdk-wallet-evm
 *
 * @param seedPhrase - BIP-39 mnemonic seed phrase
 * @param rpcUrl - Ethereum JSON-RPC endpoint URL
 */
export async function createWdkTransfer(seedPhrase: string, rpcUrl: string) {
  console.log(`[WDK] Initializing wallet with provider: ${rpcUrl}`);

  // Create wallet manager directly (simpler than using WDK core + registerWallet)
  const wallet = new WalletManagerEvm(seedPhrase, {
    provider: rpcUrl,
  });

  // Get the first account (index 0)
  const account = await wallet.getAccount(0);
  const address = await account.getAddress();
  console.log(`[WDK] Wallet address: ${address}`);

  /**
   * Execute an ERC-20 token transfer using WDK.
   *
   * @param to - Recipient address
   * @param amount - Amount in token's smallest unit (e.g., 6 decimals for USDT)
   * @param token - ERC-20 token contract address
   * @returns Transaction hash
   */
  return async (to: string, amount: string, token: string): Promise<string> => {
    console.log(`[WDK] Transferring ${amount} of token ${token} to ${to}`);

    // Get quote first for logging
    try {
      const quote = await account.quoteTransfer({
        token,
        recipient: to,
        amount: BigInt(amount),
      });
      console.log(`[WDK] Estimated fee: ${quote.fee} wei`);
    } catch (err) {
      console.log(`[WDK] Could not get fee quote: ${err}`);
    }

    // Execute the transfer
    const result = await account.transfer({
      token,
      recipient: to,
      amount: BigInt(amount),
    });

    console.log(`[WDK] Transfer complete - hash: ${result.hash}, fee: ${result.fee} wei`);
    return result.hash;
  };
}

/**
 * Get ERC-20 token balance using WDK.
 */
export async function getWdkBalance(seedPhrase: string, rpcUrl: string, token: string): Promise<bigint> {
  const wallet = new WalletManagerEvm(seedPhrase, { provider: rpcUrl });
  const account = await wallet.getAccount(0);
  const balance = await account.getTokenBalance(token);
  return balance;
}
