import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ADMIN = (process.env.NEXT_PUBLIC_NEWS_ADMIN || "").toLowerCase();

export async function GET() {
  const rows = await prisma.poolNews.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json(rows.map(r => ({
    id: r.id, body: r.body, created_at: Math.floor(r.createdAt.getTime()/1000), created_by: r.createdBy
  })));
}

export async function POST(req: Request) {
  const addr = (req.headers.get("x-addr") || "").toLowerCase();
  if (!addr || addr !== ADMIN) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { body } = await req.json();
  const row = await prisma.poolNews.create({
    data: { pool: "global", body: String(body || "").trim(), createdBy: addr },
  });
  return NextResponse.json({ id: row.id });
}

export async function PUT(req: Request) {
  const addr = (req.headers.get("x-addr") || "").toLowerCase();
  if (!addr || addr !== ADMIN) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, body } = await req.json();
  await prisma.poolNews.update({ where: { id: Number(id) }, data: { body: String(body || "").trim() } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const addr = (req.headers.get("x-addr") || "").toLowerCase();
  if (!addr || addr !== ADMIN) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await req.json();
  await prisma.poolNews.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
