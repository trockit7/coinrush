// src/lib/installLogsPatch.ts
"use client";
import { JsonRpcProvider } from "ethers";
import { getLogsSmart } from "./getLogsSmart";

const DEPLOY_FLOOR =
  Number(process.env.NEXT_PUBLIC_FACTORY_DEPLOY_BLOCK_BSCTEST || "") ||
  Number(process.env.NEXT_PUBLIC_FACTORY_DEPLOY_BLOCK || "") ||
  undefined;

const LOOKBACK = Number(process.env.NEXT_PUBLIC_LOGS_LOOKBACK_BLOCKS || "") || 1_200_000;
const CHUNK    = Number(process.env.NEXT_PUBLIC_LOGS_CHUNK_BLOCKS || "")   || 50_000;

(() => {
  const P: any = JsonRpcProvider as any;
  if (P.__CR_LOGS_PATCH__) return; // install once
  P.__CR_LOGS_PATCH__ = true;

  const orig = JsonRpcProvider.prototype.getLogs;

  JsonRpcProvider.prototype.getLogs = async function (filter: any) {
    // Clone and enforce a sane fromBlock floor using DEPLOY_FLOOR (if provided)
    const f2: any = { ...(filter || {}) };
    if (DEPLOY_FLOOR != null) {
      const curFrom =
        typeof f2.fromBlock === "number"
          ? f2.fromBlock
          : typeof f2.fromBlock === "bigint"
          ? Number(f2.fromBlock)
          : undefined;
      // If caller didn't set fromBlock, or set one earlier than deploy floor, clamp it
      f2.fromBlock =
        curFrom != null ? Math.max(curFrom, DEPLOY_FLOOR) : DEPLOY_FLOOR;
    }

    try {
      // Only pass options that Opts accepts (no deployFloor)
      return await getLogsSmart(this as any, f2, {
        maxLookback: LOOKBACK,
        chunkSize: CHUNK,
      });
    } catch {
      // Fallback to original behavior if smart path fails
      return await orig.call(this, filter);
    }
  };
})();
