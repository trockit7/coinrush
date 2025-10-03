// src/lib/wallet/onboard.ts
"use client";

import Onboard from "@web3-onboard/core";
import injectedModule, { ProviderLabel } from "@web3-onboard/injected-wallets";
import walletConnectModule from "@web3-onboard/walletconnect";

// ————————————————————————————————————————————————
// Config from env with safe fallbacks
// ————————————————————————————————————————————————
const DAPP_URL =
  process.env.NEXT_PUBLIC_DAPP_URL ||
  (typeof window !== "undefined" ? window.location.origin : "");

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

// Accept either a comma-separated list or a single value; coerce to numbers.
function parseRequiredChains(): number[] {
  const raw =
    process.env.NEXT_PUBLIC_REQUIRED_CHAINS ||
    process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID ||
    "97"; // default BSC Testnet

  return String(raw)
    .split(",")
    .map((s) => Number(String(s).trim()))
    .filter((n) => Number.isFinite(n));
}

const REQUIRED_CHAINS = (() => {
  const arr = parseRequiredChains();
  return arr.length ? arr : [97];
})();

// ————————————————————————————————————————————————
// Wallet modules
// ————————————————————————————————————————————————

// Keep only MetaMask for injected to avoid hijacks from Trust/CB extensions
const injected = injectedModule({
  filter: (wallets) =>
    wallets.filter(
      (w) => w.label === ProviderLabel.MetaMask || w.label === "MetaMask"
    ),
});

// WalletConnect requires numbers for requiredChains
const walletConnect = walletConnectModule({
  projectId: WC_PROJECT_ID,
  requiredChains: REQUIRED_CHAINS, // ✅ numbers only
  dappUrl: DAPP_URL,
});

// ————————————————————————————————————————————————
// Chains (add your own as needed)
// ————————————————————————————————————————————————
const CHAINS = [
  {
    id: "0x61", // 97
    token: "BNB",
    label: "BSC Testnet",
    rpcUrl: "https://bsc-testnet.publicnode.com",
  },
  {
    id: "0x38", // 56
    token: "BNB",
    label: "BNB Smart Chain",
    rpcUrl: "https://bsc-dataseed.binance.org",
  },
];

// ————————————————————————————————————————————————
// Onboard singleton + init helper
// ————————————————————————————————————————————————
let onboardSingleton: ReturnType<typeof Onboard> | null = null;

export function getOnboard() {
  if (onboardSingleton) return onboardSingleton;

  onboardSingleton = Onboard({
    wallets: [injected, walletConnect],
    chains: CHAINS,
    appMetadata: {
      name: "Coinrush",
      description: "On-chain token tools",
      recommendedInjectedWallets: [{ name: "MetaMask", url: "https://metamask.io" }],
    },
  });

  return onboardSingleton;
}

// Optional: tiny guard to ensure init before hooks from @web3-onboard/react
export async function ensureOnboardInit() {
  return getOnboard();
}
