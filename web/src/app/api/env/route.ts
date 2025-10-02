import { NextResponse } from "next/server";

// Make sure this runs on Node.js, not Edge
export const runtime = "nodejs";
// Ensure Next doesn't pre-render or cache the value
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json({
    NEXT_PUBLIC_BSC_FACTORY_ADDRESS: process.env.NEXT_PUBLIC_BSC_FACTORY_ADDRESS ?? null,
    NODE_ENV: process.env.NODE_ENV ?? null,
    hasEnv: Object.prototype.hasOwnProperty.call(process.env, "NEXT_PUBLIC_BSC_FACTORY_ADDRESS"),
  });
}

