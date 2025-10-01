// src/lib/allowance.ts
import { Contract } from "ethers";
import { ERC20_ABI } from "@/lib/abi";
import { rpcProviderFor } from "@/lib/rpc";

export const MAX_UINT256 = (1n << 256n) - 1n;

export async function getAllowanceOf(
  chainId: number,
  tokenAddr: string,
  owner: string,
  spender: string
): Promise<bigint> {
  try {
    const prov = rpcProviderFor(chainId); // ✅ no await, uses network hint
    const erc = new Contract(tokenAddr, ERC20_ABI, prov) as any;
    const allowance: bigint = await erc.allowance(owner, spender);
    return allowance;
  } catch {
    return 0n;
  }
}

export async function ensureAllowanceIfNeeded(opts: {
  tokenAddr: string;
  owner: string;
  spender: string;
  signer: any;       // ethers.Signer
  want: bigint;
  grant?: bigint;    // default: MAX_UINT256
  onStatus?: (s: string) => void;
}) {
  const { tokenAddr, owner, spender, signer, want, grant = MAX_UINT256, onStatus } = opts;
  const token = new Contract(tokenAddr, ERC20_ABI, signer) as any;

  onStatus?.("checking-allowance");
  const current: bigint = await token.allowance(owner, spender);
  if (current >= want) { onStatus?.("allowance-ok"); return false; }

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
