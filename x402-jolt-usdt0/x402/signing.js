import { randomBytes } from 'crypto';
import { authorizationTypes } from '@x402/evm';
import { USDT0_ADDRESS, CHAIN_ID } from './config.js';

export const EIP712_DOMAIN = {
  name: 'USDT0',
  version: '1',
  chainId: CHAIN_ID,
  verifyingContract: USDT0_ADDRESS,
};

/**
 * Sign an EIP-712 TransferWithAuthorization message.
 * Returns the authorization object + signature.
 *
 * @param {import('ethers').Wallet} wallet - Signer wallet
 * @param {string} to - Recipient address
 * @param {string|number} value - Amount in smallest unit
 * @returns {Promise<{ authorization: object, signature: string }>}
 */
export async function signTransferAuthorization(wallet, to, value) {
  const nonce = '0x' + randomBytes(32).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: wallet.address,
    to,
    value: String(value),
    validAfter: String(now - 600),
    validBefore: String(now + 3600),
    nonce,
  };

  const signature = await wallet.signTypedData(
    EIP712_DOMAIN,
    authorizationTypes,
    authorization,
  );

  return { authorization, signature };
}
