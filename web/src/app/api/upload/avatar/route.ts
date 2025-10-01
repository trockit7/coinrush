// src/app/api/upload/avatar/route.ts
import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// ⬇️ Keep your original local storage root + return URL pattern
const ROOT = path.join(process.cwd(), "public", "uploads", "avatar");

// -------- Security helpers (try to use your shared utils if they exist) --------
type SafeImageMimeFn = (mime: string) => boolean;
type RateLimitOKFn = (ip: string) => boolean | Promise<boolean>;
type VerifyTurnstileFn = (token: string | null) => boolean | Promise<boolean>;

let safeImageMime: SafeImageMimeFn = (mime) =>
  /^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test((mime || "").toLowerCase());

let rateLimitOK: RateLimitOKFn = () => true; // noop fallback
let verifyTurnstile: VerifyTurnstileFn = () => true; // noop fallback

// Attempt to bind to your shared functions if available
(async () => {
  try {
    const mod = await import("@/lib/security/sanitize");
    if (typeof (mod as any).safeImageMime === "function") {
      safeImageMime = (mod as any).safeImageMime as SafeImageMimeFn;
    }
  } catch {}
  try {
    const mod = await import("@/lib/security/rate-limit");
    if (typeof (mod as any).rateLimitOK === "function") {
      rateLimitOK = (mod as any).rateLimitOK as RateLimitOKFn;
    }
  } catch {}
  try {
    const mod = await import("@/lib/security/turnstile");
    if (typeof (mod as any).verifyTurnstile === "function") {
      verifyTurnstile = (mod as any).verifyTurnstile as VerifyTurnstileFn;
    }
  } catch {}
})().catch(() => {});

// ✅ Keep Node.js runtime (we write to disk)
export const runtime = "nodejs";

// (Optional) short CDN/public cache on the response
const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
};

// Max avatar size (2 MB)
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    // Basic rate limiting (IP from CF/Proxy headers or local)
    const ip =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-forwarded-for") ||
      "local";
    if (!(await rateLimitOK(ip))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // Optional: Turnstile token from header or form field (if you use it)
    const hdrTurnstile = req.headers.get("x-turnstile-token");
    let ok = await verifyTurnstile(hdrTurnstile);
    if (!ok) {
      // try the form field name commonly used by Turnstile
      const preForm = await req.clone().formData().catch(() => null);
      const formToken =
        (preForm?.get("cf-turnstile-response") as string | null) || null;
      ok = await verifyTurnstile(formToken);
    }
    if (!ok) {
      return NextResponse.json({ error: "Bot check failed" }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
    }

    // Size guard
    const size = file.size || 0;
    if (size <= 0 || size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large" }, { status: 413 });
    }

    // Type whitelist (via shared helper or local fallback)
    const mime = (file.type || "").toLowerCase();
    if (!safeImageMime(mime)) {
      return NextResponse.json({ error: "unsupported type" }, { status: 415 });
    }

    // Pick a safe extension from MIME
    const ext =
      mime.includes("svg") ? "svg" :
      mime.includes("png") ? "png" :
      mime.includes("gif") ? "gif" :
      mime.includes("webp") ? "webp" : "jpg";

    // Read bytes
    const buf = Buffer.from(await file.arrayBuffer());

    // Randomized filename (no user-controlled names)
    const name = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
    const outPath = path.join(ROOT, name);

    // Ensure dir and write
    await fs.mkdir(ROOT, { recursive: true });
    await fs.writeFile(outPath, buf, { mode: 0o644 });

    // Keep your original public URL shape
    return NextResponse.json(
      { url: `/uploads/avatar/${name}` },
      { status: 200, headers: CACHE_HEADERS }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "upload failed" },
      { status: 500 }
    );
  }
}

