// src/lib/browserSigner.ts
import { BrowserProvider } from "ethers";

export async function browserSigner(chainId: number) {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No EIP-1193 provider");
  const provider = new BrowserProvider(eth, {
    chainId,
    name: chainId === 97 ? "bsc-testnet" : "bsc",
  });
  return provider.getSigner();
}
