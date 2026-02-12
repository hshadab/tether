import { createHash } from 'crypto';
import { verifyPaymentBinding } from '../zk/proof-binding.js';
import { verifyCosigner } from '../zk/cosigner-bridge.js';
import { STEPS } from '../shared/event-steps.js';

/**
 * Create ZK-402 middleware for Express.
 *
 * Two gates:
 *   1. Payment signature valid (EIP-712 / EIP-3009)
 *   2. ZK proof binding matches payment params
 *
 * @param {object} config - { amount, payTo, chainId, token, network, broadcast }
 */
export function createZk402Middleware(config) {
  const { amount, payTo, chainId, token, network, broadcast } = config;

  return async (req, res, next) => {
    const paymentHeader = req.headers['x-payment'];
    const zkProofHeader = req.headers['x-zk-proof'];

    // No payment header → 402 Payment Required
    if (!paymentHeader) {
      broadcast({
        step: STEPS.PAYMENT_REQUIRED,
        title: 'Payment Required',
        description: `Server requires ${amount} units of USDT0 (0.0001 USDT0)`,
        actor: 'Server',
        status: 'info',
        details: { amount, payTo, chainId, token, network },
      });

      return res.status(402).json({
        error: 'Payment Required',
        x402: {
          version: 1,
          accepts: [{
            scheme: 'exact',
            network,
            maxAmountRequired: String(amount),
            resource: req.originalUrl,
            payTo,
            asset: token,
            extra: { zkmlRequired: true },
          }],
        },
      });
    }

    // Has payment but no ZK proof → 400
    if (!zkProofHeader) {
      return res.status(400).json({
        error: 'ZK-402 requires X-ZK-Proof header',
        message: 'Payment must include a zkML proof binding to verify transaction authorization.',
      });
    }

    // Decode headers
    let payment, zkProof;
    try {
      payment = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
    } catch {
      return res.status(400).json({ error: 'Invalid X-Payment header: not valid base64 JSON' });
    }
    try {
      zkProof = JSON.parse(Buffer.from(zkProofHeader, 'base64').toString());
    } catch {
      return res.status(400).json({ error: 'Invalid X-ZK-Proof header: not valid base64 JSON' });
    }

    // SSE: verification started
    broadcast({
      step: STEPS.VERIFY_STARTED,
      title: 'Verification Started',
      description: 'Server received payment + ZK proof, starting verification pipeline.',
      actor: 'Server',
      status: 'pending',
      details: { paymentSize: paymentHeader.length, proofSize: zkProofHeader.length },
    });

    // Gate 1: Verify payment signature exists and basic structure
    if (!payment.signature || !payment.amount || !payment.payTo) {
      broadcast({
        step: STEPS.VERIFY_COMPLETED,
        title: 'Verification Failed',
        description: 'Invalid payment structure.',
        actor: 'Server',
        status: 'failure',
      });
      return res.status(400).json({ error: 'Invalid payment: missing signature, amount, or payTo' });
    }

    // SSE: ZK proof received
    broadcast({
      step: STEPS.PROOF_RECEIVED,
      title: 'ZK Proof Received',
      description: `Received zkML proof (${zkProofHeader.length} bytes), decision: ${zkProof.decision}`,
      actor: 'Server',
      status: 'pending',
      details: {
        proofSize: zkProofHeader.length,
        decision: zkProof.decision,
        model_hash: zkProof.model_hash,
        hasBinding: !!zkProof.payment_binding,
      },
    });

    // Gate 2: Verify proof binding matches payment params
    const paymentParams = {
      amount: payment.amount,
      payTo: payment.payTo,
      chainId,
      token,
    };

    const proofHash = createHash('sha256').update(zkProof.proof || '').digest('hex');
    const bindingResult = verifyPaymentBinding(zkProof.payment_binding, paymentParams, proofHash);

    broadcast({
      step: STEPS.BINDING_CHECK,
      title: 'Binding Check',
      description: bindingResult.valid
        ? 'Proof binding matches payment parameters.'
        : `Binding mismatch: ${bindingResult.reason}`,
      actor: 'Server',
      status: bindingResult.valid ? 'success' : 'failure',
      details: {
        proofBinding: zkProof.payment_binding,
        paymentParams,
        valid: bindingResult.valid,
        reason: bindingResult.reason || null,
      },
    });

    const deferCompletion = !!req.headers['x-defer-completion'];

    if (!bindingResult.valid) {
      broadcast({
        step: STEPS.PROOF_REJECTED,
        title: 'Proof Rejected',
        description: bindingResult.reason,
        actor: 'Server',
        status: 'failure',
        details: { reason: bindingResult.reason },
      });

      if (!deferCompletion) {
        broadcast({
          step: STEPS.VERIFY_COMPLETED,
          title: 'Verification Failed',
          description: `Attack blocked: ${bindingResult.reason}`,
          actor: 'Server',
          status: 'failure',
        });
      }

      return res.status(403).json({
        error: 'ZK proof binding verification failed',
        reason: bindingResult.reason,
      });
    }

    // Gate 3: proof verification via cosigner
    try {
      const cosignerResult = await verifyCosigner(
        zkProof,
        { to: payment.payTo, amount: String(payment.amount), token },
        zkProof.model_hash
      );

      if (!cosignerResult.approved) {
        broadcast({
          step: STEPS.PROOF_REJECTED,
          title: 'Cosigner Rejected',
          description: `Cosigner rejected proof: ${cosignerResult.reason}`,
          actor: 'Cosigner',
          status: 'failure',
          details: cosignerResult,
        });
        return res.status(403).json({
          error: 'Cosigner verification failed',
          reason: cosignerResult.reason,
        });
      }

      broadcast({
        step: STEPS.PROOF_VERIFIED,
        title: 'Proof Verified',
        description: 'Cosigner verified correct ML execution.',
        actor: 'Cosigner',
        status: 'success',
        details: { nonce: cosignerResult.nonce, signature: cosignerResult.signature?.slice(0, 20) + '...' },
      });
    } catch (err) {
      // Cosigner unavailable — fail closed (reject the request)
      console.warn(`[Middleware] Cosigner verification failed: ${err.message}`);
      broadcast({
        step: STEPS.PROOF_VERIFIED,
        title: 'Cosigner Unavailable',
        description: `Cosigner unavailable — cannot verify proof. Rejecting request.`,
        actor: 'Server',
        status: 'failure',
        details: { cosignerError: err.message },
      });
      return res.status(503).json({
        error: 'Cosigner unavailable',
        message: 'Proof verification requires the cosigner service. Please try again later.',
      });
    }

    // All gates passed
    if (!deferCompletion) {
      broadcast({
        step: STEPS.VERIFY_COMPLETED,
        title: 'Verification Complete',
        description: 'Payment and ZK proof verified. Serving protected resource.',
        actor: 'Server',
        status: 'success',
      });
    }

    // Attach payment info for downstream use
    req.zkPayment = { payment, zkProof, paymentParams };

    next();
  };
}
