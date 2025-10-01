// web/src/app/api/upload/token/route.ts
import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const runtime = "nodejs";

const ROOT = path.join(process.cwd(), "public", "uploads", "token");
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" };
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED = new Map<string, string>([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

// (optional) very light IP rate-limit memory bucket
const hits = new Map<string, { n: number; t: number }>();
function rateLimit(ip: string, maxPerMin = 20) {
  const now = Date.now();
  const cur = hits.get(ip) || { n: 0, t: now };
  if (now - cur.t > 60_000) { cur.n = 0; cur.t = now; }
  cur.n++;
  hits.set(ip, cur);
  return cur.n <= maxPerMin;
}

export async function POST(req: Request) {
  try {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    if (!rateLimit(ip)) {
      return NextResponse.json({ error: "Too many uploads, slow down." }, { status: 429 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "No file" }, { status: 400 });
    }

    // Validate size
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Invalid size (max 2MB)" }, { status: 400 });
    }

    // Validate type → choose extension
    const type = (file.type || "").toLowerCase();
    const ext = ALLOWED.get(type);
    if (!ext) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 415 });
    }

    // Read into memory
    const buf = Buffer.from(await file.arrayBuffer());

    // Basic “magic” check (optional): ensure first bytes look like the type we claim
    if (ext === ".png" && buf.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") {
      return NextResponse.json({ error: "Corrupt PNG" }, { status: 400 });
    }

    // Ensure directory
    await fs.mkdir(ROOT, { recursive: true, mode: 0o755 });

    // Random filename (32 hex + ext)
    const name = crypto.randomBytes(16).toString("hex") + ext;
    const outPath = path.join(ROOT, name);

    // Write with standard perms
    await fs.writeFile(outPath, buf, { mode: 0o644 });

    const url = `/uploads/token/${name}`;
    return NextResponse.json({ ok: true, url }, { status: 200, headers: CACHE_HEADERS });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "upload failed" }, { status: 500 });
  }
}
