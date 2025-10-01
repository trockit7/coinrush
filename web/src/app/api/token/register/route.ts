// src/app/api/token/register/route.ts
import { NextResponse } from "next/server";
import { getDB } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { token, pool, name, symbol, image_url = "", creator } = body || {};

    const hex40 = /^0x[a-fA-F0-9]{40}$/;
    if (!hex40.test(token) || !hex40.test(pool)) {
      return NextResponse.json({ error: "bad token/pool" }, { status: 400 });
    }
    if (!creator || !hex40.test(creator)) {
      return NextResponse.json({ error: "bad creator" }, { status: 400 });
    }
    if (!name || !symbol) {
      return NextResponse.json({ error: "name/symbol required" }, { status: 400 });
    }

    const db = getDB();
    const now = Date.now();
    db.prepare(`
      INSERT INTO tokens (token_addr, pool_addr, name, symbol, image_url, created_by, created_at)
      VALUES (lower(@token), lower(@pool), @name, @symbol, @image_url, lower(@creator), @now)
      ON CONFLICT(token_addr) DO UPDATE SET
        pool_addr = excluded.pool_addr,
        name      = excluded.name,
        symbol    = excluded.symbol,
        image_url = excluded.image_url,
        created_by= excluded.created_by
    `).run({ token, pool, name, symbol, image_url, creator, now });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
