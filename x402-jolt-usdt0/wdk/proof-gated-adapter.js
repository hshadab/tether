import { verifyCosigner } from '../zk/cosigner-bridge.js';

/**
 * Decorator that wraps a FacilitatorAdapter with ZK proof verification.
 *
 * Before any writeContract() call, verifies that a registered ZK proof
 * has been approved by the cosigner. Prevents unauthorized on-chain settlements.
 */
export class ProofGatedAdapter {
  constructor(inner) {
    this._inner = inner;
    this._pendingProofs = new Map();
  }

  /**
   * Register a ZK proof for a pending settlement.
   * @param {string} settlementId
   * @param {object} proofData
   * @param {object} [txDetails] - Optional { to, amount, token } for cosigner verification
   */
  registerProof(settlementId, proofData, txDetails) {
    this._pendingProofs.set(settlementId, { proofData, txDetails });
  }

  async getAddresses() {
    return this._inner.getAddresses();
  }

  async readContract(args) {
    return this._inner.readContract(args);
  }

  async writeContract(args) {
    // Find a matching proof for this write call
    const settlementId = this._findSettlementId(args);
    const entry = this._pendingProofs.get(settlementId);

    if (!entry) {
      throw new Error(`No ZK proof registered for settlement "${settlementId}". Cannot execute writeContract.`);
    }

    const { proofData, txDetails } = entry;

    // Determine real tx details: prefer explicit txDetails, else extract from args
    let to, amount, token;
    if (txDetails) {
      ({ to, amount, token } = txDetails);
    } else {
      // For EIP-3009 transferWithAuthorization(from, to, value, ...),
      // args.args contains the function arguments in order
      const fnArgs = args.args || [];
      to = fnArgs[1] || args.address;
      amount = fnArgs[2] != null ? String(fnArgs[2]) : '0';
      token = args.address; // writeContract is called on the token contract
    }

    // Verify proof via cosigner
    const cosignerResult = await verifyCosigner(
      proofData,
      { to, amount, token },
      proofData.model_hash
    );

    if (!cosignerResult.approved) {
      this._pendingProofs.delete(settlementId);
      throw new Error(`Cosigner rejected proof for settlement "${settlementId}": ${cosignerResult.reason}`);
    }

    // Proof verified — delegate to inner adapter
    this._pendingProofs.delete(settlementId);
    return this._inner.writeContract(args);
  }

  async verifyTypedData(args) {
    return this._inner.verifyTypedData(args);
  }

  async sendTransaction(args) {
    return this._inner.sendTransaction(args);
  }

  async waitForTransactionReceipt(args) {
    return this._inner.waitForTransactionReceipt(args);
  }

  async getCode(args) {
    return this._inner.getCode(args);
  }

  _findSettlementId(args) {
    // Use function name + contract address as settlement key
    return `${args.functionName}:${args.address}`;
  }
}
