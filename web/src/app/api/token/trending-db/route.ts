import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") || "6"), 50);

  const rows = await prisma.token.findMany({
    orderBy: [{ pct_change_24h: "desc" }, { created_at: "desc" }],
    take: limit,
  });
  return NextResponse.json(rows);
}
