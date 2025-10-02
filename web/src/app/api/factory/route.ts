import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isAddr(x?: string | null) {
  return !!x && /^0x[0-9a-fA-F]{40}$/.test(x);
}

export async function GET() {
  const envFactory =
    (process.env.NEXT_PUBLIC_BSC_FACTORY_ADDRESS ??
      process.env.BSC_FACTORY_ADDRESS ??
      process.env.FACTORY_ADDR ??
      "").trim();

  const rpc =
    process.env.NEXT_PUBLIC_BSC_HTTP_1 ??
    process.env.BSC_HTTP_1 ??
    "https://bsc-testnet-rpc.publicnode.com";

  let chainId: string | null = null;
  let code: string | null = null;
  let err: any = null;

  try {
    const cid = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      // avoid any edge caches:
      cache: "no-store",
    }).then(r => r.json());
    chainId = cid?.result ?? null;

    if (isAddr(envFactory)) {
      const codeRes = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "eth_getCode",
          params: [envFactory, "latest"],
        }),
        cache: "no-store",
      }).then(r => r.json());
      code = codeRes?.result ?? null;
    }
  } catch (e: any) {
    err = String(e?.message ?? e);
  }

  return NextResponse.json({
    env: {
      NEXT_PUBLIC_BSC_FACTORY_ADDRESS: envFactory || null,
      RPC: rpc,
      NODE_ENV: process.env.NODE_ENV ?? null,
    },
    checks: {
      factoryLooksValid: isAddr(envFactory),
      chainId,
      codePresent: !!code && code !== "0x",
      codeLen: code ? code.length : 0,
    },
    error: err,
  });
}
