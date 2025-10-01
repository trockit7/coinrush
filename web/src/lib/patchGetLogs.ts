"use client";
import type { JsonRpcProvider } from "ethers";

type PatchOpts = {
  deployBlockEnv?: number;   // earliest block to ever scan
  maxLookback?: number;      // how far back if env isn’t set
  chunkSize?: number;        // per-call block span
  minChunk?: number;         // smallest block span when shrinking
};

export function patchProviderGetLogs(opts: PatchOpts = {}) {
  // Guard: don’t double-patch
  const anyProv = (globalThis as any).__CR_PATCHED_GETLOGS__;
  if (anyProv) return;
  (globalThis as any).__CR_PATCHED_GETLOGS__ = true;

  // Lazy import to avoid SSR issues
  import("ethers").then(({ JsonRpcProvider }) => {
    const proto = (JsonRpcProvider as any).prototype;
    const orig = proto.getLogs;

    proto.getLogs = async function (filter: any) {
      const provider: JsonRpcProvider = this;
      const latest = await provider.getBlockNumber();

      const maxLookback = opts.maxLookback ?? 30_000;
      const floorEnv    = opts.deployBlockEnv;
      const floorDefault= Math.max(0, latest - maxLookback);
      const floor       = floorEnv != null ? Math.max(0, Math.min(floorEnv, latest)) : floorDefault;

      const toNum   = filter?.toBlock == null || filter.toBlock === "latest" ? latest : Number(filter.toBlock);
      let from      = filter?.fromBlock != null ? Number(filter.fromBlock) : floor;
      from          = Math.max(from, floor);

      const out: any[] = [];
      let end    = toNum;
      let chunk  = Math.max(256, Math.min(opts.chunkSize ?? 4_000, toNum - from + 1));
      const minC = Math.max(256, opts.minChunk ?? 512);

      while (end >= from) {
        const start = Math.max(from, end - chunk + 1);
        try {
          const part = await orig.call(provider, { ...filter, fromBlock: start, toBlock: end });
          if (Array.isArray(part) && part.length) out.push(...part);
          end = start - 1;
          if (chunk < (opts.chunkSize ?? 4_000)) chunk = Math.min(opts.chunkSize ?? 4_000, chunk * 2);
        } catch (e: any) {
          const code = (e?.code ?? "").toString();
          const msg  = String(e?.message || "").toLowerCase();
          if ((code === "-32701" || code === "-32062" || msg.includes("pruned") || msg.includes("block range")) && chunk > minC) {
            chunk = Math.max(minC, Math.floor(chunk / 2)); // shrink and try next window
          } else {
            // skip this window
            end = start - 1;
          }
        }
      }
      return out;
    };
  });
}
