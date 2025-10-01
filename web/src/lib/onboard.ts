// src/lib/onboard.ts
"use client";

import Onboard, { OnboardAPI } from "@web3-onboard/core";
import injectedModule from "@web3-onboard/injected-wallets";
import coinbaseModule from "@web3-onboard/coinbase";

const injected = injectedModule({
  // If you want to **hide Trust** later:
  // filter: (wallets) => wallets.filter(w => !/trust/i.test(w.label)),
});

// ✅ `coinbaseModule` does not accept `appName`; use appMetadata.name below instead.
const coinbase = coinbaseModule({
  darkMode: true,
  // enableMobileWalletLink: true,     // optional
  // reloadOnDisconnect: false,        // optional
  // supportedWalletType: "all",       // optional: "eoaOnly" | "smartWalletOnly" | "all"
});

const CHAINS = [
  {
    id: "0x61", // 97
    token: "tBNB",
    label: "BSC Testnet",
    rpcUrl:
      process.env.NEXT_PUBLIC_BSC_TESTNET_RPC ||
      "https://data-seed-prebsc-1-s1.binance.org:8545",
  },
  {
    id: "0x38", // 56
    token: "BNB",
    label: "BSC",
    rpcUrl:
      process.env.NEXT_PUBLIC_BSC_RPC ||
      "https://bsc-dataseed.binance.org",
  },
];

let _onboard: OnboardAPI | null = null;

export function getOnboard(): OnboardAPI {
  if (_onboard) return _onboard;
  _onboard = Onboard({
    wallets: [injected, coinbase],
    chains: CHAINS,
    appMetadata: {
      name: "Coinrush",
      description: "Coinrush dApp",
      icon: "<svg/>", // you can replace with a data URL or hosted icon
    },
    theme: "dark",
    accountCenter: {
      desktop: { enabled: false },
      mobile: { enabled: false },
    },
  });
  return _onboard;
}
