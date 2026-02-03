import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { gatedTransfer, type TransactionFeatures, type GatedTransferConfig } from "./gated-transfer.js";
import { mockTransfer } from "./mock-transfer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";

// Configuration from environment
const config: GatedTransferConfig = {
  cosignerUrl: process.env.COSIGNER_URL || "http://localhost:3001",
  proverBinary: process.env.PROVER_BINARY || resolve(__dirname, "../../prover/target/release/zkml-prover"),
  sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL || "https://sepolia.infura.io/v3/YOUR_KEY",
  testUsdtAddress: process.env.TEST_USDT_ADDRESS || "0x0000000000000000000000000000000000000000",
};

const RECIPIENT = process.env.RECIPIENT_ADDRESS || "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

interface TransferContext {
  transferFn: (to: string, amount: string, token: string) => Promise<string>;
  isRealWdk: boolean;
  walletAddress?: string;
}

async function resolveTransferFn(): Promise<TransferContext> {
  const seedPhrase = process.env.SEED_PHRASE;
  if (seedPhrase && seedPhrase !== HARDHAT_MNEMONIC) {
    try {
      const { createWdkTransfer, getWdkBalance } = await import("./wdk-transfer.js");
      const transferFn = await createWdkTransfer(seedPhrase, config.sepoliaRpcUrl);

      // Get wallet address and balance for display
      const WalletManagerEvm = (await import("@tetherto/wdk-wallet-evm")).default;
      const wallet = new WalletManagerEvm(seedPhrase, { provider: config.sepoliaRpcUrl });
      const account = await wallet.getAccount(0);
      const walletAddress = await account.getAddress();

      // Check token balance if token address is set
      if (config.testUsdtAddress !== "0x0000000000000000000000000000000000000000") {
        try {
          const balance = await getWdkBalance(seedPhrase, config.sepoliaRpcUrl, config.testUsdtAddress);
          console.log(`[WDK] Token balance: ${balance} (smallest units)`);
        } catch (err) {
          console.log(`[WDK] Could not fetch token balance: ${err}`);
        }
      }

      return { transferFn, isRealWdk: true, walletAddress };
    } catch (err) {
      console.warn(`[WDK] Failed to initialize real WDK, falling back to mock: ${err}`);
    }
  } else {
    console.warn("[WDK] No real SEED_PHRASE set (or using Hardhat test mnemonic). Using mock transfer.");
  }
  return { transferFn: mockTransfer, isRealWdk: false };
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  zkML-Gated Spending Demo                ║");
  console.log("║  Jolt-Atlas + Tether WDK                 ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const { transferFn: executeTransfer, isRealWdk, walletAddress } = await resolveTransferFn();

  console.log("Config:");
  console.log(`  Co-signer URL: ${config.cosignerUrl}`);
  console.log(`  Prover binary: ${config.proverBinary}`);
  console.log(`  Recipient: ${RECIPIENT}`);
  console.log(`  Token: ${config.testUsdtAddress}`);
  console.log(`  WDK Mode: ${isRealWdk ? "REAL (Tether WDK)" : "MOCK (simulation)"}`);
  if (walletAddress) {
    console.log(`  Wallet: ${walletAddress}`);
  }
  console.log();

  // =============================================
  // Scenario A: Low-risk transaction (should pass)
  // =============================================
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  SCENARIO A: Low-Risk Transaction");
  console.log("  (High budget=15, high trust=7, moderate amount=8)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const lowRiskFeatures: TransactionFeatures = {
    budget: 15,
    trust: 7,
    amount: 8,
    category: 0,
    velocity: 2,
    day: 1,
    time: 1,
  };

  const resultA = await gatedTransfer(
    lowRiskFeatures,
    RECIPIENT,
    "100000000", // 100 tUSDT (6 decimals)
    config,
    executeTransfer
  );

  console.log("\n[Result A]", resultA.success ? `SUCCESS - TX: ${resultA.txHash}` : `BLOCKED - ${resultA.reason}`);

  // =============================================
  // Scenario B: High-risk transaction (should fail)
  // =============================================
  console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  SCENARIO B: High-Risk Transaction");
  console.log("  (Low budget=5, low trust=4, high amount=12)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const highRiskFeatures: TransactionFeatures = {
    budget: 5,
    trust: 4,
    amount: 12,
    category: 0,
    velocity: 2,
    day: 1,
    time: 1,
  };

  const resultB = await gatedTransfer(
    highRiskFeatures,
    RECIPIENT,
    "500000000", // 500 tUSDT (6 decimals)
    config,
    executeTransfer
  );

  console.log("\n[Result B]", resultB.success ? `SUCCESS - TX: ${resultB.txHash}` : `BLOCKED - ${resultB.reason}`);

  // =============================================
  // Summary
  // =============================================
  console.log("\n\n╔══════════════════════════════════════════╗");
  console.log("║  Demo Summary                            ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log(`║  Scenario A (low risk):  ${resultA.success ? "TRANSFERRED" : "BLOCKED    "}     ║`);
  console.log(`║  Scenario B (high risk): ${resultB.success ? "TRANSFERRED" : "BLOCKED    "}     ║`);
  console.log("╚══════════════════════════════════════════╝");

  if (resultA.success && !resultB.success) {
    console.log("\nDemo passed: Low-risk approved, high-risk blocked.");
  } else {
    console.log("\nUnexpected results - check configuration.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
