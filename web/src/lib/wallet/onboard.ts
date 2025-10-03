// src/lib/wallet/onboard.ts
"use client";

import Onboard from "@web3-onboard/core";
import injectedModule, { ProviderLabel } from "@web3-onboard/injected-wallets";
import walletConnectModule from "@web3-onboard/walletconnect";

// ————————————————————————————————————————————————
// Env → safe config
// ————————————————————————————————————————————————
const DAPP_URL =
  process.env.NEXT_PUBLIC_DAPP_URL ||
  (typeof window !== "undefined" ? window.location.origin : "");

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

function parseRequiredChains(): number[] {
  const raw =
    process.env.NEXT_PUBLIC_REQUIRED_CHAINS ||
    process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID ||
    "97"; // default BSC Testnet
  return String(raw)
    .split(",")
    .map(s => Number(String(s).trim()))
    .filter(n => Number.isFinite(n));
}

const REQUIRED_CHAINS = (() => {
  const arr = parseRequiredChains();
  return arr.length ? arr : [97];
})();

// ————————————————————————————————————————————————
// Wallet modules
// ————————————————————————————————————————————————
const injected = injectedModule({
  // Keep only MetaMask to avoid injected hijacks
  filter: wallets =>
    wallets.filter(
      w => w.label === ProviderLabel.MetaMask || w.label === "MetaMask"
    ),
});

const walletConnect = walletConnectModule({
  projectId: WC_PROJECT_ID,
  requiredChains: REQUIRED_CHAINS, // ✅ numbers only
  dappUrl: DAPP_URL,
});

// ————————————————————————————————————————————————
// Chains (extend as needed)
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
// Onboard singleton
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

// Default export (what your code imports as `onboard`)
const onboard = getOnboard();
export default onboard;

// ————————————————————————————————————————————————
// Helpers expected elsewhere in your app
// ————————————————————————————————————————————————
const LS_LAST_WALLET = "cr:lastWalletLabel";

/**
 * Subscribe to wallet changes and remember the last connected wallet label
 * in localStorage. Returns an unsubscribe function.
 */
export function subscribeRememberWallet(): () => void {
  const ob = getOnboard();
  // select the 'wallets' slice and subscribe to changes
  const selector = ob.state.select("wallets");
  const unsubscribe = ob.state.subscribe(selector, (wallets: any[]) => {
    try {
      const first = wallets?.[0];
      if (first?.label) {
        localStorage.setItem(LS_LAST_WALLET, String(first.label));
      } else {
        localStorage.removeItem(LS_LAST_WALLET);
      }
    } catch {
      /* ignore */
    }
  });
  return unsubscribe;
}

/**
 * Try to reconnect the last wallet silently (no modal).
 * Safe to call on app load.
 */
export async function autoReconnectLastWallet(): Promise<void> {
  try {
    const ob = getOnboard();
    const last = localStorage.getItem(LS_LAST_WALLET);
    if (!last) return;
    await ob.connectWallet({
      autoSelect: { label: last, disableModals: true },
    });
  } catch {
    // ignore; user can connect manually
  }
}

/**
 * Optional convenience to ensure Onboard is constructed early (e.g., in a provider).
 */
export async function ensureOnboardInit() {
  getOnboard();
}
