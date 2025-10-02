// src/lib/wallet/onboard.ts
"use client";

import Onboard, { type InitOptions } from "@web3-onboard/core";
import injectedModule, { ProviderLabel } from "@web3-onboard/injected-wallets";
import walletConnectModule from "@web3-onboard/walletconnect";

// Narrow type for injected init options (helps TS without extra types)
type InjectedInit = Parameters<typeof injectedModule>[0];

/* 1) Injected wallets — prioritize MetaMask at the top */
const injected = injectedModule({
  sort: (wallets) => {
    const mm = wallets.find((w) => w.label === ProviderLabel.MetaMask);
    return [mm, ...wallets.filter((w) => w.label !== ProviderLabel.MetaMask)].filter(
      Boolean
    );
  }
} as InjectedInit);

/* 2) WalletConnect — use hex chain id + rpcUrl object shape */
const walletConnect = walletConnectModule({
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
  requiredChains: [
    {
      id: "0x61",
      rpcUrl:
        process.env.NEXT_PUBLIC_BSC_HTTP_1 ||
        "https://bsc-testnet.publicnode.com"
    }
  ],
  // prefer SITE_URL; fall back to DAPP_URL or a safe placeholder
  dappUrl:
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_DAPP_URL ||
    "https://your.domain"
});

/* 3) Build Onboard */
export const onboard = Onboard({
  wallets: [injected, walletConnect],
  chains: [
    {
      id: "0x61",
      token: "BNB",
      label: "BSC Testnet",
      rpcUrl:
        process.env.NEXT_PUBLIC_BSC_HTTP_1 ||
        "https://bsc-testnet.publicnode.com"
    }
  ],
  // (optional) keep your app metadata if you want it shown in Onboard’s UI
  appMetadata: {
    name: "Coinrush",
    description: "Coinrush on BSC Testnet",
    icon: "https://coinrush-production.up.railway.app/icon.png",
    gettingStartedGuide:
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_DAPP_URL ||
      "https://your.domain",
    explore:
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_DAPP_URL ||
      "https://your.domain",
    recommendedInjectedWallets: [{ name: "MetaMask", url: "https://metamask.io" }]
  }
} satisfies InitOptions);

// Keep default export to match existing imports elsewhere in the app
export default onboard;

/* 4) Auto-reconnect the last used wallet on app start */
export async function autoReconnectLastWallet() {
  if (typeof window === "undefined") return;
  const last = window.localStorage.getItem("cr_last_wallet_label");
  if (!last) return;
  try {
    await onboard.connectWallet({
      autoSelect: { label: last, disableModals: true }
    });
  } catch {
    // ignore
  }
}

/* 5) Subscribe once to remember the current wallet label */
let subscribed = false;
export function subscribeRememberWallet() {
  if (subscribed) return;
  subscribed = true;
  onboard.state.select("wallets").subscribe((wallets) => {
    const label = wallets[0]?.label;
    if (label) {
      window.localStorage.setItem("cr_last_wallet_label", label);
    } else {
      window.localStorage.removeItem("cr_last_wallet_label");
    }
  });
}
