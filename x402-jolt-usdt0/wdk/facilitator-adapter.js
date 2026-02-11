import { ethers } from 'ethers';
import { RPC_URL, MNEMONIC } from '../x402/config.js';

/**
 * Adapter that wraps a WDK WalletAccountEvm to implement FacilitatorEvmSigner.
 *
 * This bridges Tether WDK's wallet interface to the x402 facilitator's expected
 * signer interface (getAddresses, readContract, writeContract, etc.).
 */
export class FacilitatorAdapter {
  constructor(walletAccount, { rpcUrl = RPC_URL, mnemonic = MNEMONIC } = {}) {
    this._account = walletAccount;
    this._provider = new ethers.JsonRpcProvider(rpcUrl);
    this._signer = ethers.Wallet.fromPhrase(mnemonic).connect(this._provider);
  }

  async getAddresses() {
    const addr = await this._account.getAddress();
    return [addr];
  }

  async readContract({ address, abi, functionName, args }) {
    const contract = new ethers.Contract(address, abi, this._provider);
    return contract[functionName](...(args || []));
  }

  async writeContract({ address, abi, functionName, args }) {
    const contract = new ethers.Contract(address, abi, this._signer);
    const tx = await contract[functionName](...(args || []));
    return tx.hash;
  }

  async verifyTypedData({ address, domain, types, message, signature }) {
    const recovered = ethers.verifyTypedData(domain, types, message, signature);
    return recovered.toLowerCase() === address.toLowerCase();
  }

  async sendTransaction({ to, data }) {
    const tx = await this._signer.sendTransaction({ to, data, value: 0n });
    return tx.hash;
  }

  async waitForTransactionReceipt({ hash }) {
    const receipt = await this._provider.waitForTransaction(hash);
    return {
      status: receipt.status === 1 ? 'success' : 'reverted',
      blockNumber: receipt.blockNumber,
      transactionHash: receipt.hash,
    };
  }

  async getCode({ address }) {
    const code = await this._provider.getCode(address);
    return code === '0x' ? undefined : code;
  }
}
