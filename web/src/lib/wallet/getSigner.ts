// src/lib/wallet/getSigner.ts
"use client";

import { BrowserProvider } from "ethers";

/** Always fetch a fresh Ethers signer from the current wallet. */
export async function getFreshSigner() {
  // window.ethereum is injected by MetaMask / Coinbase / WalletConnect, etc.
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No wallet found. Please connect a wallet first.");
  const provider = new BrowserProvider(eth);
  return provider.getSigner(); // reflects the currently selected account + chain
}
