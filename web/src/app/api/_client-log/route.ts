import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    // This goes to your server logs on Railway:
    console.error("[CLIENT LOG]", JSON.stringify(body));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[CLIENT LOG ERROR]", e);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
