// src/lib/tradePreview.ts
import { Contract, JsonRpcProvider } from "ethers";
import { CHAIN_RPC } from "@/lib/chains";

// ───────────────────────────────────────────────────────
// Minimal ethers-friendly ABIs used here (string fragments)
// ───────────────────────────────────────────────────────
const POOL_ABI_RO = [
  "function token() view returns (address)",
  "function x0() view returns (uint256)",
  "function y0() view returns (uint256)",
  "function reserveNative() view returns (uint256)",
  "function reserveToken() view returns (uint256)",
  "function creatorFeeBps() view returns (uint256)",
  "function platformFeeBps() view returns (uint256)",
] as const;

const ERC20_MIN_ABI = [
  "function decimals() view returns (uint8)",
] as const;

// ─── Public defaults & toggles (can be overridden via .env) ───
export const DEFAULT_SLIPPAGE_BPS = Number(
  process.env.NEXT_PUBLIC_DEFAULT_SLIPPAGE_BPS || "100" // 1%
);
export const AUTO_SLIPPAGE =
  (process.env.NEXT_PUBLIC_AUTO_SLIPPAGE ?? "true").toLowerCase() === "true";

// ─── Constants ───
const WAD = 10n ** 18n;
const BPS_DEN = 10_000n;

export type PoolSnapshot = {
  chainId: number;
  pool: string;
  token: string;           // token address
  tokenDecimals: number;   // decimals
  x0: bigint;              // virtual native (wei)
  y0: bigint;              // virtual token units
  rN: bigint;              // reserve native (wei)
  rT: bigint;              // reserve token (units)
  feeBps: number;          // total trade fee in bps, applied in native
};

export type BuyPreview = {
  tokensOut: bigint;       // raw token units (post-fee, post-curve)
  feeWei: bigint;          // native fee taken from input
  effectiveInWei: bigint;  // native that actually hits the curve
  priceAfterWeiPerToken: bigint; // new price after trade (wei/token, 1e18-scaled)
  minTokensOut: bigint;    // applying slippage guard
};

export type SellPreview = {
  nativeOutWei: bigint;    // post-fee native out
  feeWei: bigint;          // native fee taken from gross out
  grossWei: bigint;        // pre-fee native from curve
  priceAfterWeiPerToken: bigint; // price after trade
  minNativeOutWei: bigint; // applying slippage guard
};

// Never returns 0 unless you explicitly disable min-received.
// Guarantees at least 1 wei of tokens/native for protection.
export function calcMinOut(out: bigint, slippageBps: number): bigint {
  const s = Math.max(0, Math.min(10_000, Number.isFinite(slippageBps) ? slippageBps : 500));
  if (out <= 0n) return 1n;
  const m = (out * BigInt(10_000 - s)) / 10_000n;
  return m > 0n ? m : 1n;
}

// Optional: a simple auto-slippage heuristic based on trade size vs depth
export function autoSlippageBps(
  X: bigint,
  Y: bigint,
  deltaX: bigint | null,
  deltaY: bigint | null
): number {
  try {
    const depth = Number(X > Y ? X : Y);
    const move  = Number((deltaX ?? deltaY ?? 0n));
    if (!Number.isFinite(depth) || depth <= 0) return DEFAULT_SLIPPAGE_BPS;
    const frac = move / depth; // ~trade fraction of depth
    if (frac <= 0.0005) return 50;   // 0.50%
    if (frac <= 0.002)  return 100;  // 1.0%
    if (frac <= 0.01)   return 200;  // 2.0%
    if (frac <= 0.05)   return 300;  // 3.0%
    return 500;                       // 5.0% for very large moves
  } catch {
    return DEFAULT_SLIPPAGE_BPS;
  }
}

// Provider helper
function getProvider(chainId: number) {
  const arr = (CHAIN_RPC as any)[chainId] as string[] | undefined;
  if (!arr?.length) throw new Error("Missing RPC config for chain " + chainId);
  // simple, fast provider; no health-check here
  return new JsonRpcProvider(arr[0], { chainId, name: String(chainId) });
}

// Load a consistent snapshot of pool state needed for previews
export async function loadPoolSnapshot(opts: {
  chainId: number;
  pool: string;
  tokenOverride?: string;       // if pool.token() isn't present
  tokenDecimalsOverride?: number;
  feeBpsOverride?: number;      // if pool doesn't expose fees, pass (creator+platform) here
}): Promise<PoolSnapshot> {
  const { chainId, pool, tokenOverride, tokenDecimalsOverride, feeBpsOverride } = opts;
  const prov = getProvider(chainId);
  const p = new Contract(pool, POOL_ABI_RO, prov) as any;

  // token address
  let token: string = tokenOverride || "";
  try { token = String(await p.token()); } catch {}
  if (!token) token = tokenOverride || pool; // fallback: param was token address

  // decimals
  let tokenDecimals = tokenDecimalsOverride ?? 18;
  try {
    const t = new Contract(token, ERC20_MIN_ABI, prov) as any;
    tokenDecimals = Number(await t.decimals());
  } catch {}

  // virtuals and reserves
  const [x0, y0, rN, rT] = await Promise.all([
    p.x0?.().catch(() => 0n),
    p.y0?.().catch(() => 0n),
    p.reserveNative?.().catch(() => 0n),
    p.reserveToken?.().catch(() => 0n),
  ]);

  // fees (total bps in native). Try pool fields; fallback to override or 0.
  let feeBps = feeBpsOverride ?? 0;
  try {
    const cf = Number(await p.creatorFeeBps());
    const pf = Number(await p.platformFeeBps());
    if (Number.isFinite(cf) && Number.isFinite(pf)) feeBps = cf + pf;
  } catch {}
  if (!Number.isFinite(feeBps)) feeBps = feeBpsOverride ?? 0;

  return { chainId, pool, token, tokenDecimals, x0, y0, rN, rT, feeBps };
}

// ─── Core math (constant product with virtual reserves) ───
// price (wei/token, 1e18-scaled) = ( (rN + x0) * 1e18 ) / (rT + y0)

export function previewBuy(
  snapshot: PoolSnapshot,
  nativeInWei: bigint,
  slippageBps?: number
): BuyPreview {
  const fee = (nativeInWei * BigInt(snapshot.feeBps)) / BPS_DEN; // fee taken in native
  const eff = nativeInWei - fee;                                 // amount that hits curve

  const X = snapshot.rN + snapshot.x0;                           // native depth (wei)
  const Y = snapshot.rT + snapshot.y0;                           // token depth (units)

  if (eff <= 0n || X <= 0n || Y <= 0n) {
    const minOut = calcMinOut(0n, slippageBps ?? DEFAULT_SLIPPAGE_BPS);
    return {
      tokensOut: 0n,
      feeWei: fee,
      effectiveInWei: eff,
      priceAfterWeiPerToken: X > 0n && Y > 0n ? (X * WAD) / Y : 0n,
      minTokensOut: minOut,
    };
  }

  // tokensOut = Y * eff / (X + eff)
  const tokensOut = (Y * eff) / (X + eff);
  const tokensNonZero = tokensOut > 0n ? tokensOut : 1n;

  // After trade
  const Xp = X + eff;
  const Yp = Y - tokensNonZero;
  const priceAfter = Yp > 0n ? (Xp * WAD) / Yp : (Xp * WAD); // avoid div by zero

  // Slippage setting
  let slip = slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  if (AUTO_SLIPPAGE) slip = autoSlippageBps(X, Y, eff, null);

  const minOut = calcMinOut(tokensNonZero, slip);

  return {
    tokensOut: tokensNonZero,
    feeWei: fee,
    effectiveInWei: eff,
    priceAfterWeiPerToken: priceAfter,
    minTokensOut: minOut,
  };
}

export function previewSell(
  snapshot: PoolSnapshot,
  tokensIn: bigint,
  slippageBps?: number
): SellPreview {
  const X = snapshot.rN + snapshot.x0;          // wei
  const Y = snapshot.rT + snapshot.y0;          // token units

  if (tokensIn <= 0n || X <= 0n || Y <= 0n) {
    const minOut = calcMinOut(0n, slippageBps ?? DEFAULT_SLIPPAGE_BPS);
    return {
      nativeOutWei: 0n,
      feeWei: 0n,
      grossWei: 0n,
      priceAfterWeiPerToken: X > 0n && Y > 0n ? (X * WAD) / Y : 0n,
      minNativeOutWei: minOut,
    };
  }

  // gross native out from curve:
  // gross = X * tokensIn / (Y + tokensIn)
  const gross = (X * tokensIn) / (Y + tokensIn);

  // fee in native (taken from proceeds)
  const fee = (gross * BigInt(snapshot.feeBps)) / BPS_DEN;
  const net = gross - fee;
  const netNonZero = net > 0n ? net : 1n;

  // After trade
  const Xp = X - gross;
  const Yp = Y + tokensIn;
  const priceAfter = Yp > 0n ? (Xp * WAD) / Yp : 0n;

  // Slippage setting
  let slip = slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  if (AUTO_SLIPPAGE) slip = autoSlippageBps(X, Y, null, tokensIn);

  const minNative = calcMinOut(netNonZero, slip);

  return {
    nativeOutWei: netNonZero,
    feeWei: fee,
    grossWei: gross,
    priceAfterWeiPerToken: priceAfter,
    minNativeOutWei: minNative,
  };
}
