import { JsonRpcProvider } from "ethers";

export function rpcProviderFor(chainId: number) {
  const url =
    chainId === 97
      ? (process.env.NEXT_PUBLIC_BSC_TESTNET_RPC ||
         "https://data-seed-prebsc-1-s1.binance.org:8545")
      : (process.env.NEXT_PUBLIC_BSC_RPC ||
         "https://bsc-dataseed.binance.org");

  // Provide network hint so ethers doesn’t “detect” it (avoids retry logs)
  return new JsonRpcProvider(url, {
    chainId,
    name: chainId === 97 ? "bsc-testnet" : "bsc",
  });
}
