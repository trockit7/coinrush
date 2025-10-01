// src/app/api/token/latest/route.ts
import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

type CacheEntry = { expires: number; data: any[] };
const CACHE: Record<string, CacheEntry> = {};
function getCache(key: string) {
  const hit = CACHE[key];
  return hit && hit.expires > Date.now() ? hit.data : null;
}
function setCache(key: string, data: any[], ttlMs = 10_000) {
  CACHE[key] = { expires: Date.now() + ttlMs, data };
}

function dbPath() {
  const p = process.env.SQLITE_PATH || "./var/coinrush.db";
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 10)));
    const cacheKey = `latest:${limit}`;
    const cached = getCache(cacheKey);
    if (cached) return NextResponse.json(cached, { status: 200 });

    const p = dbPath();
    if (!fs.existsSync(p)) return NextResponse.json([], { status: 200 });
    const db = new Database(p, { readonly: true, fileMustExist: true });

    const cols = db.prepare(`PRAGMA table_info(tokens)`).all().map((r: any) => String(r.name).toLowerCase());
    const tsCol =
      ["created_at_ms","ts_ms","created_ts","timestamp_ms","created_at","created"].find((c) => cols.includes(c)) ||
      null;

    const sql = tsCol
      ? `SELECT pool_addr, token_addr, name, symbol, image_url, created_by, ${tsCol} AS ts_raw
         FROM tokens ORDER BY ${tsCol} DESC, rowid DESC LIMIT ?`
      : `SELECT pool_addr, token_addr, name, symbol, image_url, created_by
         FROM tokens ORDER BY rowid DESC LIMIT ?`;

    const rows = db.prepare(sql).all(limit);
    setCache(cacheKey, rows, 10_000);
    return NextResponse.json(rows, { status: 200 });
  } catch (e) {
    console.error("[latest] error", e);
    return NextResponse.json([], { status: 200 });
  }
}
