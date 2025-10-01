// src/app/providers/Web3OnboardProviders.tsx
"use client";

import React from "react";
import Onboard, { OnboardAPI } from "@web3-onboard/core";
import { Web3OnboardProvider } from "@web3-onboard/react";
import injectedModule from "@web3-onboard/injected-wallets";
import walletConnectModule from "@web3-onboard/walletconnect";
import coinbaseWalletModule from "@web3-onboard/coinbase";

function getDappUrl() {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.NEXT_PUBLIC_DAPP_URL || "https://localhost";
}

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

// Wallet modules
const injected = injectedModule();
const walletConnect = walletConnectModule({
  projectId: wcProjectId,
  requiredChains: [56, 97],
  dappUrl: getDappUrl(),
});
const coinbase = coinbaseWalletModule({
  darkMode: true, // ✅ 'appName' is not a valid option here
});

// Keep a single Onboard instance
let onboardInstance: OnboardAPI | null = null;
function getOnboard(): OnboardAPI {
  if (onboardInstance) return onboardInstance;

  const walletModules = [injected, coinbase, ...(wcProjectId ? [walletConnect] : [])];

  onboardInstance = Onboard({
    wallets: walletModules,
    chains: [
      {
        id: "0x61", // BSC Testnet
        token: "BNB",
        label: "BNB Smart Chain Testnet",
        rpcUrl: "https://bsc-testnet.publicnode.com",
      },
      {
        id: "0x38", // BSC Mainnet (optional)
        token: "BNB",
        label: "BNB Smart Chain",
        rpcUrl: "https://bsc-dataseed.binance.org",
      },
    ],
    appMetadata: {
      name: "Coinrush", // ← App name belongs here
      description: "Coinrush dApp",
      recommendedInjectedWallets: [{ name: "MetaMask", url: "https://metamask.io" }],
    },
    connect: {
      autoConnectLastWallet: true,
      disableClose: false,
    },
    accountCenter: {
      desktop: { enabled: false },
      mobile: { enabled: false },
    },
    theme: "dark",
  });

  return onboardInstance;
}

export default function Web3OnboardProviders({ children }: { children: React.ReactNode }) {
  const onboard = React.useMemo(getOnboard, []);

  // Expose for debugging / hard disconnect fallbacks
  React.useEffect(() => {
    (window as any).__onboard = onboard;
    return () => {
      if ((window as any).__onboard === onboard) {
        try { delete (window as any).__onboard; } catch {}
      }
    };
  }, [onboard]);

  return <Web3OnboardProvider web3Onboard={onboard}>{children}</Web3OnboardProvider>;
}
