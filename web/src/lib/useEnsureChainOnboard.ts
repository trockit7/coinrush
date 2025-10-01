// src/lib/useEnsureChainOnboard.ts
"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { bscTestnet } from "wagmi/chains";

/**
 * Returns an async function that ensures the wallet is connected
 * and switched to BSC Testnet (chainId 97).
 *
 * Usage:
 *   const ensureBsctest = useEnsureBsctest();
 *   try {
 *     await ensureBsctest();
 *   } catch (e) {
 *     if ((e as Error)?.message === "WALLET_NOT_CONNECTED") {
 *       // open your own connect UI (Web3Onboard, custom modal, etc.)
 *     }
 *   }
 */
export function useEnsureBsctest() {
  const { isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  return async function ensureBsctest() {
    if (!isConnected) {
      // No RainbowKit here; let caller open their preferred connect UI.
      throw new Error("WALLET_NOT_CONNECTED");
    }
    if (chainId !== bscTestnet.id) {
      await switchChainAsync({ chainId: bscTestnet.id });
    }
  };
}
