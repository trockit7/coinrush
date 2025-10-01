// src/app/api/token/ingest/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function norm(a: unknown) { return String(a || "").toLowerCase(); }

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const pool_addr  = norm(b.pool_addr);
    const token_addr = norm(b.token_addr);
    const symbol     = String(b.symbol || "").trim();
    const name       = String(b.name || "").trim() || symbol || "Token";
    const created_by = norm(b.created_by);
    const image_url  = String(b.image_url || "").trim();

    if (!pool_addr || !token_addr) {
      return NextResponse.json({ error: "pool_addr and token_addr required" }, { status: 400 });
    }

    const row = await prisma.token.upsert({
      where: { pool_addr },
      create: { pool_addr, token_addr, name, symbol, image_url, created_by },
      update: { token_addr, name, symbol, image_url, created_by },
    });

    return NextResponse.json(row);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "ingest failed" }, { status: 500 });
  }
}
