// src/app/api/candles/route.ts
import { NextResponse } from "next/server";
import { Contract, Interface, JsonRpcProvider, formatEther, id as keccakId } from "ethers";
import { CHAINS, CHAIN_RPC } from "@/lib/chains";

export const dynamic = "force-dynamic"; // avoid caching in dev

const DEFAULT_CHAIN = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID || 97);

/** Parse BigNumber-ish to number in 18-decimals with fallback */
function bnToNum18(x: any) {
  try {
    return Number(formatEther(x));
  } catch {
    const n = typeof x === "bigint" ? Number(x) : Number(x);
    return n / 1e18;
  }
}

async function getProvider(chainId = DEFAULT_CHAIN): Promise<JsonRpcProvider> {
  const urls = (CHAIN_RPC as any)[chainId] || [CHAINS[chainId as 56 | 97].rpc];
  for (const u of urls) {
    try {
      const p = new JsonRpcProvider(u, chainId);
      await p.getBlockNumber();
      return p;
    } catch {}
  }
  return new JsonRpcProvider(urls?.[0] || CHAINS[chainId as 56 | 97].rpc, chainId);
}

async function estimateBlockTime(provider: JsonRpcProvider) {
  try {
    const latest = await provider.getBlockNumber();
    const a = await provider.getBlock(latest);
    const b = await provider.getBlock(Math.max(0, latest - 100));
    const dt = Number((a?.timestamp ?? 0) - (b?.timestamp ?? 0));
    const dn = Math.max(1, latest - Math.max(0, latest - 100));
    // Clamp to a realistic range (BSC testnet is ~3s)
    return Math.min(10, Math.max(1, Math.round(dt / dn)));
  } catch {
    return 3;
  }
}

async function getLogsBackfill(
  provider: JsonRpcProvider,
  filter: { address: string; topics: any[] },
  fromBlock: number,
  toBlock: number,
  step = 6000,
  maxCalls = 120
) {
  const out: any[] = [];
  let end = toBlock;
  let size = step;
  let calls = 0;
  while (end >= fromBlock && calls < maxCalls) {
    const start = Math.max(fromBlock, end - size + 1);
    try {
      const part = await provider.getLogs({ ...filter, fromBlock: start, toBlock: end });
      calls++;
      if (Array.isArray(part) && part.length) out.push(...part);
      end = start - 1;
      if (size < step) size = Math.min(step, Math.floor(size * 2));
    } catch {
      calls++;
      end = start - 1;
      if (size > 256) size = Math.max(256, Math.floor(size / 2));
    }
  }
  return out;
}

/** Build continuous candles across the full window.
 *  - Uses last trade before the window as seed (or spot price).
 *  - Fills every bucket so charts don’t show a single lonely bar.
 */
function toCandles(
  pointsAll: Array<{ ts: number; price: number }>, // can include items before/after the window
  startTs: number,
  endTs: number,
  stepSec: number,
  lastSpot?: number | null
) {
  // Sort once
  const points = [...pointsAll].sort((a, b) => a.ts - b.ts);

  // 1) Find seed: last trade at/before startTs, else lastSpot
  let seed: number | null = null;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].ts <= startTs) {
      seed = points[i].price;
      break;
    }
  }
  if (seed == null && lastSpot && isFinite(lastSpot) && lastSpot > 0) seed = lastSpot;

  // 2) Collect prices by bucket for trades within the window
  const byBucket = new Map<number, number[]>();
  for (const p of points) {
    if (p.ts < startTs || p.ts > endTs) continue;
    const t = Math.floor(p.ts / stepSec) * stepSec;
    const arr = byBucket.get(t);
    arr ? arr.push(p.price) : byBucket.set(t, [p.price]);
  }

  // 3) Walk buckets across window, always emitting a candle
  const candles: { time: number; open: number; high: number; low: number; close: number }[] = [];
  let prevClose: number | null = seed;

  // If we still have no seed and truly no info, use 0 to avoid NaN
  if (prevClose == null) prevClose = 0;

  const firstBucket = Math.floor(startTs / stepSec) * stepSec;
  const lastBucket = Math.floor(endTs / stepSec) * stepSec;

  for (let t = firstBucket; t <= lastBucket; t += stepSec) {
    const arr = byBucket.get(t);
    if (arr && arr.length) {
      const open = prevClose ?? arr[0];
      const close = arr[arr.length - 1];
      const high = Math.max(...arr, open, close);
      const low = Math.min(...arr, open, close);
      candles.push({ time: t, open, high, low, close });
      prevClose = close;
    } else {
      // flat candle using previous close (or seed)
      const v = prevClose ?? seed ?? 0;
      candles.push({ time: t, open: v, high: v, low: v, close: v });
    }
  }

  // 4) If everything was 0 (no data at all), return empty array to avoid a flat line at 0
  const hasNonZero = candles.some((c) => c.open > 0 || c.close > 0);
  return hasNonZero ? candles : [];
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const pool = (url.searchParams.get("pool") || "").trim();
    const chain = Number(url.searchParams.get("chain") || DEFAULT_CHAIN);
    const windowParam = (url.searchParams.get("window") || "3600").trim();
    const stepParam = (url.searchParams.get("interval") || "60").trim();

    if (!pool || !/^0x[0-9a-fA-F]{40}$/.test(pool)) {
      return NextResponse.json(
        { error: "Missing or invalid ?pool=0x…" },
        { status: 400, headers: { "cache-control": "no-store" } }
      );
    }

    const parseWindow = (s: string) => {
      if (/^\d+$/.test(s)) return Number(s);
      const m = s.match(/^(\d+)(s|m|h|d)$/i);
      if (!m) return 3600;
      const n = Number(m[1]);
      const u = m[2].toLowerCase();
      return u === "s" ? n : u === "m" ? n * 60 : u === "h" ? n * 3600 : n * 86400;
    };

    const windowSec = Math.max(60, parseWindow(windowParam));
    const stepSec = Math.max(15, Number(stepParam) || 60);

    const provider = await getProvider(chain);
    const latestNum = await provider.getBlockNumber();
    const latestBlock = await provider.getBlock(latestNum);
    const nowTs = Number(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000));
    const secPerBlock = await estimateBlockTime(provider);

    // Pull more than the visible window so we can seed with a trade before the window
    const approxBlocks = Math.ceil((windowSec + 3600 /* +1h buffer */) / secPerBlock);
    const fromBlock = Math.max(0, latestNum - approxBlocks - 5000);
    const toBlock = latestNum;

    // Topics for Buy/Sell
    const topicBuy = keccakId("Buy(address,uint256,uint256,uint256)");
    const topicSell = keccakId("Sell(address,uint256,uint256,uint256)");

    const [buyLogs, sellLogs] = await Promise.all([
      getLogsBackfill(provider, { address: pool, topics: [topicBuy] }, fromBlock, toBlock, 6000, 120),
      getLogsBackfill(provider, { address: pool, topics: [topicSell] }, fromBlock, toBlock, 6000, 120),
    ]);

    // Pre-fetch block timestamps for all relevant blocks (reduces RPC round trips)
    const needBlocks = new Set<number>();
    buyLogs.forEach((l) => needBlocks.add(l.blockNumber));
    sellLogs.forEach((l) => needBlocks.add(l.blockNumber));

    const blockCache = new Map<number, number>();
    await Promise.all(
      Array.from(needBlocks).map(async (bn) => {
        try {
          const b = await provider.getBlock(bn);
          blockCache.set(bn, Number(b?.timestamp ?? 0));
        } catch {
          blockCache.set(bn, 0);
        }
      })
    );

    // ✅ Use a minimal event-only ABI compatible with ethers.Interface
    // (avoids type mismatch when your POOL_ABI is viem/abitype-style)
    const TRADE_EVENTS_ABI = [
      "event Buy(address indexed buyer,uint256 bnbIn,uint256 tokensOut,uint256 feeBps)",
      "event Sell(address indexed seller,uint256 tokenIn,uint256 bnbOut,uint256 feeBps)"
    ] as const;

    const iface = new Interface(TRADE_EVENTS_ABI);
    const points: Array<{ ts: number; price: number }> = [];

    // ✅ tolerant Buy parse (guarded parseLog + named/indexed)
    for (const l of buyLogs) {
      try {
        let p: any | null = null;
        try {
          p = iface.parseLog({ topics: l.topics, data: l.data });
        } catch {
          p = null;
        }
        if (!p || p.name !== "Buy") continue;

        const ts = blockCache.get(l.blockNumber) || 0;

        const a: any = p.args ?? [];
        const bnbIn = bnToNum18(a.bnbIn ?? a[1]);
        const tokensOut = bnToNum18(a.tokensOut ?? a[2]);

        if (!(bnbIn > 0 && tokensOut > 0 && ts)) continue;
        const price = bnbIn / Math.max(tokensOut, 1e-18);
        if (price > 0) points.push({ ts, price });
      } catch {
        // ignore bad/unknown logs
      }
    }

    // ✅ tolerant Sell parse (guarded parseLog + named/indexed)
    for (const l of sellLogs) {
      try {
        let p: any | null = null;
        try {
          p = iface.parseLog({ topics: l.topics, data: l.data });
        } catch {
          p = null;
        }
        if (!p || p.name !== "Sell") continue;

        const ts = blockCache.get(l.blockNumber) || 0;

        const a: any = p.args ?? [];
        const tokenIn = bnToNum18(a.tokenIn ?? a[1]);
        const bnbOut = bnToNum18(a.bnbOut ?? a[2]);

        if (!(bnbOut > 0 && tokenIn > 0 && ts)) continue;
        const price = bnbOut / Math.max(tokenIn, 1e-18);
        if (price > 0) points.push({ ts, price });
      } catch {
        // ignore bad/unknown logs
      }
    }

    // Spot price from reserves to keep the right edge alive
    let lastSpot: number | null = null;
    try {
      const poolC = new Contract(
        pool,
        [
          "function reserveNative() view returns (uint256)",
          "function reserveToken() view returns (uint256)",
          "function x0() view returns (uint256)",
          "function y0() view returns (uint256)",
        ],
        provider
      ) as any;
      const [rN, rT, x0, y0] = await Promise.all([
        poolC.reserveNative(),
        poolC.reserveToken(),
        poolC.x0(),
        poolC.y0()
      ]);
      const numBNB = bnToNum18(rN) + bnToNum18(x0);
      const denTok = bnToNum18(rT) + bnToNum18(y0);
      if (denTok > 0) lastSpot = numBNB / denTok; // BNB per token
    } catch {
      // ignore
    }

    const startTs = nowTs - windowSec;
    const candles = toCandles(points, startTs, nowTs, stepSec, lastSpot);

    return NextResponse.json(
      {
        candles,
        meta: {
          candles: candles.length,
          events: { buy: buyLogs.length, sell: sellLogs.length },
          windowSec,
          stepSec,
          chain,
          pool,
          fromBlock,
          toBlock,
          secPerBlock,
          lastSpot,
          nowTs,
        },
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || String(e) },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }
}
