// src/lib/wagmi.ts
import { createConfig, http } from "wagmi";
import { bscTestnet, bsc } from "wagmi/chains";

export const wagmiConfig = createConfig({
  chains: [bscTestnet, bsc],
  transports: {
    [bscTestnet.id]: http(
      process.env.NEXT_PUBLIC_BSC_HTTP_1 || "https://bsc-testnet-rpc.publicnode.com"
    ),
    [bsc.id]: http(
      process.env.NEXT_PUBLIC_BSC_MAINNET_HTTP_1 || "https://bsc-dataseed.binance.org"
    ),
  },
});
