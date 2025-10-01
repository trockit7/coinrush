// src/app/api/token/[pool]/route.ts
import { NextResponse, NextRequest } from "next/server";
import { Contract, JsonRpcProvider, formatEther } from "ethers";
// ⛔️ remove POOL_ABI / ERC20_ABI import (viem-style types cause TS errors)
// import { POOL_ABI, ERC20_ABI } from "@/lib/abi";
import { CHAINS, CHAIN_RPC } from "@/lib/chains";
import { getDB } from "@/lib/db";

// ✅ Minimal ethers-compatible ABIs (string fragments)
const POOL_READ_ABI = [
  "function token() view returns (address)",
  "function owner() view returns (address)",
  "function migrated() view returns (bool)",
  "function x0() view returns (uint256)",
  "function y0() view returns (uint256)",
  "function reserveNative() view returns (uint256)",
  "function reserveToken() view returns (uint256)",
  "function targetMarketCapWei() view returns (uint256)",
  "function priceWeiPerToken() view returns (uint256)",
  "function creatorFeeBps() view returns (uint256)"
] as const;

const ERC20_MIN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)"
] as const;

// Small RPC helper with fallbacks
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

function isAddr(a: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(a);
}

export async function GET(
  req: NextRequest,
  { params }: { params: { pool: string } }
) {
  try {
    const url = new URL(req.url);

    // ── Strict pool guard: query param (if present) must be valid
    const poolQuery = (url.searchParams.get("pool") || "").toLowerCase().trim();
    if (poolQuery && !/^0x[a-f0-9]{40}$/.test(poolQuery)) {
      return NextResponse.json({ error: "invalid pool" }, { status: 400 });
    }

    // Prefer the path param, but if a (valid) query param is provided, require it to match
    const poolFromPath = (params.pool || "").toLowerCase().trim();
    if (!/^0x[a-f0-9]{40}$/.test(poolFromPath)) {
      return NextResponse.json({ error: "invalid pool" }, { status: 400 });
    }
    if (poolQuery && poolQuery !== poolFromPath) {
      return NextResponse.json({ error: "pool mismatch" }, { status: 400 });
    }

    const poolAddr = poolFromPath;
    const chain = Number(url.searchParams.get("chain") || "97") || 97;

    const provider = await getProvider(chain);
    const pool = new Contract(poolAddr, POOL_READ_ABI, provider);

    // Read pool state (tolerate partial failures)
    let tokenAddr = "";
    let owner = "";
    let migrated = false;
    let x0 = 0n,
      y0 = 0n,
      reserveNative = 0n,
      reserveToken = 0n,
      priceWei = 0n,
      targetCapWei = 0n,
      creatorFeeBps: number | null = null;

    try {
      tokenAddr = (await pool.token()) as string;
    } catch {}
    try {
      owner = (await pool.owner()) as string;
    } catch {}
    try {
      migrated = Boolean(await (pool as any).migrated?.());
    } catch {}
    try {
      x0 = BigInt(await pool.x0());
    } catch {}
    try {
      y0 = BigInt(await pool.y0());
    } catch {}
    try {
      reserveNative = BigInt(await pool.reserveNative());
    } catch {}
    try {
      reserveToken = BigInt(await pool.reserveToken());
    } catch {}
    try {
      targetCapWei = BigInt(await (pool as any).targetMarketCapWei?.());
    } catch {}
    try {
      const bps: bigint = await (pool as any).creatorFeeBps?.();
      creatorFeeBps = Number(bps);
    } catch {
      creatorFeeBps = null;
    }

    // Price: prefer view function, else compute ( (rN+x0)*1e18 / (rT+y0) )
    try {
      const p: bigint = await (pool as any).priceWeiPerToken?.();
      priceWei = BigInt(p);
    } catch {
      try {
        const rN = reserveNative + x0;
        const rT = reserveToken + y0;
        priceWei = rT > 0n ? (rN * 10n ** 18n) / rT : 0n;
      } catch {
        priceWei = 0n;
      }
    }

    // Token metadata + total supply
    let name = "Token",
      symbol = "TKN",
      totalSupply = 0n;
    if (isAddr(tokenAddr)) {
      const t = new Contract(tokenAddr, ERC20_MIN_ABI, provider);
      try {
        name = await t.name();
      } catch {}
      try {
        symbol = await t.symbol();
      } catch {}
      try {
        totalSupply = BigInt(await t.totalSupply());
      } catch {}
    }

    // Market cap in BNB
    const mcapWei = priceWei > 0n && totalSupply > 0n ? (priceWei * totalSupply) / 10n ** 18n : 0n;

    // Optional image/name overrides from local DB (tokens table)
    let imageUrl: string | null = null;
    try {
      const db = getDB();
      const row = db
        .prepare(
          `SELECT image_url, name as db_name, symbol as db_symbol
           FROM tokens WHERE pool_addr = ? LIMIT 1`
        )
        .get(poolAddr) as any;
      if (row) {
        if (row.image_url) imageUrl = row.image_url;
        if (row.db_name) name = row.db_name;
        if (row.db_symbol) symbol = row.db_symbol;
      }
    } catch {
      // ignore DB errors (keep on-chain values)
    }

    // Shape the response
    const json = {
      pool: poolAddr,
      token: tokenAddr || null,
      name,
      symbol,
      imageUrl,
      creator: owner || null,
      migrated,
      // BNB values as decimal strings
      price: formatEther(priceWei), // BNB per token
      marketCapBNB: formatEther(mcapWei),
      targetCapBNB: formatEther(targetCapWei),
      // Raw reserves (BNB, tokens) as decimals
      reserveNative: formatEther(reserveNative),
      reserveToken: formatEther(reserveToken),
      // creator tax (bps & %)
      creatorFeeBps,
      creatorFeePct: creatorFeeBps != null ? (creatorFeeBps / 100).toFixed(2) : null,
    };

    return NextResponse.json(json, {
      headers: { "cache-control": "no-store" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || String(e) },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }
}
