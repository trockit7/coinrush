// src/lib/chains.ts
export const CHAINS: Record<56 | 97, { name: string; rpc: string; pancakeRouter: string }> = {
  97: {
    name: "BSC Testnet",
    rpc:
      process.env.NEXT_PUBLIC_BSC_HTTP_1 ||
      "https://bsc-testnet-rpc.publicnode.com",
    pancakeRouter:
      process.env.NEXT_PUBLIC_PANCAKE_ROUTER_TESTNET ||
      "0xD99D1c33F9fC3444f8101754aBC46c52416550D1",
  },
  56: {
    name: "BSC Mainnet",
    rpc:
      process.env.NEXT_PUBLIC_BSC_MAINNET_HTTP_1 ||
      "https://bsc-dataseed1.binance.org",
    pancakeRouter:
      process.env.NEXT_PUBLIC_PANCAKE_ROUTER_MAINNET ||
      "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  },
};

// Arrays for fallback rotation in the browser
export const CHAIN_RPC: Record<number, string[]> = {
  97: [
    process.env.NEXT_PUBLIC_BSC_HTTP_1,
    process.env.NEXT_PUBLIC_BSC_HTTP_2,
    process.env.NEXT_PUBLIC_BSC_HTTP_3,
    process.env.NEXT_PUBLIC_BSC_HTTP_4,
    process.env.NEXT_PUBLIC_BSC_HTTP_5,
    // final hard-coded fallbacks:
    "https://bsc-testnet-rpc.publicnode.com",
    "https://data-seed-prebsc-2-s3.binance.org:8545",
    "https://bsc-testnet.public.blastapi.io",
    "https://endpoints.omniatech.io/v1/bsc/testnet/public",
    "https://bsc-testnet.blockpi.network/v1/rpc/public",
  ].filter(Boolean) as string[],
  56: [
    process.env.NEXT_PUBLIC_BSC_MAINNET_HTTP_1,
    process.env.NEXT_PUBLIC_BSC_MAINNET_HTTP_2,
    "https://bsc-dataseed1.binance.org",
  ].filter(Boolean) as string[],
};
