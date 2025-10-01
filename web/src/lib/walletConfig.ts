// src/lib/walletConfig.ts
import { createConfig, http } from "wagmi";
import { bscTestnet, bsc, base, baseSepolia } from "wagmi/chains";
import { metaMask, coinbaseWallet } from "wagmi/connectors";
import { QueryClient } from "@tanstack/react-query";

export const CHAINS = [bscTestnet, bsc, base, baseSepolia] as const;

export const TRANSPORTS = {
  [bscTestnet.id]: http(process.env.NEXT_PUBLIC_BSC_TESTNET_RPC || "https://data-seed-prebsc-1-s1.binance.org:8545"),
  [bsc.id]:        http(process.env.NEXT_PUBLIC_BSC_RPC || "https://bsc-dataseed.binance.org"),
  [base.id]:       http(process.env.NEXT_PUBLIC_BASE_RPC || "https://mainnet.base.org"),
  [baseSepolia.id]:http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC || "https://sepolia.base.org"),
} as const;

// ONLY these two; no Injected, no WalletConnect
export const CONNECTORS = [
  metaMask(),
  coinbaseWallet({ appName: "Coinrush" }),
];

export const wagmiConfig = createConfig({
  chains: CHAINS,
  transports: TRANSPORTS,
  connectors: CONNECTORS,
  ssr: true,
});

export const queryClient = new QueryClient();
