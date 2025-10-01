// src/app/api/token-images/[name]/route.ts

// If you read files with fs, keep this to ensure Node runtime (not Edge)
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export async function GET(_req: Request, { params }: { params: { name: string } }) {
  try {
    const name = (params?.name || "").replace(/[^a-zA-Z0-9._-]/g, "");
    const file = path.join(process.cwd(), "public", "token-images", name);

    const data = await fs.readFile(file); // Buffer
    const ext = path.extname(name).toLowerCase();
    const type =
      ext === ".png" ? "image/png" :
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      ext === ".webp" ? "image/webp" :
      ext === ".gif" ? "image/gif" :
      "application/octet-stream";

    // Convert Buffer -> Uint8Array so it matches BodyInit (BufferSource)
    const body = new Uint8Array(data);

    return new NextResponse(body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
