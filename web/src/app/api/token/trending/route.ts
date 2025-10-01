// src/app/api/token/trending/route.ts
import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { Interface, JsonRpcProvider, id as keccakId } from "ethers";
import type { LogDescription } from "ethers";

export const dynamic = "force-dynamic";

/*──────────────── Cache ────────────────*/
type CacheEntry = { expires: number; data: any[] };
const CACHE: Record<string, CacheEntry> = {};
const getCache = (k: string) => (CACHE[k] && CACHE[k].expires > Date.now() ? CACHE[k].data : null);
const setCache = (k: string, data: any[], ttlMs = 30_000) => (CACHE[k] = { expires: Date.now() + ttlMs, data });

/*──────────────── DB helpers ────────────────*/
function dbPath() {
  const p = process.env.SQLITE_PATH || "./var/coinrush.db";
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}
let _db: Database.Database | null = null;
function getDb(): Database.Database | null {
  try {
    const p = dbPath();
    if (!fs.existsSync(p)) return null;
    if (_db) return _db;
    _db = new Database(p, { readonly: true, fileMustExist: true });
    return _db;
  } catch {
    return null;
  }
}

// ⬇️ PATCH: enforce the table we actually use
function tableExists(db: Database.Database, name: string) {
  try {
    if (name !== "tokens") return false;
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
}

// ⬇️ PATCH: lock PRAGMA to a fixed literal table name
function cols(db: Database.Database, table: string): string[] {
  try {
    if (table !== "tokens") return [];
    // table name is fixed literal — no injection risk
    return db.prepare(`PRAGMA table_info(tokens)`).all().map((r: any) => String(r.name));
  } catch {
    return [];
  }
}

function pickTsCol(c: string[]): string | null {
  const lc = c.map((x) => x.toLowerCase());
  const pref = ["created_at_ms", "ts_ms", "created_ts", "timestamp_ms", "created_at", "created"];
  return pref.find((x) => lc.includes(x)) || null;
}
function parseLimit(url: URL, def = 10, max = 50) {
  const n = Number(url.searchParams.get("limit") || def);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.floor(n)) : def;
}

/*──────────────── RPC helpers ────────────────*/
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID || 97);
const DEFAULT_RPCS =
  CHAIN_ID === 56
    ? [
        process.env.NEXT_PUBLIC_BSC_MAINNET_HTTP_1,
        process.env.NEXT_PUBLIC_BSC_MAINNET_HTTP_2,
        process.env.NEXT_PUBLIC_BSC_MAINNET_HTTP_3,
        process.env.NEXT_PUBLIC_BSC_MAINNET_HTTP_4,
        process.env.NEXT_PUBLIC_BSC_MAINNET_HTTP_5,
      ]
    : [
        process.env.NEXT_PUBLIC_BSC_HTTP_1,
        process.env.NEXT_PUBLIC_BSC_HTTP_2,
        process.env.NEXT_PUBLIC_BSC_HTTP_3,
        process.env.NEXT_PUBLIC_BSC_HTTP_4,
        process.env.NEXT_PUBLIC_BSC_HTTP_5,
        "https://bsc-testnet.publicnode.com",
      ];
const RPCS = DEFAULT_RPCS.filter(Boolean) as string[];

async function getProvider(): Promise<JsonRpcProvider | null> {
  for (const url of RPCS) {
    try {
      const prov = new JsonRpcProvider(url, { chainId: CHAIN_ID, name: CHAIN_ID === 56 ? "bsc" : "bsctest" });
      await prov.getBlockNumber();
      return prov;
    } catch {}
  }
  return null;
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/*──────────────── Events & parsing ────────────────*/
// Topics for both 4-arg and 3-arg variants
const BUY_TOPIC4 = keccakId("Buy(address,uint256,uint256,uint256)");
const SELL_TOPIC4 = keccakId("Sell(address,uint256,uint256,uint256)");
const BUY_TOPIC3 = keccakId("Buy(address,uint256,uint256)");
const SELL_TOPIC3 = keccakId("Sell(address,uint256,uint256)");

// Broadened interface with both variants (named where helpful)
const IFACE = new Interface([
  // 4-arg variants (with priceWad)
  "event Buy(address indexed buyer,uint256 bnbIn,uint256 tokensOut,uint256 priceWad)",
  "event Buy(address buyer,uint256 bnbIn,uint256 tokensOut,uint256 priceWad)",
  "event Sell(address indexed seller,uint256 tokenIn,uint256 bnbOut,uint256 priceWad)",
  "event Sell(address seller,uint256 tokenIn,uint256 bnbOut,uint256 priceWad)",

  // 3-arg legacy variants (no priceWad)
  "event Buy(address indexed buyer,uint256 bnbIn,uint256 tokensOut)",
  "event Buy(address buyer,uint256 bnbIn,uint256 tokensOut)",
  "event Sell(address indexed seller,uint256 tokenIn,uint256 bnbOut)",
  "event Sell(address seller,uint256 tokenIn,uint256 bnbOut)",
]);

type Parsed = {
  pool: string;
  blockNumber: number;
  price: number | null; // BNB per token
  bnbVol: number;
  trader?: string | null;
};

// Helper for safe numeric conversion
function toNum(x: any): number {
  try {
    const n = Number(x);
    return Number.isFinite(n) ? n : NaN;
  } catch {
    return NaN;
  }
}

// parseLog with guarded LogDescription + tolerant args (named/positional) and priceWad/priceWei variants
function parseLog(l: any): Parsed | null {
  let p: LogDescription | null = null;
  try {
    p = IFACE.parseLog({ topics: l.topics, data: l.data });
  } catch {
    p = null; // unknown/legacy signature — skip this log
  }
  if (!p) return null;

  const pool = (l.address || "").toLowerCase();

  let price: number | null = null; // BNB per token
  let bnbVol = 0;
  let trader: string | null = null;

  const a: any = p.args ?? [];

  if (p.name === "Buy") {
    const bi = toNum(a.bnbIn ?? a[1]); // wei
    const tout = toNum(a.tokensOut ?? a[2]); // token raw (assume 18d)
    const pw = a.priceWad ?? a.priceWei ?? a[3]; // tolerate ABI variants

    if (pw != null) {
      const pwN = toNum(pw) / 1e18; // priceWad -> BNB/token
      if (Number.isFinite(pwN) && pwN > 0) price = pwN;
    }
    if (price == null || price === 0) {
      // Fallback: price ≈ bnbIn / tokensOut  (1e18 cancels if both are 18d)
      if (Number.isFinite(bi) && Number.isFinite(tout) && tout > 0) price = bi / tout;
    }

    if (Number.isFinite(bi)) bnbVol = bi / 1e18; // wei → BNB for volume
    trader = String(a.buyer ?? a[0] ?? "").toLowerCase();
  } else if (p.name === "Sell") {
    const tin = toNum(a.tokenIn ?? a[1]); // token raw
    const bo = toNum(a.bnbOut ?? a[2]); // wei
    const pw = a.priceWad ?? a.priceWei ?? a[3];

    if (pw != null) {
      const pwN = toNum(pw) / 1e18;
      if (Number.isFinite(pwN) && pwN > 0) price = pwN;
    }
    if (price == null || price === 0) {
      // Fallback: price ≈ bnbOut / tokenIn
      if (Number.isFinite(bo) && Number.isFinite(tin) && tin > 0) price = bo / tin;
    }

    if (Number.isFinite(bo)) bnbVol = bo / 1e18; // wei → BNB
    trader = String(a.seller ?? a[0] ?? "").toLowerCase();
  } else {
    // not a Buy/Sell event variant we recognize
    return null;
  }

  return {
    pool,
    blockNumber: l.blockNumber,
    price: Number.isFinite(price!) ? (price as number) : null,
    bnbVol: Number.isFinite(bnbVol) ? bnbVol : 0,
    trader,
  };
}

/*──────────────── GET ────────────────*/
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseLimit(url, 10, 50);
  const debug = url.searchParams.get("debug") === "1";
  const cacheKey = `trending:${limit}`;
  const cached = getCache(cacheKey);
  if (cached && !debug) return NextResponse.json(cached, { status: 200 });

  const diag: any = { step: "start" };

  try {
    // Latest N tokens from DB
    const db = getDb();
    if (!db || !tableExists(db, "tokens")) {
      if (debug) return NextResponse.json({ diag: { ...diag, noDb: true }, data: [] }, { status: 200 });
      setCache(cacheKey, [], 20_000);
      return NextResponse.json([], { status: 200 });
    }
    const tCols = cols(db, "tokens");
    const tsCol = pickTsCol(tCols);
    const CANDIDATES = 60;
    const sql = tsCol
      ? `SELECT pool_addr, token_addr, name, symbol, image_url, created_by, ${tsCol} AS ts_raw
         FROM tokens ORDER BY ${tsCol} DESC, rowid DESC LIMIT ${CANDIDATES}`
      : `SELECT pool_addr, token_addr, name, symbol, image_url, created_by
         FROM tokens ORDER BY rowid DESC LIMIT ${CANDIDATES}`;
    const rows: any[] = db.prepare(sql).all();
    const pools = rows
      .map((r) => String(r.pool_addr || "").toLowerCase())
      .filter((a) => /^0x[a-f0-9]{40}$/.test(a));

    diag.rows = rows.length;
    diag.pools = pools.length;

    if (!pools.length) {
      if (debug) return NextResponse.json({ diag, data: [] }, { status: 200 });
      setCache(cacheKey, [], 20_000);
      return NextResponse.json([], { status: 200 });
    }

    // RPC
    const prov = await getProvider();
    if (!prov) {
      diag.noProvider = true;
      if (debug) return NextResponse.json({ diag, data: rows.slice(0, limit), fallback: "noProvider" }, { status: 200 });
      setCache(cacheKey, rows.slice(0, limit), 15_000); // show *something* instead of blank
      return NextResponse.json(rows.slice(0, limit), { status: 200 });
    }

    const latest = await prov.getBlockNumber();
    const blocksPerDay = 28_800;
    const windowBlocks = Math.min(blocksPerDay, 48_000);
    const fromBlock = Math.max(0, latest - windowBlocks);
    const cutoffBlock = latest - blocksPerDay;

    diag.latest = latest;
    diag.fromBlock = fromBlock;
    diag.cutoffBlock = cutoffBlock;

    // 1) Try single multi-address call (fast path) — include both 4-arg & 3-arg topics via OR
    let logsBuy: any[] = [];
    let logsSell: any[] = [];
    let multiOk = false;
    try {
      const baseFilter = { address: pools, fromBlock, toBlock: latest } as const;
      [logsBuy, logsSell] = await Promise.all([
        prov.getLogs({ ...baseFilter, topics: [[BUY_TOPIC4, BUY_TOPIC3]] }),
        prov.getLogs({ ...baseFilter, topics: [[SELL_TOPIC4, SELL_TOPIC3]] }),
      ]);
      multiOk = true;
    } catch (e: any) {
      diag.multiError = e?.message || String(e);
    }

    // 2) If multi-address failed or returned nothing, try chunked batches
    if (!logsBuy.length && !logsSell.length && (!multiOk || debug)) {
      const chunks = chunk(pools, 12); // small batches
      const make = async (topics: string[]) => {
        const results: any[] = [];
        for (const c of chunks) {
          try {
            const got = await prov.getLogs({ address: c, topics: [topics], fromBlock, toBlock: latest });
            if (Array.isArray(got) && got.length) results.push(...got);
          } catch {}
        }
        return results;
      };
      const [b2, s2] = await Promise.all([make([BUY_TOPIC4, BUY_TOPIC3]), make([SELL_TOPIC4, SELL_TOPIC3])]);
      if (b2.length || s2.length) {
        logsBuy = b2;
        logsSell = s2;
        diag.chunked = true;
      }
    }

    // 3) If still nothing, do a tiny per-pool fallback for first 15 pools
    if (!logsBuy.length && !logsSell.length) {
      const first = pools.slice(0, 15);
      const make = async (topics: string[]) => {
        const rs: any[] = [];
        for (const a of first) {
          try {
            const got = await prov.getLogs({ address: a, topics: [topics], fromBlock, toBlock: latest });
            if (Array.isArray(got) && got.length) rs.push(...got);
          } catch {}
        }
        return rs;
      };
      const [b3, s3] = await Promise.all([make([BUY_TOPIC4, BUY_TOPIC3]), make([SELL_TOPIC4, SELL_TOPIC3])]);
      logsBuy = b3;
      logsSell = s3;
      diag.perPool = true;
    }

    diag.buyLogs = logsBuy.length;
    diag.sellLogs = logsSell.length;

    const allLogs = ([] as any[]).concat(logsBuy || [], logsSell || []);
    if (!allLogs.length) {
      // No trades → not trending. Fall back to showing recent (so UI isn't empty).
      const fallback = rows.slice(0, limit).map((r) => ({
        pool_addr: String(r.pool_addr || "").toLowerCase(),
        token_addr: r.token_addr || "",
        name: r.name || "",
        symbol: r.symbol || "",
        image_url: r.image_url || "",
        created_by: (r.created_by || "").toLowerCase(),
        price_bnb: null,
        price_usd: null,
        change24h_pct: null,
        trades_24h: 0,
        volume_bnb_24h: 0,
        score: 0,
        __fallback: "no-activity",
      }));
      if (debug) return NextResponse.json({ diag, data: fallback, note: "no 24h activity" }, { status: 200 });
      setCache(cacheKey, fallback, 15_000);
      return NextResponse.json(fallback, { status: 200 });
    }

    // Group & score
    const byPool = new Map<string, { meta: any; logs: Parsed[] }>();
    for (const r of rows) {
      const pool = String(r.pool_addr || "").toLowerCase();
      if (/^0x[a-f0-9]{40}$/.test(pool)) byPool.set(pool, { meta: r, logs: [] });
    }
    for (const l of allLogs) {
      const parsed = parseLog(l);
      if (!parsed) continue;
      const g = byPool.get(parsed.pool);
      if (g) g.logs.push(parsed);
    }

    const scored: any[] = [];
    for (const [pool, { meta, logs }] of byPool.entries()) {
      if (!logs.length) continue;
      logs.sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber - b.blockNumber));

      const recent = logs.filter((x) => x.blockNumber > cutoffBlock);
      if (!recent.length) continue;

      const trades24 = recent.length;
      const vol24 = recent.reduce((s, x) => s + (Number.isFinite(x.bnbVol) ? x.bnbVol : 0), 0);
      const uniqueTraders = new Set(recent.map((x) => x.trader).filter(Boolean)).size;

      const priceNow = recent[recent.length - 1]?.price ?? null;
      const older = logs.filter((x) => x.blockNumber <= cutoffBlock);
      const priceBefore = older.length ? older[older.length - 1]?.price ?? null : recent[0]?.price ?? null;

      const change24h_pct =
        priceNow != null && priceBefore != null && priceBefore > 0
          ? (priceNow / priceBefore - 1) * 100
          : null;

      const mostRecentBlock = recent[recent.length - 1].blockNumber;
      const recency = Math.max(0, Math.min(1, (mostRecentBlock - cutoffBlock) / (latest - cutoffBlock + 1)));

      const score = trades24 * 2 + Math.log10(1 + vol24) * 3 + uniqueTraders * 1 + recency * 2;

      scored.push({
        pool_addr: pool,
        token_addr: meta.token_addr || "",
        name: meta.name || "",
        symbol: meta.symbol || "",
        image_url: meta.image_url || "",
        created_by: (meta.created_by || "").toLowerCase(),
        price_bnb: Number.isFinite(priceNow) ? priceNow : null,
        price_usd: null,
        change24h_pct,
        trades_24h: trades24,
        volume_bnb_24h: vol24,
        score,
      });
    }

    if (!scored.length) {
      const fallback = rows.slice(0, limit).map((r) => ({
        pool_addr: String(r.pool_addr || "").toLowerCase(),
        token_addr: r.token_addr || "",
        name: r.name || "",
        symbol: r.symbol || "",
        image_url: r.image_url || "",
        created_by: (r.created_by || "").toLowerCase(),
        price_bnb: null,
        price_usd: null,
        change24h_pct: null,
        trades_24h: 0,
        volume_bnb_24h: 0,
        score: 0,
        __fallback: "no-scored",
      }));
      if (debug) return NextResponse.json({ diag, data: fallback, note: "no scored pools" }, { status: 200 });
      setCache(cacheKey, fallback, 15_000);
      return NextResponse.json(fallback, { status: 200 });
    }

    scored.sort((a, b) => b.score - a.score);
    const out = scored.slice(0, limit);
    if (debug) return NextResponse.json({ diag, data: out }, { status: 200 });

    setCache(cacheKey, out, 30_000);
    return NextResponse.json(out, { status: 200 });
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (debug) return NextResponse.json({ diag: { ...diag, fatal: msg }, data: [] }, { status: 200 });
    return NextResponse.json([], { status: 200 });
  }
}
