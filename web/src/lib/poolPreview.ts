// src/lib/poolPreview.ts (ethers v6)
"use client";

import { BrowserProvider, Interface, Contract } from "ethers";

// ⚠️ Important: do NOT import viem-typed ABIs here; they cause the InterfaceAbi mismatch.
// import { POOL_ABI } from "@/lib/abi";

// Minimal, ethers-friendly ABI fragments for what we need here.
const POOL_ABI_RW = [
  // writes (used only for encoding/decoding via call)
  "function buy(uint256 minOut) payable returns (uint256)",

  // optional read; some pools may implement a preview
  "function previewBuy(uint256 bnbInWei) view returns (uint256)",
] as const;

export async function getSigner() {
  const eth = (window as any)?.ethereum;
  if (!eth) throw new Error("No EIP-1193 provider found");
  const provider = new BrowserProvider(eth);
  return provider.getSigner();
}

/**
 * Returns estimated token out for a given BNB input.
 * 1) If the pool exposes previewBuy(bnbInWei), use it.
 * 2) Otherwise, simulate buy(minOut=0) via a eth_call with value.
 */
export async function previewBuy(poolAddr: string, bnbInWei: bigint) {
  const signer = await getSigner();
  const pool = new Contract(poolAddr, POOL_ABI_RW, signer) as any;

  // 1) Try previewBuy (if implemented)
  try {
    if (typeof pool.previewBuy === "function") {
      const out: bigint = await pool.previewBuy(bnbInWei);
      if (out > 0n) return out;
    }
  } catch {
    // fall through to call-simulation
  }

  // 2) Simulate buy(minOut=0) using a call with value
  const iface = new Interface(POOL_ABI_RW);
  const data = iface.encodeFunctionData("buy", [0n]); // minOut=0 just for preview
  const res = await signer.provider!.call({ to: poolAddr, data, value: bnbInWei });

  try {
    const [tokensOut] = iface.decodeFunctionResult("buy", res);
    return BigInt(tokensOut.toString());
  } catch {
    return 0n;
  }
}

/**
 * Binary-search a working minimum BNB-in that yields > 0 output.
 * Defaults: lo=10,000 wei, hi=0.01 BNB.
 */
export async function findMinBnbInWei(
  poolAddr: string,
  lo: bigint = 10_000n,
  hi: bigint = 10n ** 16n // 0.01 BNB
) {
  let ok = -1n, L = lo, H = hi;
  while (L <= H) {
    const mid = (L + H) >> 1n;
    const out = await previewBuy(poolAddr, mid);
    if (out > 0n) {
      ok = mid;
      H = mid - 1n;
    } else {
      L = mid + 1n;
    }
  }
  return ok;
}
