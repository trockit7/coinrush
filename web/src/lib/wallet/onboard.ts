// web/src/lib/wallet/onboard.ts
"use client";

import { init } from "@web3-onboard/react";
import type { OnboardAPI } from "@web3-onboard/core";
import injectedModule from "@web3-onboard/injected-wallets";
import walletConnectModule from "@web3-onboard/walletconnect";
import coinbaseWalletModule from "@web3-onboard/coinbase";

function compact<T>(arr: (T | false | null | undefined)[]): T[] {
  return arr.filter(Boolean) as T[];
}

// Read envs once
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";
const bscRpc = process.env.NEXT_PUBLIC_BSC_HTTP_1 || "https://bsc-testnet.publicnode.com";

// Wallet modules
const injected = injectedModule();

/* ✅ Drop-in fix
   WalletConnect expects DECIMAL chain IDs in requiredChains.
   BSC Testnet = 97. Do NOT pass objects here. */
const walletConnect =
  wcProjectId.trim().length > 0
    ? walletConnectModule({
        projectId: wcProjectId,
        requiredChains: [97], // <-- decimal chainId for WC v2
      })
    : null;

const coinbase = coinbaseWalletModule();

// ⬇️ IMPORTANT: call init AT MODULE SCOPE (not inside a function)
const onboard: OnboardAPI = init({
  wallets: compact([injected, walletConnect, coinbase]),
  // Keep hex ID + rpcUrl here (this is correct for Onboard chains array)
  chains: [
    {
      id: "0x61", // BSC Testnet (hex)
      token: "tBNB",
      label: "BSC Testnet",
      rpcUrl: bscRpc,
    },
  ],
  appMetadata: {
    name: "Coinrush",
    description: "Coinrush dApp",
    recommendedInjectedWallets: [{ name: "MetaMask", url: "https://metamask.io" }],
  },
});

export default onboard;
