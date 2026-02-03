/**
 * Mock transfer function for demo purposes.
 * See README for WDK integration instructions.
 */
export async function mockTransfer(to: string, amount: string, token: string): Promise<string> {
  console.log(`[Mock WDK] Would transfer ${amount} of token ${token} to ${to}`);
  // Simulate tx hash
  const mockHash = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return mockHash;
}
