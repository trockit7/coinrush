// web/src/lib/wallet/onboard.ts
"use client";

import Onboard from "@web3-onboard/core";
import injectedModule from "@web3-onboard/injected-wallets";
import walletConnectModule from "@web3-onboard/walletconnect";
// import coinbaseWalletModule from "@web3-onboard/coinbase" // (OPTIONAL) add later if needed

// 1) Only allow the injected wallets you want (MetaMask only)
//    Filters out Trust/CB injected so they don't hijack the provider
const injected = injectedModule({
  filter: (wallets) => wallets.filter((w) => w.label === "MetaMask"),
});

// 2) WalletConnect (for mobile / non-MM users) — includes dappUrl
const walletConnect = walletConnectModule({
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  requiredChains: [97], // BSC Testnet (decimal for WC v2)
  dappUrl: process.env.NEXT_PUBLIC_DAPP_URL!, // helps WC deep-link + removes warning
});

// 3) Build Onboard
const onboard = Onboard({
  wallets: [
    injected,
    walletConnect,
    // coinbaseWalletModule() // (OPTIONAL) add back if you really need Coinbase
  ],
  chains: [
    {
      id: "0x61", // 97
      token: "tBNB",
      label: "BSC Testnet",
      rpcUrl: process.env.NEXT_PUBLIC_BSC_HTTP_1!,
    },
  ],
  appMetadata: {
    name: "Coinrush",
    description: "Coinrush on BSC Testnet",
    icon: "https://coinrush-production.up.railway.app/icon.png",
    gettingStartedGuide: process.env.NEXT_PUBLIC_DAPP_URL!,
    explore: process.env.NEXT_PUBLIC_DAPP_URL!,
    recommendedInjectedWallets: [{ name: "MetaMask", url: "https://metamask.io" }],
  },
});

export default onboard;

// 4) Auto-reconnect the last used wallet on app start
export async function autoReconnectLastWallet() {
  if (typeof window === "undefined") return;
  const last = window.localStorage.getItem("cr_last_wallet_label");
  if (!last) return;
  try {
    await onboard.connectWallet({
      autoSelect: { label: last, disableModals: true },
    });
  } catch {
    // ignore
  }
}

// 5) Subscribe once to remember the current wallet label
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
