// src/lib/wallet/getFreshSigner.ts
import { BrowserProvider } from "ethers";
// wagmi's useWalletClient returns a viem WalletClient
import type { WalletClient } from "viem";

/**
 * Returns an ethers.js Signer from the best available EIP-1193 provider.
 * Prefers injected providers (Coinbase, MetaMask), then falls back to
 * a WalletConnect transport passed from wagmi's useWalletClient.
 */
export async function getFreshSigner(walletClient?: WalletClient | undefined) {
  const eth: any =
    typeof window !== "undefined" ? (window as any).ethereum : undefined;

  // Prefer injected providers — Coinbase first, then MetaMask, then any.
  if (eth) {
    const provs: any[] = Array.isArray(eth.providers) ? eth.providers : [eth];
    const injected =
      provs.find((p: any) => p && p.isCoinbaseWallet) ||
      provs.find((p: any) => p && p.isMetaMask) ||
      provs[0];

    if (injected) {
      const provider = new BrowserProvider(injected);
      return await provider.getSigner();
    }
  }

  // Fallback to WalletConnect transport from wagmi (viem WalletClient)
  if (walletClient && (walletClient as any).transport) {
    const provider = new BrowserProvider((walletClient as any).transport);
    return await provider.getSigner();
  }

  throw new Error("No EIP-1193 provider found. Reconnect your wallet.");
}
