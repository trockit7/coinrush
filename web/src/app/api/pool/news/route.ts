import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";        // no caching
export const revalidate = 0;

type NewsItem = { id: number; body: string; created_at: number; created_by: string };

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

const ADMIN_ADDR = String(
  (process.env.ADMIN_NEWS_WALLET || process.env.NEXT_PUBLIC_NEWS_ADMIN || "")
).toLowerCase();

function newsFilePath() {
  // Use env if set, else default to ./data/global-news.json
  const target = process.env.DATA_NEWS_FILE || path.join(process.cwd(), "data", "global-news.json");
  return path.isAbsolute(target) ? target : path.join(process.cwd(), target);
}

async function ensureFileReady(file: string) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, "[]", "utf8");
  }
}

async function readAll(file: string): Promise<NewsItem[]> {
  await ensureFileReady(file);
  const raw = await fs.readFile(file, "utf8").catch(() => "[]");
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeAll(file: string, items: NewsItem[]) {
  await ensureFileReady(file);
  await fs.writeFile(file, JSON.stringify(items, null, 2), "utf8");
}

function clientAddr(req: NextRequest) {
  return (req.headers.get("x-addr") || "").toLowerCase();
}

export async function GET() {
  try {
    const file = newsFilePath();
    const items = await readAll(file);
    items.sort((a, b) => b.created_at - a.created_at);
    return NextResponse.json(items);
  } catch (e: any) {
    return jsonError(500, e?.message || "Failed to read news");
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_ADDR) return jsonError(401, "Admin wallet not configured on server.");
    const addr = clientAddr(req);
    if (!addr || addr !== ADMIN_ADDR) return jsonError(401, "Not authorized.");

    const { body } = await req.json().catch(() => ({}));
    if (typeof body !== "string" || !body.trim()) return jsonError(400, "Missing body");

    const file = newsFilePath();
    const items = await readAll(file);
    const id = (items[0]?.id || 0) + 1;

    const item: NewsItem = {
      id,
      body: String(body).slice(0, 280),
      created_at: Date.now(),
      created_by: addr,
    };
    items.unshift(item);
    await writeAll(file, items);
    return NextResponse.json(item);
  } catch (e: any) {
    return jsonError(500, e?.message || "Failed to create news");
  }
}

export async function PUT(req: NextRequest) {
  try {
    if (!ADMIN_ADDR) return jsonError(401, "Admin wallet not configured on server.");
    const addr = clientAddr(req);
    if (!addr || addr !== ADMIN_ADDR) return jsonError(401, "Not authorized.");

    const { id, body } = await req.json().catch(() => ({}));
    if (!id || typeof body !== "string") return jsonError(400, "Missing id/body");

    const file = newsFilePath();
    const items = await readAll(file);
    const idx = items.findIndex(n => n.id === Number(id));
    if (idx === -1) return jsonError(404, "Not found");

    items[idx].body = String(body).slice(0, 280);
    await writeAll(file, items);
    return NextResponse.json(items[idx]);
  } catch (e: any) {
    return jsonError(500, e?.message || "Failed to update news");
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!ADMIN_ADDR) return jsonError(401, "Admin wallet not configured on server.");
    const addr = clientAddr(req);
    if (!addr || addr !== ADMIN_ADDR) return jsonError(401, "Not authorized.");

    const { id } = await req.json().catch(() => ({}));
    if (!id) return jsonError(400, "Missing id");

    const file = newsFilePath();
    const items = await readAll(file);
    const next = items.filter(n => n.id !== Number(id));
    await writeAll(file, next);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return jsonError(500, e?.message || "Failed to delete news");
  }
}
