// src/app/providers/wagmi.ts
"use client";

import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { injected, coinbaseWallet } from "wagmi/connectors";
import type { Chain } from "wagmi/chains";
import { bscTestnet, base } from "wagmi/chains";

export const CHAINS = [bscTestnet, base] as const satisfies readonly [Chain, ...Chain[]];

export const wagmiConfig = createConfig({
  chains: CHAINS,
  transports: {
    [bscTestnet.id]: http(process.env.NEXT_PUBLIC_BSC_HTTP_1 || "https://bsc-testnet.publicnode.com"),
    [base.id]:       http(process.env.NEXT_PUBLIC_BASE_HTTP   || "https://mainnet.base.org"),
  },
  // Only native connectors (no WalletConnect)
  connectors: [
    injected({ shimDisconnect: true }), // MetaMask, Trust, Rabby, OKX (as injected)
    coinbaseWallet({
      appName: "Coinrush",
      // preference: "all",  // ❌ removed – not supported in current versions
      headlessMode: true,    // ✅ keep (optional)
      // version: "4",       // (optional) you can set "3" or "4" if you need a specific SDK version
    }),
  ],
  ssr: true,
  storage: createStorage({ storage: cookieStorage }), // better reconnect on refresh
});
