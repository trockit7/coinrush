// src/app/providers/wagmi-config.ts
"use client";

import { createConfig, cookieStorage, createStorage, http } from "wagmi";
import type { Chain } from "wagmi/chains";
import { base, bscTestnet } from "wagmi/chains";

export const CHAINS = [base, bscTestnet] as const satisfies readonly [Chain, ...Chain[]];

// NOTE: RainbowKit was removed, so we no longer use getDefaultConfig / projectId / appName / etc.
const SITE_URL =
  typeof window !== "undefined"
    ? window.location.origin
    : process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// Minimal Wagmi config for read/write via your own connectors (Web3 Onboard).
// If you later add Wagmi connectors, you can pass a `connectors` array here.
export const wagmiConfig = createConfig({
  chains: CHAINS,
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
  transports: {
    [base.id]:       http(process.env.NEXT_PUBLIC_BASE_HTTP || "https://mainnet.base.org"),
    [bscTestnet.id]: http(process.env.NEXT_PUBLIC_BSC_HTTP_1 || "https://bsc-testnet.publicnode.com"),
  },
  // connectors: [], // optional: leave empty since you're using Web3 Onboard for wallet connections
});

// (Optional) You can export SITE_URL if other providers need it.
export { SITE_URL };
