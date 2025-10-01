import { NextRequest, NextResponse } from "next/server";
import { Contract, JsonRpcProvider } from "ethers";
import { CHAINS, CHAIN_RPC } from "@/lib/chains";

// Force this route to run on the server each time
export const dynamic = "force-dynamic";

// Minimal ABI so we don't depend on your global POOL_ABI
const FEE_ABI = [
  "function creatorFeeBps() view returns (uint16)",
  "function platformFeeBps() view returns (uint16)" // we won't show it, but keep as fallback/debug
];

export async function GET(req: NextRequest) {
  const pool = (req.nextUrl.searchParams.get("pool") || "").toLowerCase();
  const chain = Number(req.nextUrl.searchParams.get("chain") || "97");

  if (!/^0x[a-f0-9]{40}$/.test(pool)) {
    return NextResponse.json({ error: "bad pool" }, { status: 400 });
  }

  // Try your env RPCs first, then the fallback in CHAINS
  const urls = [...(CHAIN_RPC[chain] || []), CHAINS[chain as 56 | 97].rpc];

  let lastErr: any;
  for (const url of urls) {
    try {
      const prov = new JsonRpcProvider(url, chain);
      await prov.getBlockNumber(); // sanity
      const c = new Contract(pool, FEE_ABI, prov as any);

      // Some old pools might revert on these; handle gracefully
      const creator = await c.creatorFeeBps().catch(() => null);
      const platform = await c.platformFeeBps?.().catch?.(() => null);

      if (creator != null) {
        return NextResponse.json({
          creatorBps: Number(creator),         // ← this is what UI uses
          platformBps: Number(platform ?? 0),  // kept for debugging (not shown)
        });
      }
    } catch (e) {
      lastErr = e;
    }
  }

  // If every RPC failed or pool is legacy, return zeros (UI will show 0.00%)
  return NextResponse.json({ creatorBps: 0, platformBps: 0, err: String(lastErr?.message || "") });
}
