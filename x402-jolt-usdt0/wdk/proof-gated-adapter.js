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
   */
  registerProof(settlementId, proofData) {
    this._pendingProofs.set(settlementId, proofData);
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
    const proofData = this._pendingProofs.get(settlementId);

    if (!proofData) {
      throw new Error(`No ZK proof registered for settlement "${settlementId}". Cannot execute writeContract.`);
    }

    // Verify proof via cosigner
    const cosignerResult = await verifyCosigner(
      proofData,
      { to: args.address, amount: '0', token: args.address },
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
