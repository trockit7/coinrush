// src/lib/tokenPublic.ts
"use client";
// Lightweight public-facing helpers copied (surgically) from your token page.
// Keeps UI pages tiny while reusing exact chain logic.

import {
  Contract,
  Interface,
  JsonRpcProvider,
  formatEther,
  formatUnits,
  id as keccakId,
} from "ethers";
import { CHAINS, CHAIN_RPC } from "@/lib/chains";

/* ────────────────────────────────────────────────────────
   Minimal ethers-friendly ABIs (string fragments only)
   ─ use only what we call/parse to avoid viem<->ethers type clashes
   ──────────────────────────────────────────────────────── */
const POOL_ABI_RO = [
  // reads used across this file
  "function token() view returns (address)",
  "function x0() view returns (uint256)",
  "function y0() view returns (uint256)",
  "function reserveNative() view returns (uint256)",
  "function reserveToken() view returns (uint256)",
  "function p0WeiPerToken() view returns (uint256)",       // optional
  "function starterSold() view returns (uint256)",         // optional
  "function starterTrancheTokens() view returns (uint256)",// optional
  "function creatorFeeBps() view returns (uint256)",       // optional
  "function platformFeeBps() view returns (uint256)",      // optional
  "function targetMarketCapWei() view returns (uint256)",  // optional
  "function creationBlock() view returns (uint256)",       // optional
  "function owner() view returns (address)",               // optional
  "function creator() view returns (address)",             // optional
] as const;

const POOL_EVENTS = [
  // we only need correct arity/types to parse; names/indexed-ness can be generic
  "event Buy(address indexed trader, uint256 a, uint256 b, uint256 c)",
  "event Sell(address indexed trader, uint256 a, uint256 b, uint256 c)",
] as const;

const POOL_ABI_FOR_IFACE = [...POOL_ABI_RO, ...POOL_EVENTS] as const;

const ERC20_MIN_ABI = [
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
] as const;

/*────────────────────────────────────────────────────────
  Tunables (same envs as your page)
────────────────────────────────────────────────────────*/
const LOGS_LOOKBACK_BLOCKS = Number(
  process.env.NEXT_PUBLIC_LOGS_LOOKBACK_BLOCKS || "200000"
);
const LOGS_CHUNK_BLOCKS = Number(
  process.env.NEXT_PUBLIC_LOGS_CHUNK_BLOCKS || "6000"
);
const LOGS_MAX_CALLS = Number(process.env.NEXT_PUBLIC_LOGS_MAX_CALLS || "80");
const TRADES_WANT = Number(process.env.NEXT_PUBLIC_TRADES_WANT || "120");

/*────────────────────────────────────────────────────────
  Shared provider
────────────────────────────────────────────────────────*/
export async function getProvider(
  chainId = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID || 97)
): Promise<JsonRpcProvider> {
  const urls = CHAIN_RPC[chainId] || [CHAINS[chainId as 56 | 97].rpc];
  for (const u of urls) {
    try {
      const p = new JsonRpcProvider(u, chainId);
      await p.getBlockNumber();
      return p;
    } catch {}
  }
  throw new Error("All RPCs failed");
}

/*────────────────────────────────────────────────────────
  Logs helpers
────────────────────────────────────────────────────────*/
async function getCreationBlock(provider: JsonRpcProvider, poolAddr: string) {
  try {
    const pool = new Contract(poolAddr, POOL_ABI_RO, provider) as any;
    const b: bigint = await pool.creationBlock();
    return Number(b);
  } catch {
    const latest = await provider.getBlockNumber();
    return Math.max(0, latest - LOGS_LOOKBACK_BLOCKS);
  }
}

async function getLogsBackfill(
  provider: JsonRpcProvider,
  filter: { address: string; topics: any },
  fromBlock: number,
  toBlock: number,
  want = 12,
  step = LOGS_CHUNK_BLOCKS
) {
  const out: any[] = [];
  const latest = await provider.getBlockNumber();
  const floor = Math.max(fromBlock, latest - LOGS_LOOKBACK_BLOCKS);
  let end = Math.min(toBlock, latest);
  let size = Math.max(512, Math.min(step, LOGS_CHUNK_BLOCKS));
  let calls = 0;

  while (end >= floor && out.length < want && calls < LOGS_MAX_CALLS) {
    const start = Math.max(floor, end - size + 1);
    try {
      const part = await provider.getLogs({ ...filter, fromBlock: start, toBlock: end });
      calls++;
      if (Array.isArray(part) && part.length) out.push(...part);
      end = start - 1;
      if (size < LOGS_CHUNK_BLOCKS) size = Math.min(LOGS_CHUNK_BLOCKS, Math.floor(size * 2));
    } catch {
      calls++;
      end = start - 1;
      if (size > 256) size = Math.max(256, Math.floor(size / 2));
    }
    if (calls % 5 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

/*────────────────────────────────────────────────────────
  Snapshot & pricing (DECIMALS-AWARE)
────────────────────────────────────────────────────────*/
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

function priceWeiPerToken(
  rN: bigint,
  rT: bigint,
  x0: bigint,
  y0: bigint,
  decimals: number
) {
  const den = rT + y0;
  if (den === 0n) return 0n;
  const num = (rN + x0) * (10n ** BigInt(decimals));
  return num / den;
}

async function optCall<T>(c: any, fn: string, fallback: T): Promise<T> {
  try {
    if (!c?.[fn]) return fallback;
    const v = await c[fn]();
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "bigint"
    )
      return v as T;
    return (v?.toString?.() ?? v) as T;
  } catch {
    return fallback;
  }
}

export async function readSnapshot(
  poolAddr: string,
  chainId = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID || 97)
): Promise<Snapshot> {
  const provider = await getProvider(chainId);
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
  let symbol = "TKN",
    totalSupply = 0n,
    tokenDecimals = 18;
  try {
    symbol = await erc.symbol();
  } catch {}
  try {
    totalSupply = await erc.totalSupply();
  } catch {}
  try {
    tokenDecimals = Number(await erc.decimals());
  } catch {}

  const pWei = priceWeiPerToken(rN, rT, x0, y0, tokenDecimals);
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

/*────────────────────────────────────────────────────────
  Trades & Holders
────────────────────────────────────────────────────────*/
export type Trade = {
  type: "BUY" | "SELL";
  addr?: string;
  bnbIn?: string;
  tokensOut?: string;
  tokenIn?: string;
  bnbOut?: string;
  tx: string;
  block: number;
  ts: number;
};

// Small helper to satisfy TS and avoid exceptions from parseLog
function safeParseLog(iface: Interface, l: any): any | null {
  try {
    return iface.parseLog({ topics: l.topics, data: l.data });
  } catch {
    return null;
  }
}

export async function loadTrades(
  poolAddr: string,
  chainId = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID || 97),
  tokenDecimals = 18
): Promise<Trade[]> {
  const provider = await getProvider(chainId);
  const iface = new Interface(POOL_ABI_FOR_IFACE);

  const topicBuy = keccakId("Buy(address,uint256,uint256,uint256)");
  const topicSell = keccakId("Sell(address,uint256,uint256,uint256)");
  const latest = await provider.getBlockNumber();
  const fromBlock = await getCreationBlock(provider, poolAddr);

  const buys = await getLogsBackfill(
    provider,
    { address: poolAddr, topics: [topicBuy] },
    fromBlock,
    latest,
    TRADES_WANT
  );
  const sells = await getLogsBackfill(
    provider,
    { address: poolAddr, topics: [topicSell] },
    fromBlock,
    latest,
    TRADES_WANT
  );

  const both = [...buys, ...sells].sort((a: any, b: any) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber - b.blockNumber
  );

  const tsCache = new Map<number, number>();
  async function tsFor(blockNumber: number) {
    if (tsCache.has(blockNumber)) return tsCache.get(blockNumber)!;
    const b = await provider.getBlock(blockNumber);
    const t = Number(b?.timestamp ?? 0);
    tsCache.set(blockNumber, t);
    return t;
  }

  const rows = await Promise.all(
    both.slice(-Math.min(2 * TRADES_WANT, 400)).map(async (l: any) => {
      try {
        const p = safeParseLog(iface, l);
        if (!p) return null;

        const ts = await tsFor(l.blockNumber);

        if (p.name === "Buy") {
          return {
            type: "BUY",
            addr: String(p.args?.[0]).toLowerCase(),
            bnbIn: formatEther(p.args?.[1] ?? 0n),
            tokensOut: formatUnits(p.args?.[2] ?? 0n, tokenDecimals),
            tx: l.transactionHash,
            block: l.blockNumber,
            ts,
          } as Trade;
        }
        if (p.name === "Sell") {
          return {
            type: "SELL",
            addr: String(p.args?.[0]).toLowerCase(),
            tokenIn: formatUnits(p.args?.[1] ?? 0n, tokenDecimals),
            bnbOut: formatEther(p.args?.[2] ?? 0n),
            tx: l.transactionHash,
            block: l.blockNumber,
            ts,
          } as Trade;
        }
      } catch {
        // swallow and skip this log if anything unexpected happens
      }
      return null;
    })
  );

  return rows.filter(Boolean).reverse() as Trade[];
}

export async function loadTopHoldersSafe(
  poolAddr: string,
  chainId = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID || 97),
  tokenAddr?: string,
  totalSupplyHint?: bigint,
  recentAddrs?: string[],
  tokenDecimals = 18
): Promise<{
  token: string;
  holders: Array<{ address: string; balance: string; pct: number }>;
  totalSupply: bigint;
  approx: boolean;
}> {
  const provider = await getProvider(chainId);

  let token = tokenAddr || "";
  try {
    const pool = new Contract(poolAddr, POOL_ABI_RO, provider) as any;
    token = token || (await pool.token());
  } catch {}
  if (!token)
    return { token: "0x", holders: [], totalSupply: 0n, approx: true };

  const erc = new Contract(token, ERC20_MIN_ABI, provider) as any;

  let totalSupply: bigint = 0n;
  try {
    totalSupply = totalSupplyHint ?? (await erc.totalSupply());
  } catch {}

  const latest = await provider.getBlockNumber();
  let created = 0;
  try {
    created = await getCreationBlock(provider, poolAddr);
  } catch {}
  const from = Math.max(
    created || 0,
    latest - Number(process.env.NEXT_PUBLIC_HOLDERS_LOOKBACK_BLOCKS || "30000")
  );

  let logs: any[] = [];
  try {
    logs = await getLogsBackfill(
      provider,
      { address: token, topics: [keccakId("Transfer(address,address,uint256)")] },
      from,
      latest,
      Number(process.env.NEXT_PUBLIC_HOLDERS_MAX_LOGS || "1200"),
      4000
    );
  } catch {
    logs = [];
  }

  const ZERO = "0x0000000000000000000000000000000000000000";
  const DEAD = "0x000000000000000000000000000000000000dEaD";

  if (logs.length >= 5) {
    const bal = new Map<string, bigint>();
    for (const l of logs) {
      const fromA = ("0x" + l.topics[1].slice(26)).toLowerCase();
      const toA = ("0x" + l.topics[2].slice(26)).toLowerCase();
      let amt: bigint = 0n;
      try {
        amt = BigInt(l.data);
      } catch {}
      if (fromA !== ZERO) bal.set(fromA, (bal.get(fromA) ?? 0n) - amt);
      if (toA !== ZERO) bal.set(toA, (bal.get(toA) ?? 0n) + amt);
    }
    [poolAddr, token, DEAD]
      .map((a) => a.toLowerCase())
      .forEach((a) => bal.delete(a));

    const arr = Array.from(bal.entries())
      .filter(([, v]) => v > 0n)
      .sort((a, b) => (a[1] > b[1] ? -1 : 1))
      .slice(0, 10)
      .map(([address, v]) => ({
        address,
        balance: formatUnits(v, tokenDecimals),
        pct: totalSupply > 0n ? (Number(v) / Number(totalSupply)) * 100 : 0,
      }));

    return { token, holders: arr, totalSupply, approx: false as const };
  }

  const uniq = Array.from(
    new Set((recentAddrs || []).map((a) => a.toLowerCase()).filter(Boolean))
  ).slice(0, 50);
  const balances = await Promise.all(
    uniq.map(async (a) => {
      try {
        return [a, (await erc.balanceOf(a)) as bigint] as const;
      } catch {
        return [a, 0n] as const;
      }
    })
  );

  const arr = balances
    .filter(([_, v]) => v > 0n)
    .sort((a, b) => (a[1] > b[1] ? -1 : 1))
    .slice(0, 10)
    .map(([address, v]) => ({
      address,
      balance: formatUnits(v, tokenDecimals),
      pct: totalSupply > 0n ? (Number(v) / Number(totalSupply)) * 100 : 0,
    }));

  return { token, holders: arr, totalSupply, approx: true as const };
}

