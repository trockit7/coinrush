// src/app/api/token/record/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";              // Prisma singleton
import type { Prisma } from "@prisma/client";   // ✅ import types from @prisma/client

function isHex40(s: unknown) {
  return typeof s === "string" && /^0x[a-fA-F0-9]{40}$/.test(s);
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    // required / core
    const pool_addr  = String(body.pool_addr || "").toLowerCase().trim();
    const token_addr = String(body.token_addr || "").toLowerCase().trim();
    const name       = String(body.name || "").trim();
    const symbol     = String(body.symbol || "").trim();

    // optional metadata (nullable strings)
    const image_url   = strOrNull(body.image_url);
    const description = strOrNull(body.description);
    const website     = strOrNull(body.website);
    const telegram    = strOrNull(body.telegram);
    const twitter     = strOrNull(body.twitter);

    // creator (REQUIRED per your current Prisma types)
    const created_byRaw = String(body.created_by || "").toLowerCase().trim();
    const created_by = isHex40(created_byRaw) ? created_byRaw : "";

    // ---- validations (align with Prisma-required fields) ----
    if (!isHex40(pool_addr)) {
      return NextResponse.json({ error: "bad pool_addr" }, { status: 400 });
    }
    if (!isHex40(token_addr)) {
      return NextResponse.json({ error: "bad token_addr (required)" }, { status: 400 });
    }
    if (!name || !symbol) {
      return NextResponse.json({ error: "name/symbol required" }, { status: 400 });
    }
    if (!isHex40(created_by)) {
      return NextResponse.json({ error: "bad created_by (required)" }, { status: 400 });
    }

    // Build CREATE/UPDATE payloads with proper Prisma types
    const createData: Prisma.TokenUncheckedCreateInput = {
      pool_addr,
      token_addr,
      name,
      symbol,
      created_by,
      image_url: image_url ?? undefined,
      description: description ?? undefined,
      website: website ?? undefined,
      telegram: telegram ?? undefined,
      twitter: twitter ?? undefined,
    };

    const updateData: Prisma.TokenUncheckedUpdateInput = {
      token_addr,
      name,
      symbol,
      created_by,
      image_url: image_url ?? undefined,
      description: description ?? undefined,
      website: website ?? undefined,
      telegram: telegram ?? undefined,
      twitter: twitter ?? undefined,
    };

    const rec = await prisma.token.upsert({
      where: { pool_addr },
      create: createData,
      update: updateData,
    });

    return NextResponse.json({ ok: true, rec });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "record failed" },
      { status: 400 }
    );
  }
}
