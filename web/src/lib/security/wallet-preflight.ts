// src/lib/security/wallet-preflight.ts
import { isAddress } from "ethers";

const ALLOWED_CHAINS = new Set([56, 97]); // BSC main + test
// Whitelist known contracts if you can (factory, router, etc.)
export const CONTRACT_ALLOWLIST = new Set<string>(
  (process.env.NEXT_PUBLIC_ALLOWED_CONTRACTS || "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
);

export function assertChainId(chainId: number) {
  if (!ALLOWED_CHAINS.has(chainId)) {
    throw new Error(`Wrong network. Please switch to BSC (${Array.from(ALLOWED_CHAINS).join(",")}).`);
  }
}

export function assertAddressAllowed(addr: string) {
  if (!isAddress(addr)) throw new Error("Invalid contract address.");
  if (CONTRACT_ALLOWLIST.size && !CONTRACT_ALLOWLIST.has(addr.toLowerCase())) {
    throw new Error("This contract is not allowed by the platform.");
  }
}

export function limitApprovalAmount(requested: bigint, maxMultiple = 2n): bigint {
  // replace “infinite approvals” with a small safety buffer
  // Example: cap to 2× the requested amount
  return requested > 0n ? requested * maxMultiple : 0n;
}
