"use client";
import { JsonRpcProvider } from "ethers";

export type SmartFilter = {
  address?: string | string[];
  topics?: (string | string[] | null)[];
  fromBlock?: number;
  toBlock?: number | "latest";
};

type Opts = {
  deployBlockEnv?: number;  // earliest block to ever scan (factory deploy)
  maxLookback?: number;     // how far back if env is missing
  chunkSize?: number;       // per-request block span
  maxCalls?: number;        // safety cap
};

export async function getLogsSmart(
  provider: JsonRpcProvider,
  base: SmartFilter,
  opts: Opts = {}
) {
  try {
    const latest      = await provider.getBlockNumber();
    const maxLookback = opts.maxLookback ?? 30_000; // keep small on client
    const chunk       = opts.chunkSize   ?? 4_000;
    const maxCalls    = opts.maxCalls    ?? 40;

    const floorEnv    = opts.deployBlockEnv;
    const floorDefault= Math.max(0, latest - maxLookback);
    const floor       = floorEnv != null ? Math.max(0, Math.min(floorEnv, latest)) : floorDefault;

    const toNum = (base.toBlock == null || base.toBlock === "latest") ? latest : Number(base.toBlock);
    let from    = base.fromBlock != null ? Number(base.fromBlock) : floor;
    from        = Math.max(from, floor);

    const out: any[] = [];
    let end   = toNum;
    let size  = Math.max(256, Math.min(chunk, toNum - from + 1));
    let calls = 0;

    while (end >= from && calls < maxCalls) {
      const start = Math.max(from, end - size + 1);
      try {
        const part = await provider.getLogs({ ...base, fromBlock: start, toBlock: end } as any);
        if (Array.isArray(part) && part.length) out.push(...part);
        end = start - 1;
        if (size < chunk) size = Math.min(chunk, size * 2);
      } catch (e: any) {
        const code = (e?.code ?? "").toString();
        const msg  = String(e?.message || "").toLowerCase();
        if ((code === "-32701" || code === "-32062" || msg.includes("pruned") || msg.includes("block range")) && size > 256) {
          size = Math.max(256, Math.floor(size / 2)); // shrink and keep going
        } else {
          end = start - 1; // skip this window
        }
      }
      calls++;
      if (calls % 5 === 0) await new Promise(r => setTimeout(r, 0)); // yield to UI
    }
    return out;
  } catch {
    return []; // never crash the UI
  }
}
