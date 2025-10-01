// src/lib/sell.ts
"use client";

import { Contract, BrowserProvider, ZeroAddress } from "ethers";

// ⚠️ Use minimal ethers-friendly ABIs here to avoid InterfaceAbi type clashes.
const ERC20_MIN_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

const POOL_ABI_RW = [
  // common curve pool signatures (one of these will exist on your pool)
  "function sell(uint256 tokenIn, uint256 minOut) returns (uint256)",
  "function sell(uint256 minOut) returns (uint256)",
] as const;

/** Get a signer from the currently selected wallet (RainbowKit/wagmi injects window.ethereum). */
async function getSigner() {
  const anyEth =
    typeof window !== "undefined" ? (window as any).ethereum : undefined;
  if (!anyEth) throw new Error("No EIP-1193 provider found (window.ethereum missing)");
  const provider = new BrowserProvider(anyEth);
  return await provider.getSigner();
}

async function getLegacyGasPrice(provider: any): Promise<bigint> {
  try {
    const fd = await provider?.getFeeData?.();
    const gp = fd?.gasPrice ?? fd?.maxFeePerGas;
    if (gp != null) return BigInt(gp);
  } catch {}
  try {
    const gp = await provider?.getGasPrice?.();
    if (gp != null) return BigInt(gp);
  } catch {}
  // fallback 10 gwei
  return 10n * 10n ** 9n;
}

/** Ensure allowance >= amount for `spender`. Approves exactly `amount` (or adjust if you prefer). */
export async function ensureAllowance(
  tokenAddr: string,
  ownerAddr: string,
  spenderAddr: string,
  amount: bigint
) {
  if (!tokenAddr || tokenAddr === ZeroAddress) throw new Error("Bad token address");
  const signer = await getSigner();
  const erc20 = new Contract(tokenAddr, ERC20_MIN_ABI, signer) as any;

  // Current allowance
  let current: bigint = 0n;
  try {
    current = await erc20.allowance(ownerAddr, spenderAddr);
  } catch {
    current = 0n;
  }
  if (current >= amount) return; // already enough

  const gp = await getLegacyGasPrice(signer.provider!);

  // Estimate + pad (120%)
  let gasLimit: bigint = 150_000n;
  try {
    const est: bigint = await erc20.estimateGas.approve(spenderAddr, amount);
    gasLimit = (est * 120n) / 100n;
  } catch {}

  const tx = await erc20.approve(spenderAddr, amount, {
    // force legacy transaction on BSC/BSC testnet
    type: 0,
    gasPrice: gp,
    gasLimit,
  });
  await tx.wait();
}

/**
 * Perform a sell on the bonding-curve pool.
 * Tries 2-arg signature `sell(amountIn, minOut)` first, then falls back to `sell(minOut)`.
 */
export async function sellTokens(
  poolAddr: string,
  amountIn: bigint, // tokens to sell (in token's smallest units)
  minOut: bigint    // minimum BNB wei you accept (slippage guard)
) {
  const signer = await getSigner();
  const pool = new Contract(poolAddr, POOL_ABI_RW, signer) as any;
  const gp = await getLegacyGasPrice(signer.provider!);

  // Try the 2-arg signature first: sell(amountIn, minOut)
  try {
    const est: bigint = await pool.estimateGas.sell(amountIn, minOut);
    const gasLimit = (est * 120n) / 100n;
    const tx = await pool.sell(amountIn, minOut, {
      type: 0, // legacy
      gasPrice: gp,
      gasLimit,
      value: 0n,
    });
    const rc = await tx.wait();
    return rc?.hash as string | undefined;
  } catch {
    // Fallback to 1-arg signature: sell(minOut)
    const est: bigint = await pool.estimateGas.sell(minOut).catch(() => 120_000n);
    const gasLimit = (est * 120n) / 100n;
    const tx = await pool.sell(minOut, {
      type: 0,
      gasPrice: gp,
      gasLimit,
      value: 0n,
    });
    const rc = await tx.wait();
    return rc?.hash as string | undefined;
  }
}
