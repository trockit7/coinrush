// src/lib/wallet/signing.ts
"use client";

import { BrowserProvider, Eip1193Provider, JsonRpcSigner } from "ethers";
import { useEffect, useState } from "react";

/**
 * IMPORTANT: Keep global Window augmentation *compatible* with other libs.
 * Use `any` for `ethereum` so merged declarations don’t conflict.
 */
declare global {
  interface Window {
    __onboard?: {
      state: {
        get(): {
          wallets: Array<{ label: string; accounts: { address: string }[]; provider: any }>
        }
      }
    };
    ethereum?: any; // must be `any` to avoid “Subsequent property declarations” conflicts
  }
}

/** Try to pick the active EIP-1193 provider from Web3Onboard first (then fallback). */
function pickFromOnboard(): Eip1193Provider | null {
  try {
    const state = window.__onboard?.state.get();
    const wallets = state?.wallets || [];
    if (!wallets.length) return null;

    // 1) If we saved a preferred label on connect, pick that wallet
    let saved = "";
    try { saved = localStorage.getItem("cr:selectedWalletLabel") || ""; } catch {}
    if (saved) {
      const hit = wallets.find(w => (w?.label || "").toLowerCase() === saved.toLowerCase());
      if (hit?.provider) return hit.provider as Eip1193Provider;
    }

    // 2) Prefer MetaMask if present
    const mm = wallets.find(w => (w?.label || "").toLowerCase().includes("metamask"));
    if (mm?.provider) return mm.provider as Eip1193Provider;

    // 3) Otherwise, first wallet
    if (wallets[0]?.provider) return wallets[0].provider as Eip1193Provider;
  } catch {}
  return null;
}

/** Resolve the ACTIVE EIP-1193 provider (Onboard preferred, then window.ethereum). */
function activeEip1193(): Eip1193Provider | null {
  // window.ethereum is typed as `any` globally for compatibility;
  // here we narrow it to Eip1193Provider at the usage site.
  return pickFromOnboard() || (window.ethereum as Eip1193Provider | null) || null;
}

/** Ask wallet to switch (or add+switch) to a given chain by hex id (e.g. "0x61"). */
export async function ensureChain(chainHexId: string): Promise<void> {
  const prov: any = activeEip1193();
  if (!prov) throw new Error("No wallet provider available");

  try {
    const current = await prov.request({ method: "eth_chainId" });
    if (typeof current === "string" && current.toLowerCase() === chainHexId.toLowerCase()) return;
  } catch {}

  try {
    await prov.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHexId }] });
    return;
  } catch (e: any) {
    // Add known BSC networks if needed, then switch
    if (chainHexId === "0x61") {
      await prov.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x61",
          chainName: "BSC Testnet",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          rpcUrls: ["https://bsc-testnet.publicnode.com"],
          blockExplorerUrls: ["https://testnet.bscscan.com"]
        }]
      });
      await prov.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x61" }] });
      return;
    }
    if (chainHexId === "0x38") {
      await prov.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x38",
          chainName: "BNB Smart Chain",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          rpcUrls: ["https://bsc-dataseed.binance.org"],
          blockExplorerUrls: ["https://bscscan.com"]
        }]
      });
      await prov.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] });
      return;
    }
    throw e;
  }
}

/** Get an Ethers v6 JsonRpcSigner from the active EIP-1193 provider. */
export async function getEthersSigner(): Promise<JsonRpcSigner> {
  const prov = activeEip1193();
  if (!prov) throw new Error("No wallet provider (connect a wallet)");
  const browser = new BrowserProvider(prov);
  return await browser.getSigner();
}

/** Lowercased active address (or empty string if none). */
export async function getConnectedAddress(): Promise<string> {
  const prov: any = activeEip1193();
  if (!prov) return "";
  try {
    const accounts: string[] = await prov.request({ method: "eth_accounts" });
    return (accounts?.[0] || "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Small compat hook for older code that expected a signer hook.
 * Returns `null` until a signer is resolvable.
 *
 * Usage:
 *   const signer = useEthersSigner(); // may be null initially
 */
export function useEthersSigner(deps: any[] = []) {
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await getEthersSigner();
        if (alive) setSigner(s ?? null);
      } catch {
        if (alive) setSigner(null);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return signer;
}
