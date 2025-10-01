import { NextResponse } from "next/server";

// Force Node runtime (not edge)
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    NEXT_PUBLIC_BSC_FACTORY_ADDRESS: process.env.NEXT_PUBLIC_BSC_FACTORY_ADDRESS ?? null,
    NODE_ENV: process.env.NODE_ENV ?? null,
  });
}
