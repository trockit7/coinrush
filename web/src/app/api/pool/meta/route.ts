// src/app/api/pool/meta/route.ts

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { Contract, JsonRpcProvider, formatEther } from "ethers";
import { CHAINS, CHAIN_RPC } from "@/lib/chains";
import { openDb } from "@/lib/db"; // SQLite fallback (if present)

// ────────────────────────────────────────────────────────────
// Local minimal ABIs (ethers-compatible string fragments)
// Avoids viem/abitype 'Abi' vs 'InterfaceAbi' type mismatch
// ────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────
// Try to load Prisma { prisma } if available (doesn't throw)
// ────────────────────────────────────────────────────────────
async function loadPrisma(): Promise<{ prisma: any } | null> {
  try {
    const mod = await import("@/lib/db");
    if ((mod as any)?.prisma) return { prisma: (mod as any).prisma };
    return null;
  } catch {
    return null;
  }
}

function isHex40(s: unknown): s is string {
  return typeof s === "string" && /^0x[a-fA-F0-9]{40}$/.test(s);
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

// DB row shape we care about (Prisma or SQLite)
type TokenRow = {
  pool_addr?: string | null;
  token_addr?: string | null;
  name?: string | null;
  symbol?: string | null;
  image_url?: string | null;
  imageUrl?: string | null; // tolerate legacy key
  created_by?: string | null;
  description?: string | null;
  website?: string | null;
  telegram?: string | null;
  twitter?: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qPool = (url.searchParams.get("pool") || "").toLowerCase().trim();
    const qToken = (url.searchParams.get("token") || "").toLowerCase().trim();
    const chain = Number(url.searchParams.get("chain") || "97") || 97;

    if (!isHex40(qPool) && !isHex40(qToken)) {
      return NextResponse.json({ error: "need ?pool or ?token" }, { status: 400 });
    }

    // ──────────────────────────────────────────────
    // 1) Read DB record(s) (Prisma first, SQLite fallback)
    // ──────────────────────────────────────────────
    let row: TokenRow | null = null;

    // Try Prisma first
    const prismaMod = await loadPrisma();
    if (prismaMod?.prisma?.token) {
      if (isHex40(qPool)) {
        row =
          (await prismaMod.prisma.token.findUnique({
            where: { pool_addr: qPool },
          })) || null;
      } else if (isHex40(qToken)) {
        row =
          (await prismaMod.prisma.token.findUnique({
            where: { token_addr: qToken },
          })) || null;
      }
    }

    // If Prisma empty, try SQLite
    if (!row) {
      try {
        const db = await openDb();
        if (isHex40(qPool)) {
          const stmt = db.prepare<unknown[], TokenRow>(
            `SELECT pool_addr, token_addr, name, symbol, image_url, created_by,
                    description, website, telegram, twitter
             FROM tokens WHERE lower(pool_addr)=? LIMIT 1`
          );
          row = stmt.get(qPool) ?? null;
        } else if (isHex40(qToken)) {
          const stmt = db.prepare<unknown[], TokenRow>(
            `SELECT pool_addr, token_addr, name, symbol, image_url, created_by,
                    description, website, telegram, twitter
             FROM tokens WHERE lower(token_addr)=? LIMIT 1`
          );
          row = stmt.get(qToken) ?? null;
        }
      } catch {
        // ignore if SQLite not available
      }
    }

    // Normalize DB fields
    const dbPool = (row?.pool_addr || "").toLowerCase() || null;
    const dbToken = (row?.token_addr || "").toLowerCase() || null;
    const dbName = row?.name || null;
    const dbSymbol = row?.symbol || null;
    const dbImage = (row?.image_url || row?.imageUrl || null) ?? null; // tolerate legacy key
    const dbCreatedBy = (row?.created_by || null)?.toLowerCase() || null;

    // Four meta fields (default to empty string for UI convenience)
    const metaDescription = row?.description ?? "";
    const metaWebsite = row?.website ?? "";
    const metaTelegram = row?.telegram ?? "";
    const metaTwitter = row?.twitter ?? "";

    // Resolve preferred pool for on-chain calls:
    const poolAddr = isHex40(qPool) ? qPool : dbPool;

    // ──────────────────────────────────────────────
    // 2) If we still don't know pool, return DB-only normalized payload
    // ──────────────────────────────────────────────
    if (!isHex40(poolAddr)) {
      return NextResponse.json(
        {
          ok: true,
          chain,
          pool: null,
          token: isHex40(qToken) ? qToken : dbToken,
          name: dbName,
          symbol: dbSymbol,
          image_url: dbImage,
          created_by: dbCreatedBy,
          description: metaDescription,
          website: metaWebsite,
          telegram: metaTelegram,
          twitter: metaTwitter,
          // on-chain fields unavailable without a pool
          price: null,
          marketCapBNB: null,
          targetCapBNB: null,
          reserveNative: null,
          reserveToken: null,
          migrated: null,
          creator: null,
          creatorFeeBps: null,
          creatorFeePct: null,
        },
        { headers: { "cache-control": "no-store, max-age=0" } }
      );
    }

    // ──────────────────────────────────────────────
    // 3) On-chain fetch (optional but supported)
    // ──────────────────────────────────────────────
    const provider = await getProvider(chain);
    const pool = new Contract(poolAddr, POOL_READ_ABI, provider);

    let token = "";
    let owner = "";
    let migrated = false;
    let x0 = 0n, y0 = 0n;
    let reserveNative = 0n, reserveToken = 0n;
    let priceWei = 0n, targetCapWei = 0n;
    let creatorFeeBps: number | null = null;

    try { token = await pool.token(); } catch {}
    try { owner = await pool.owner(); } catch {}
    try { migrated = Boolean(await pool.migrated()); } catch {}
    try { x0 = BigInt(await pool.x0()); } catch {}
    try { y0 = BigInt(await pool.y0()); } catch {}
    try { reserveNative = BigInt(await pool.reserveNative()); } catch {}
    try { reserveToken = BigInt(await pool.reserveToken()); } catch {}
    try { targetCapWei = BigInt(await pool.targetMarketCapWei()); } catch {}

    // Price from view, else derive CPMM
    try {
      const p: bigint = await (pool as any).priceWeiPerToken();
      priceWei = BigInt(p);
    } catch {
      try {
        const rN = reserveNative + x0;
        const rT = reserveToken + y0;
        priceWei = rT > 0n ? (rN * 10n ** 18n) / rT : 0n;
      } catch {}
    }

    try {
      const bps: bigint = await (pool as any).creatorFeeBps();
      creatorFeeBps = Number(bps);
    } catch {
      creatorFeeBps = null;
    }

    // Token metadata from chain (fallbacks only; DB overrides win)
    let name = "Token";
    let symbol = "TKN";
    let totalSupply = 0n;
    if (isHex40(token)) {
      const t = new Contract(token, ERC20_MIN_ABI, provider);
      try { name = await t.name(); } catch {}
      try { symbol = await t.symbol(); } catch {}
      try { totalSupply = BigInt(await t.totalSupply()); } catch {}
    }

    const mcapWei =
      priceWei > 0n && totalSupply > 0n
        ? (priceWei * totalSupply) / 10n ** 18n
        : 0n;

    // Final normalized response: DB overrides chain for name/symbol/image/created_by
    return NextResponse.json(
      {
        ok: true,
        chain,
        pool: poolAddr,
        token: isHex40(token) ? token.toLowerCase() : dbToken || null,

        // Names & imagery (DB can override)
        name: dbName || name || null,
        symbol: dbSymbol || symbol || null,
        image_url: dbImage || null,

        // Ownership & status
        creator: owner || null,        // on-chain owner (legacy)
        created_by: dbCreatedBy || null, // normalized from DB if present
        migrated,

        // Prices & reserves (as strings in BNB units)
        price: formatEther(priceWei),
        marketCapBNB: formatEther(mcapWei),
        targetCapBNB: formatEther(targetCapWei),
        reserveNative: formatEther(reserveNative),
        reserveToken: formatEther(reserveToken),

        // Fees
        creatorFeeBps,
        creatorFeePct: creatorFeeBps != null ? (creatorFeeBps / 100).toFixed(2) : null,

        // ✅ Normalized meta fields (always present as strings; default "")
        description: metaDescription,
        website: metaWebsite,
        telegram: metaTelegram,
        twitter: metaTwitter,
      },
      { headers: { "cache-control": "no-store, max-age=0" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "server error" },
      { status: 500 }
    );
  }
}
