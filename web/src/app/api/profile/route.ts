// src/app/api/profile/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function norm(a: unknown) {
  return String(a || "").toLowerCase();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const xAddr = norm(req.headers.get("x-addr"));
    const address = norm(body.address);

    if (!address) {
      return NextResponse.json({ error: "address required" }, { status: 400 });
    }

    // Simple auth: header must match payload (both lowercase)
    if (!xAddr || xAddr !== address) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const data = {
      address,
      username: String(body.username || "").trim(),
      avatar_url: String(body.avatar_url || "").trim() || null,
      twitter: String(body.twitter || "").replace(/^@/, "").trim() || null,
      telegram: String(body.telegram || "").replace(/^@/, "").trim() || null,
    };

    if (!data.username) {
      return NextResponse.json({ error: "username required" }, { status: 400 });
    }

    await prisma.profile.upsert({
      where: { address },
      update: {
        username: data.username,
        avatar_url: data.avatar_url,
        twitter: data.twitter,
        telegram: data.telegram,
      },
      create: data,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "server error" }, { status: 500 });
  }
}
