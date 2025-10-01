// src/lib/getFreshSigner.ts
"use client";

import { BrowserProvider } from "ethers";

/**
 * Returns an ethers.js Signer for the currently-connected wallet.
 * - If a viem walletClient transport is provided, it will be used.
 * - Otherwise falls back to window.ethereum (EIP-1193).
 */
export async function getFreshSigner(transport?: any) {
  // Path A: use a wagmi/viem walletClient transport if provided
  if (transport) {
    const provider = new BrowserProvider(transport as any);
    return await provider.getSigner();
  }

  // Path B: fallback to injected provider
  const anyEth =
    typeof window !== "undefined" ? (window as any).ethereum : undefined;

  if (!anyEth) {
    throw new Error("No EIP-1193 provider found. Connect a wallet first.");
  }

  const provider = new BrowserProvider(anyEth);
  return await provider.getSigner();
}
