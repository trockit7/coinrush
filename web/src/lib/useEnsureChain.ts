// src/lib/useEnsureChain.ts
"use client";

import * as React from "react";
import { useChainId, useSwitchChain, useWalletClient } from "wagmi";

/** Type for wallet_addEthereumChain per EIP-3085 */
type AddEthereumChainParameter = {
  chainId: `0x${string}`;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls?: string[];
  iconUrls?: string[];
};

/** Known networks you might switch to (extend as needed) */
const DEFAULT_CHAIN_PARAMS: Record<number, AddEthereumChainParameter> = {
  // BSC Testnet (97)
  97: {
    chainId: "0x61",
    chainName: "BNB Smart Chain Testnet",
    nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
    rpcUrls: [
      process.env.NEXT_PUBLIC_RPC_BSCTEST ||
        "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
    ],
    blockExplorerUrls: ["https://testnet.bscscan.com/"],
  },

  // BSC Mainnet (56) — optional
  56: {
    chainId: "0x38",
    chainName: "BNB Smart Chain",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: [
      process.env.NEXT_PUBLIC_RPC_BSC || "https://bsc-dataseed.binance.org",
    ],
    blockExplorerUrls: ["https://bscscan.com/"],
  },

  // Base mainnet (8453) — optional
  8453: {
    chainId: "0x2105",
    chainName: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [
      process.env.NEXT_PUBLIC_RPC_BASE || "https://mainnet.base.org",
    ],
    blockExplorerUrls: ["https://basescan.org/"],
  },

  // Base Sepolia (84532) — optional
  84532: {
    chainId: "0x14A34",
    chainName: "Base Sepolia",
    nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: [
      process.env.NEXT_PUBLIC_RPC_BASESEPOLIA ||
        "https://sepolia.base.org",
    ],
    blockExplorerUrls: ["https://sepolia.basescan.org/"],
  },
};

export type UseEnsureChainOptions = {
  /** Add the chain to the wallet if it isn’t known; default true */
  addIfMissing?: boolean;
  /** Override chain parameters (otherwise we use sensible defaults above) */
  chainParamsOverride?: AddEthereumChainParameter;
};

/**
 * Returns a callback that ensures the connected wallet is on `requiredChainId`.
 * - Tries `switchChainAsync` first.
 * - If that fails and `addIfMissing` is true, calls `wallet_addEthereumChain` with params (override or defaults) and tries again.
 * - Throws if no wallet is connected.
 */
export function useEnsureChain(
  requiredChainId: number,
  opts: UseEnsureChainOptions = {}
) {
  const addIfMissing = opts.addIfMissing ?? true;
  const chainParams =
    opts.chainParamsOverride || DEFAULT_CHAIN_PARAMS[requiredChainId];

  const current = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();

  return React.useCallback(async () => {
    if (!walletClient) {
      throw new Error("Connect a wallet first.");
    }
    if (current === requiredChainId) {
      return true;
    }

    // Try a normal switch first (works if the chain is already configured in the wallet)
    try {
      await switchChainAsync({ chainId: requiredChainId });
      return true;
    } catch (err) {
      // If we can't switch, optionally try to add the chain then switch
      if (addIfMissing && chainParams) {
        try {
          await walletClient.request({
            method: "wallet_addEthereumChain",
            params: [chainParams as any],
          });
          await switchChainAsync({ chainId: requiredChainId });
          return true;
        } catch (err2) {
          // surface original-ish error
          throw new Error(
            (err2 as any)?.message ||
              "Failed to add/switch network in wallet."
          );
        }
      }
      // Can't add chain or no params provided
      throw new Error(
        (err as any)?.message || "Failed to switch network in wallet."
      );
    }
  }, [walletClient, current, requiredChainId, switchChainAsync, addIfMissing, chainParams]);
}

/** Convenience alias for your current default (BSC Testnet 97) */
export function useEnsureBsctest() {
  return useEnsureChain(97);
}
