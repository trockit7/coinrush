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
const bscRpc =
  (process.env.NEXT_PUBLIC_BSC_HTTP_1 || "").trim() ||
  "https://bsc-testnet.publicnode.com";

const enableWc =
  (process.env.NEXT_PUBLIC_ENABLE_WALLETCONNECT || "").toLowerCase() === "true";
const wcProjectId = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "").trim();

// ──────────────────────────────────────────────────────────
const injected = injectedModule();
const coinbase = coinbaseWalletModule();

// ✅ WalletConnect with dappUrl (fixes WC warning)
const walletConnect =
  enableWc && wcProjectId && dappUrl
    ? walletConnectModule({
        projectId: wcProjectId,
        requiredChains: [97], // BSC Testnet (decimal for WC v2)
        dappUrl,              // <-- important for WC wallets / warning
      })
    : null;

if (enableWc && (!wcProjectId || !dappUrl)) {
  // Don’t throw—just surface a helpful console note and continue without WC.
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
      id: "0x61", // 97 (hex)
      token: "tBNB",
      label: "BSC Testnet",
      rpcUrl: bscRpc,
    },
  ],
  appMetadata: {
    name: "Coinrush",
    description: "Coinrush on BSC Testnet",
    // Good practice for WC wallets & general deep linking
    url: dappUrl || "https://example.com",
    // You can host this icon anywhere you control:
    icons: ["https://coinrush-production.up.railway.app/icon.png"],
    recommendedInjectedWallets: [{ name: "MetaMask", url: "https://metamask.io" }],
  },
});

export default onboard;
