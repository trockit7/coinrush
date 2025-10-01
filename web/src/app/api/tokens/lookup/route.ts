import { NextResponse } from "next/server";
import { getDB } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const pool = (searchParams.get("pool") || "").toLowerCase();
    const token = (searchParams.get("token") || "").toLowerCase();
    if (!pool && !token) return NextResponse.json({ error: "pool or token required" }, { status: 400 });

    const db = getDB();
    const row = db.prepare(
      `SELECT token_addr, pool_addr, name, symbol, image_url
         FROM tokens
        WHERE (LOWER(pool_addr) = ? AND ? != '')
           OR (LOWER(token_addr) = ? AND ? != '')
        LIMIT 1`
    ).get(pool, pool, token, token) as any;

    if (!row) return NextResponse.json({ ok: true, found: false });

    return NextResponse.json({
      ok: true,
      found: true,
      token_addr: row.token_addr,
      pool_addr: row.pool_addr,
      name: row.name,
      symbol: row.symbol,
      image_url: row.image_url || null
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "lookup failed" }, { status: 500 });
  }
}
