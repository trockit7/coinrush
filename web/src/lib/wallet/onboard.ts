// web/src/lib/wallet/onboard.ts
"use client";

import Onboard, { type OnboardAPI } from "@web3-onboard/core";
import injectedModule from "@web3-onboard/injected-wallets";
import walletConnectModule from "@web3-onboard/walletconnect";
import coinbaseWalletModule from "@web3-onboard/coinbase";

function compact<T>(arr: (T | false | null | undefined)[]): T[] {
  return arr.filter(Boolean) as T[];
}

// ──────────────────────────────────────────────────────────
// Env reads (once)
// ──────────────────────────────────────────────────────────
const dappUrl = (process.env.NEXT_PUBLIC_DAPP_URL || "").trim();
const rpcEnv = (process.env.NEXT_PUBLIC_BSC_HTTP_1 || "").trim();
const bscRpc = rpcEnv || "https://bsc-testnet.publicnode.com";

const enableWc =
  (process.env.NEXT_PUBLIC_ENABLE_WALLETCONNECT || "").toLowerCase() === "true";
const wcProjectId = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "").trim();

// ──────────────────────────────────────────────────────────
const injected = injectedModule();
const coinbase = coinbaseWalletModule();

// ✅ WalletConnect with dappUrl (required to avoid WC warning)
const walletConnect =
  enableWc && wcProjectId && dappUrl
    ? walletConnectModule({
        projectId: wcProjectId,
        requiredChains: [97],      // BSC Testnet (decimal for WC v2)
        dappUrl: dappUrl,          // <-- keep this
      })
    : null;

if (enableWc && (!wcProjectId || !dappUrl)) {
  console.warn(
    "[onboard] WalletConnect disabled: missing " +
      (wcProjectId ? "" : "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ") +
      (!wcProjectId && !dappUrl ? "and " : "") +
      (dappUrl ? "" : "NEXT_PUBLIC_DAPP_URL")
  );
}

// ⬇️ Initialize at module scope
const onboard: OnboardAPI = Onboard({
  wallets: compact([injected, walletConnect, coinbase]),
  chains: [
    {
      id: "0x61", // BSC Testnet (hex for Onboard)
      token: "tBNB",
      label: "BSC Testnet",
      rpcUrl: rpcEnv || bscRpc, // uses env if set; falls back to public node
    },
  ],
  // ⬇️ REPLACED appMetadata block (no `url` key; valid fields only)
  appMetadata: {
    name: "Coinrush",
    description: "Coinrush on BSC Testnet",
    // valid fields:
    icons: ["https://coinrush-production.up.railway.app/icon.png"],
    gettingStartedGuide: process.env.NEXT_PUBLIC_DAPP_URL!, // optional but valid
    explore: process.env.NEXT_PUBLIC_DAPP_URL!,             // optional but valid
    recommendedInjectedWallets: [
      { name: "MetaMask", url: "https://metamask.io" }
    ]
  }
});

export default onboard;
