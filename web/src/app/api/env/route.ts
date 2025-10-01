import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    NEXT_PUBLIC_BSC_FACTORY_ADDRESS: process.env.NEXT_PUBLIC_BSC_FACTORY_ADDRESS || null,
    NODE_ENV: process.env.NODE_ENV || null,
  });
}
