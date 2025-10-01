import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = String(searchParams.get("address") || "").toLowerCase();
  if (!address) return NextResponse.json([]);

  const rows = await prisma.token.findMany({
    where: { created_by: address },
    orderBy: { created_at: "desc" },
  });
  return NextResponse.json(rows);
}
