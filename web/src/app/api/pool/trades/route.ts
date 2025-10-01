// src/app/api/pool/trades/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Contract, Interface, JsonRpcProvider, id as keccakId } from "ethers";
import type { LogDescription } from "ethers";
import { CHAINS, CHAIN_RPC } from "@/lib/chains";

export const dynamic = "force-dynamic";

function isAddr(a: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(a);
}

async function getProvider(chainId = 97): Promise<JsonRpcProvider> {
  const urls = (CHAIN_RPC as any)[chainId] || [CHAINS[chainId as 56 | 97].rpc];
  let lastErr: any;
  for (const u of urls) {
    try {
      const p = new JsonRpcProvider(u, chainId);
      await p.getBlockNumber();
      return p;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`All RPCs failed: ${lastErr?.message || lastErr}`);
}

// ────────────────────────────────────────────────────────────
// Minimal ethers-compatible ABIs (strings) to avoid type issues
// ────────────────────────────────────────────────────────────
const POOL_META_ABI = [
  "function creationBlock() view returns (uint256)"
] as const;

const TRADE_EVENTS_ABI = [
  "event Buy(address indexed buyer,uint256 bnbIn,uint256 tokensOut,uint256 feeBps)",
  "event Sell(address indexed seller,uint256 tokenIn,uint256 bnbOut,uint256 feeBps)"
] as const;

async function getCreationBlock(p: Contract): Promise<number> {
  try {
    return Number(await (p as any).creationBlock());
  } catch {
    const prov = p.runner as JsonRpcProvider;
    const latest = await prov.getBlockNumber();
    // Fallback: scan last ~400k blocks (tunable); avoids throwing
    return Math.max(0, latest - 400_000);
  }
}

async function getLogsBackfill(
  provider: JsonRpcProvider,
  address: string,
  topics: string[],
  fromBlock: number,
  toBlock: number,
  wantCount = 256, // how many logs we try to collect
  step = 4000
) {
  const out: any[] = [];
  let end = toBlock, size = Math.min(step, 5000);
  while (end >= fromBlock && out.length < wantCount) {
    const start = Math.max(fromBlock, end - size + 1);
    try {
      const part = await provider.getLogs({ address, topics, fromBlock: start, toBlock: end });
      out.push(...part);
      end = start - 1;
      if (size < 5000) size = Math.min(5000, Math.floor(size * 2));
    } catch (e: any) {
      const s = (e?.message || "").toLowerCase();
      const tooLarge = e?.code === -32701 || e?.code === -32062 || s.includes("block range");
      if (tooLarge && size > 64) {
        size = Math.max(64, Math.floor(size / 2));
        continue;
      }
      throw e;
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const pool = (url.searchParams.get("pool") || "").toLowerCase();
    const chain = Number(url.searchParams.get("chain") || "97") || 97;

    if (!isAddr(pool)) {
      return NextResponse.json([], { headers: { "cache-control": "no-store" } });
    }

    const provider = await getProvider(chain);

    // Use minimal ABI just for optional creationBlock()
    const p = new Contract(pool, POOL_META_ABI, provider);

    // Use event-only ABI to parse logs (ethers.Interface-compatible)
    const iface = new Interface(TRADE_EVENTS_ABI);

    const buyTopic = keccakId("Buy(address,uint256,uint256,uint256)");
    const sellTopic = keccakId("Sell(address,uint256,uint256,uint256)");

    const latest = await provider.getBlockNumber();
    const fromBlock = await getCreationBlock(p);

    const buys = await getLogsBackfill(provider, pool, [buyTopic], fromBlock, latest, 256, 4000);
    const sells = await getLogsBackfill(provider, pool, [sellTopic], fromBlock, latest, 256, 4000);

    const logs = [...buys, ...sells].sort((a: any, b: any) => {
      if (a.blockNumber === b.blockNumber) return a.logIndex - b.logIndex;
      return a.blockNumber - b.blockNumber; // ASC
    });

    const tsCache = new Map<number, number>();
    const out: Array<{ time: number; price: number }> = [];

    for (const log of logs) {
      try {
        // Guarded parse: skip unknown/legacy events gracefully
        let parsed: LogDescription | null = null;
        try {
          parsed = iface.parseLog({ topics: log.topics, data: log.data });
        } catch {
          parsed = null;
        }
        if (!parsed) continue;

        // Prefer named args; fallback to positional index
        const a: any = parsed.args ?? [];
        // Many pool versions emit raw price; others require computing from amounts.
        // Here we tolerate both: priceWad/priceWei or fallback to amounts ratio.
        let priceBNB: number | null = null;

        const priceWeiRaw = a.priceWad ?? a.priceWei ?? null;
        if (priceWeiRaw != null) {
          const priceWei = typeof priceWeiRaw === "bigint" ? priceWeiRaw : BigInt(String(priceWeiRaw));
          if (priceWei > 0n) priceBNB = Number(priceWei) / 1e18;
        } else {
          // Derive from amounts if present:
          if (parsed.name === "Buy") {
            const bnbIn = a.bnbIn ?? a[1];
            const tokensOut = a.tokensOut ?? a[2];
            if (bnbIn && tokensOut) {
              const bnb = Number(typeof bnbIn === "bigint" ? bnbIn : BigInt(String(bnbIn))) / 1e18;
              const tok = Number(typeof tokensOut === "bigint" ? tokensOut : BigInt(String(tokensOut))) / 1e18;
              if (bnb > 0 && tok > 0) priceBNB = bnb / tok;
            }
          } else if (parsed.name === "Sell") {
            const tokenIn = a.tokenIn ?? a[1];
            const bnbOut = a.bnbOut ?? a[2];
            if (bnbOut && tokenIn) {
              const bnb = Number(typeof bnbOut === "bigint" ? bnbOut : BigInt(String(bnbOut))) / 1e18;
              const tok = Number(typeof tokenIn === "bigint" ? tokenIn : BigInt(String(tokenIn))) / 1e18;
              if (bnb > 0 && tok > 0) priceBNB = bnb / tok;
            }
          }
        }

        if (priceBNB == null || !(priceBNB > 0)) continue;

        let ts = tsCache.get(log.blockNumber);
        if (ts == null) {
          const blk = await provider.getBlock(log.blockNumber);
          ts = Number(blk?.timestamp || 0);
          tsCache.set(log.blockNumber, ts);
        }

        out.push({ time: ts, price: priceBNB });
      } catch {
        // ignore malformed logs
      }
    }

    // Return most recent 512 points
    return NextResponse.json(out.slice(-512), { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json([], { status: 200, headers: { "cache-control": "no-store" } });
  }
}
