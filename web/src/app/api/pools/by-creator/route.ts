export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { openDb } from "@/lib/db";

function isHex40(s: string) { return /^0x[0-9a-fA-F]{40}$/.test(s); }

export async function GET(req: NextRequest) {
  try {
    const address = (new URL(req.url).searchParams.get("address") || "").toLowerCase();
    if (!isHex40(address)) return NextResponse.json({ error: "bad address" }, { status: 400 });

    const db = await openDb();
    const rows = db.prepare(`
      SELECT token_addr, pool_addr, chain_id, name, symbol, image_url, created_at
      FROM tokens
      WHERE lower(created_by) = ?
      ORDER BY (created_at IS NULL), created_at DESC
      LIMIT 200
    `).all(address);

    return NextResponse.json({ rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
