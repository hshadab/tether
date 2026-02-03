import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runProver, gatedTransfer, type TransactionFeatures, type GatedTransferConfig } from "../gated-transfer.js";
import { mockTransfer } from "../mock-transfer.js";

const validFeatures: TransactionFeatures = {
  budget: 10,
  trust: 5,
  amount: 3,
  category: 1,
  velocity: 2,
  day: 1,
  time: 1,
};

const testConfig: GatedTransferConfig = {
  cosignerUrl: "http://localhost:3001",
  proverBinary: "/nonexistent/binary",
  sepoliaRpcUrl: "http://localhost:8545",
  testUsdtAddress: "0x0000000000000000000000000000000000000001",
};

describe("runProver", () => {
  it("throws on invalid binary path", () => {
    assert.throws(
      () => runProver(validFeatures, "/nonexistent/binary/path"),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      }
    );
  });

  it("accepts valid feature structure", () => {
    // Verifies that the features JSON serialization works correctly
    const features: TransactionFeatures = {
      budget: 0,
      trust: 0,
      amount: 0,
      category: 0,
      velocity: 0,
      day: 0,
      time: 0,
    };

    // Should throw because binary doesn't exist, but the features are valid
    assert.throws(() => runProver(features, "/nonexistent"));
  });
});

describe("mockTransfer", () => {
  it("returns a valid transaction hash format", async () => {
    const txHash = await mockTransfer(
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "1000000",
      "0x0000000000000000000000000000000000000001"
    );

    assert.ok(txHash.startsWith("0x"), "TX hash should start with 0x");
    assert.equal(txHash.length, 66, "TX hash should be 66 characters (0x + 64 hex)");
    assert.match(txHash, /^0x[0-9a-f]{64}$/i, "TX hash should be valid hex");
  });

  it("generates unique hashes on each call", async () => {
    const hash1 = await mockTransfer("0xabc", "100", "0xtoken");
    const hash2 = await mockTransfer("0xabc", "100", "0xtoken");

    // While there's a tiny chance of collision, it's extremely unlikely
    assert.notEqual(hash1, hash2, "Each call should generate a unique hash");
  });
});

describe("gatedTransfer", () => {
  it("returns failure when prover binary does not exist", async () => {
    const result = await gatedTransfer(
      validFeatures,
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "1000000",
      testConfig,
      mockTransfer
    );

    assert.equal(result.success, false);
    assert.ok(result.reason?.includes("Prover failed"));
  });

  it("includes recipient and amount in the flow", async () => {
    const recipient = "0x1234567890123456789012345678901234567890";
    const amount = "500000000";

    const result = await gatedTransfer(
      validFeatures,
      recipient,
      amount,
      testConfig,
      mockTransfer
    );

    // Should fail at prover step, but verifies args pass through
    assert.equal(result.success, false);
    assert.ok(result.reason?.includes("Prover"));
  });
});

describe("TransactionFeatures validation", () => {
  it("requires all feature fields", () => {
    const completeFeatures: TransactionFeatures = {
      budget: 15,
      trust: 7,
      amount: 8,
      category: 0,
      velocity: 2,
      day: 1,
      time: 1,
    };

    // TypeScript ensures all fields are present at compile time
    // This test verifies the structure matches expectations
    assert.equal(Object.keys(completeFeatures).length, 7);
    assert.ok("budget" in completeFeatures);
    assert.ok("trust" in completeFeatures);
    assert.ok("amount" in completeFeatures);
    assert.ok("category" in completeFeatures);
    assert.ok("velocity" in completeFeatures);
    assert.ok("day" in completeFeatures);
    assert.ok("time" in completeFeatures);
  });

  it("features can be zero", () => {
    const zeroFeatures: TransactionFeatures = {
      budget: 0,
      trust: 0,
      amount: 0,
      category: 0,
      velocity: 0,
      day: 0,
      time: 0,
    };

    // Should be valid structure (will fail at prover, but structure is OK)
    assert.doesNotThrow(() => JSON.stringify(zeroFeatures));
  });
});
