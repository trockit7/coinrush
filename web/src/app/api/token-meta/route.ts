import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const ROOT = process.env.APP_DATA_DIR || "/var/appdata";
const FILE = path.join(ROOT, "token-meta.json");

async function readMap(): Promise<Record<string, any>> {
  try {
    const s = await fs.readFile(FILE, "utf8");
    return JSON.parse(s);
  } catch {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    return {};
  }
}
async function writeMap(obj: Record<string, any>) {
  await fs.writeFile(FILE, JSON.stringify(obj, null, 2));
}

export async function GET(req: NextRequest) {
  const token = (req.nextUrl.searchParams.get("token") || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(token)) return NextResponse.json({ error: "bad token" }, { status: 400 });
  const db = await readMap();
  return NextResponse.json(db[token] || {});
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const token = String(body.token || "").toLowerCase();
    const imageUrl = String(body.imageUrl || "");

    if (!/^0x[a-f0-9]{40}$/.test(token)) return NextResponse.json({ error: "bad token" }, { status: 400 });
    if (!imageUrl.startsWith("/api/token-images/")) return NextResponse.json({ error: "bad image url" }, { status: 400 });

    const db = await readMap();
    db[token] = { ...(db[token] || {}), imageUrl, updatedAt: Date.now() };
    await writeMap(db);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "save failed" }, { status: 500 });
  }
}
