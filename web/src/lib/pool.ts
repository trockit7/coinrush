// src/lib/pool.ts
import { Contract } from "ethers";
import { rpcProviderFor } from "@/lib/rpc";

export type Snapshot = {
  pool: string;
  token: string;
  symbol: string;
  totalSupply: bigint;
  x0: bigint;
  y0: bigint;
  rN: bigint;
  rT: bigint;
  p0: bigint;
  starterSold: bigint;
  starterCap: bigint;
  creatorFeeBps: number;
  platformFeeBps: number;
  tCapWei: bigint;
  pWei: bigint;
  mcWei: bigint;
  starterActive: boolean;
  owner?: string;
  creator?: string;
  tokenDecimals: number;
};

// Minimal read-only ABIs (string fragments keep ethers happy)
const POOL_ABI_RO = [
  "function token() view returns (address)",
  "function x0() view returns (uint256)",
  "function y0() view returns (uint256)",
  "function reserveNative() view returns (uint256)",
  "function reserveToken() view returns (uint256)",
  "function p0WeiPerToken() view returns (uint256)",
  "function starterSold() view returns (uint256)",
  "function starterTrancheTokens() view returns (uint256)",
  "function creatorFeeBps() view returns (uint256)",
  "function platformFeeBps() view returns (uint256)",
  "function targetMarketCapWei() view returns (uint256)",
  "function owner() view returns (address)",
  "function creator() view returns (address)",
] as const;

const ERC20_MIN_ABI = [
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
] as const;

function priceWad(
  rN: bigint,
  rT: bigint,
  x0: bigint,
  y0: bigint,
  decimals: number
) {
  const den = rT + y0;
  if (den === 0n) return 0n;
  const num = (rN + x0) * (10n ** BigInt(decimals));
  return num / den; // wei per token
}

async function optCall<T>(c: any, fn: string, fallback: T): Promise<T> {
  try {
    if (!c?.[fn]) return fallback;
    const v = await c[fn]();
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "bigint"
    ) {
      return v as T;
    }
    // try toString if returned value is a BigNumber-like
    return (v?.toString?.() ?? v) as T;
  } catch {
    return fallback;
  }
}

export async function readSnapshot(
  poolAddr: string,
  chainId: number
): Promise<Snapshot> {
  const provider = rpcProviderFor(chainId); // synchronous; includes network hint
  const pool = new Contract(poolAddr, POOL_ABI_RO, provider) as any;

  const token: string = await pool.token();

  const [x0, y0, rN, rT] = await Promise.all([
    pool.x0(),
    pool.y0(),
    pool.reserveNative(),
    pool.reserveToken(),
  ]);

  const [p0, starterSold, starterCap, creatorB, platB, targetWei] =
    await Promise.all([
      optCall<bigint>(pool, "p0WeiPerToken", 0n),
      optCall<bigint>(pool, "starterSold", 0n),
      optCall<bigint>(pool, "starterTrancheTokens", 0n),
      optCall<bigint>(pool, "creatorFeeBps", 0n),
      optCall<bigint>(pool, "platformFeeBps", 0n),
      optCall<bigint>(pool, "targetMarketCapWei", 0n),
    ]);

  const ownerAddr = await optCall<string>(pool, "owner", "");
  const creatorAddr = await optCall<string>(pool, "creator", "");

  const erc = new Contract(token, ERC20_MIN_ABI, provider) as any;

  let symbol = "TKN";
  let totalSupply = 0n;
  let tokenDecimals = 18;

  try { symbol = await erc.symbol(); } catch {}
  try { totalSupply = await erc.totalSupply(); } catch {}
  try { tokenDecimals = Number(await erc.decimals()); } catch {}

  const pWei = priceWad(rN, rT, x0, y0, tokenDecimals);
  const mcWei =
    totalSupply === 0n
      ? 0n
      : (pWei * totalSupply) / (10n ** BigInt(tokenDecimals));

  return {
    pool: poolAddr,
    token,
    symbol,
    totalSupply,
    x0,
    y0,
    rN,
    rT,
    p0,
    starterSold,
    starterCap,
    creatorFeeBps: Number(creatorB),
    platformFeeBps: Number(platB),
    tCapWei: targetWei,
    pWei,
    mcWei,
    starterActive: p0 > 0n && starterSold < starterCap && starterCap > 0n,
    owner: (ownerAddr || "").toLowerCase(),
    creator: (creatorAddr || "").toLowerCase(),
    tokenDecimals,
  };
}
