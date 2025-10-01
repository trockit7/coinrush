// src/app/api/profile/bulk/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const addresses: string[] = Array.isArray(body?.addresses) ? body.addresses : [];
    const addrs = Array.from(
      new Set(addresses.map((a) => String(a || "").toLowerCase()).filter(Boolean))
    );

    if (addrs.length === 0) return NextResponse.json({});

    const rows = await prisma.profile.findMany({
      where: { address: { in: addrs } },
      select: {
        address: true,
        username: true,
        avatar_url: true,
        twitter: true,
        telegram: true,
      },
    });

    const out: Record<string, { username?: string; avatar_url?: string; twitter?: string | null; telegram?: string | null }> =
      {};

    for (const r of rows) {
      out[r.address.toLowerCase()] = {
        username: r.username,
        avatar_url: r.avatar_url || undefined,
        twitter: r.twitter ?? null,
        telegram: r.telegram ?? null,
      };
    }

    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "server error" }, { status: 500 });
  }
}
