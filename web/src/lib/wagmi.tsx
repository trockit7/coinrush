// src/lib/wagmi.tsx
"use client";

import * as React from "react";
import { WagmiProvider, http, createConfig } from "wagmi";
import { bsc, bscTestnet } from "wagmi/chains";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";


const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";
const appName = "Coinrush";

// Pick the chains you support
const chains = [bscTestnet, bsc];

// Provide explicit RPCs (optional but recommended)
const transports = {
  [bscTestnet.id]: http(
    process.env.NEXT_PUBLIC_BSC_HTTP_1 ||
      "https://bsc-testnet-rpc.publicnode.com"
  ),
  [bsc.id]: http(
    process.env.NEXT_PUBLIC_BSC_MAINNET_HTTP_1 ||
      "https://bsc-dataseed.binance.org"
  ),
};

// Build the Wagmi config with RainbowKit defaults (includes Coinbase, MetaMask, WalletConnect, etc.)
const config = getDefaultConfig({
  appName,
  projectId,            // ✅ required for WalletConnect / most wallets
  chains,
  transports,
  ssr: true,
});

const queryClient = new QueryClient();

export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          modalSize="compact"
          theme={darkTheme({ accentColor: "#00e0ff" })}
          showRecentTransactions={false}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
