"use client";

import { BrowserProvider, Contract } from "ethers";
import { ERC20_ABI } from "@/lib/abi";

export async function ensureChain(provider: BrowserProvider, chainId = 97) {
  const net = await provider.getNetwork();
  if (Number(net.chainId) === chainId) return;
  try {
    await provider.send("wallet_switchEthereumChain", [{ chainId: "0x61" }]); // 97
  } catch {
    await provider.send("wallet_addEthereumChain", [
      {
        chainId: "0x61",
        chainName: "BSC Testnet",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        rpcUrls: ["https://bsc-testnet.publicnode.com"],
        blockExplorerUrls: ["https://testnet.bscscan.com"],
      },
    ]);
  }
}

export async function getSignerFromInjected(chainId = 97) {
  const eth: any = (window as any).ethereum;
  if (!eth) throw new Error("Open your wallet and connect first.");
  const provider = new BrowserProvider(eth);
  await ensureChain(provider, chainId);
  return provider.getSigner();
}

const MAX_UINT256 = (1n << 256n) - 1n;
export async function ensureAllowanceIfNeeded(opts: {
  tokenAddr: string;
  owner: string;
  spender: string;
  signer: any;
  want: bigint;
  grant?: bigint;
  onStatus?: (s: string) => void;
}) {
  const { tokenAddr, owner, spender, signer, want, grant = MAX_UINT256, onStatus } = opts;
  const token = new Contract(tokenAddr, ERC20_ABI, signer) as any;

  onStatus?.("checking-allowance");
  const current: bigint = await token.allowance(owner, spender);
  if (current >= want) {
    onStatus?.("allowance-ok");
    return false;
  }

  onStatus?.("approving");
  try {
    const tx = await token.approve(spender, grant);
    await tx.wait();
    onStatus?.("approved");
    return true;
  } catch {}
  try {
    const tx0 = await token.approve(spender, 0n);
    await tx0.wait();
    const tx1 = await token.approve(spender, grant);
    await tx1.wait();
    onStatus?.("approved");
    return true;
  } catch {}
  const tx2 = await token.approve(spender, want);
  await tx2.wait();
  onStatus?.("approved");
  return true;
}
