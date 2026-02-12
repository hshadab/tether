import { execFileSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface TransactionFeatures {
  budget: number;
  trust: number;
  amount: number;
  category: number;
  velocity: number;
  day: number;
  time: number;
}

export interface ProverResult {
  proof: string;
  program_io: string;
  decision: "AUTHORIZED" | "DENIED";
  model_hash: string;
}

export interface CosignerResponse {
  approved: boolean;
  signature?: string;
  nonce?: number;
  timestamp?: number;
  reason?: string;
}

export interface GatedTransferConfig {
  cosignerUrl: string;
  proverBinary: string;
  sepoliaRpcUrl: string;
  testUsdtAddress: string;
}

/**
 * Run the zkML prover to get a proof and authorization decision.
 */
export function runProver(
  features: TransactionFeatures,
  proverBinary: string
): ProverResult {
  const featuresJson = JSON.stringify(features);
  console.log(`[Prover] Running zkML inference for features: ${featuresJson}`);

  const startTime = Date.now();
  const output = execFileSync(proverBinary, [featuresJson], {
    encoding: "utf-8",
    maxBuffer: 100 * 1024 * 1024, // 100MB for large proofs
    timeout: 600_000, // 10 minutes max for proof generation
    env: {
      ...process.env,
      MODELS_DIR: resolve(__dirname, "../../models"),
    },
  });
  const elapsed = Date.now() - startTime;
  console.log(`[Prover] Completed in ${elapsed}ms`);

  // The prover outputs debug info from Jolt libraries followed by JSON on the last line
  const lines = output.trim().split('\n');
  const jsonLine = lines[lines.length - 1];
  const result: ProverResult = JSON.parse(jsonLine);
  console.log(`[Prover] Decision: ${result.decision}`);
  return result;
}

/**
 * Submit proof to the co-signer service for verification.
 */
export async function submitToCosigner(
  proof: string,
  programIo: string,
  tx: { to: string; amount: string; token: string },
  cosignerUrl: string,
  modelHash: string
): Promise<CosignerResponse> {
  console.log(`[Cosigner] Submitting proof for verification...`);

  const body = JSON.stringify({
    proof,
    program_io: programIo,
    tx,
    model_hash: modelHash,
  });
  console.log(`[Cosigner] Request body size: ${body.length} bytes`);

  const resp = await fetch(`${cosignerUrl}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Cosigner returned ${resp.status}: ${text}`);
  }

  const result: CosignerResponse = await resp.json();
  console.log(
    `[Cosigner] Response: approved=${result.approved}${result.reason ? `, reason=${result.reason}` : ""}`
  );
  return result;
}

/**
 * Execute a zkML-gated transfer.
 *
 * 1. Run prover to get zkML proof and decision
 * 2. If DENIED, abort
 * 3. Submit proof to co-signer for verification
 * 4. If co-signer approves, execute the transfer via WDK
 */
export async function gatedTransfer(
  features: TransactionFeatures,
  recipient: string,
  amount: string,
  config: GatedTransferConfig,
  executeTransfer: (to: string, amount: string, token: string) => Promise<string>
): Promise<{ success: boolean; txHash?: string; reason?: string }> {
  console.log("\n========================================");
  console.log("  zkML-Gated Transfer");
  console.log("========================================");
  console.log(`  Recipient: ${recipient}`);
  console.log(`  Amount: ${amount}`);
  console.log(`  Features: ${JSON.stringify(features)}`);
  console.log("----------------------------------------\n");

  // Step 1: Run prover
  let proverResult: ProverResult;
  try {
    proverResult = runProver(features, config.proverBinary);
  } catch (err) {
    const reason = `Prover failed: ${err}`;
    console.log(`[BLOCKED] ${reason}`);
    return { success: false, reason };
  }

  // Step 2: Check decision
  if (proverResult.decision === "DENIED") {
    const reason = "zkML model denied the transaction";
    console.log(`[BLOCKED] ${reason}`);
    return { success: false, reason };
  }

  // Step 3: Submit to co-signer
  let cosignerResponse: CosignerResponse;
  try {
    cosignerResponse = await submitToCosigner(
      proverResult.proof,
      proverResult.program_io,
      { to: recipient, amount, token: config.testUsdtAddress },
      config.cosignerUrl,
      proverResult.model_hash
    );
  } catch (err) {
    const error = err as Error;
    const reason = `Co-signer request failed: ${error.message}`;
    console.log(`[BLOCKED] ${reason}`);
    if (error.cause) {
      console.log(`[DEBUG] Cause: ${JSON.stringify(error.cause, Object.getOwnPropertyNames(error.cause))}`);
    }
    return { success: false, reason };
  }

  if (!cosignerResponse.approved) {
    const reason = `Co-signer rejected: ${cosignerResponse.reason}`;
    console.log(`[BLOCKED] ${reason}`);
    return { success: false, reason };
  }

  console.log(
    `[Cosigner] Approved with nonce=${cosignerResponse.nonce}, sig=${cosignerResponse.signature?.slice(0, 20)}...`
  );

  // Step 4: Execute transfer
  try {
    console.log("[WDK] Executing transfer...");
    const txHash = await executeTransfer(
      recipient,
      amount,
      config.testUsdtAddress
    );
    console.log(`[WDK] Transfer successful! TX: ${txHash}`);
    return { success: true, txHash };
  } catch (err) {
    const reason = `Transfer execution failed: ${err}`;
    console.log(`[FAILED] ${reason}`);
    return { success: false, reason };
  }
}
