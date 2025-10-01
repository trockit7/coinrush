"use client";
import React from "react";
import Link from "next/link";

export default function AddressName({
  address,
  devAddress,
  className = "",
  size = 20
}: { address: string; devAddress?: string; className?: string; size?: number }) {
  const [p, setP] = React.useState<any>(null);
  const addr = address?.toLowerCase?.() || "";

  React.useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`/api/profile?address=${addr}`, { cache: "no-store" });
        const j = await r.json();
        if (!dead) setP(j?.profile || null);
      } catch {}
    })();
    return () => { dead = true; };
  }, [addr]);

  const isDev = devAddress && devAddress.toLowerCase() === addr;

  const inner = (
    <>
      {p?.avatar_url
        ? <img src={p.avatar_url} alt="" style={{ width: size, height: size }} className="rounded-full object-cover" />
        : <span className="inline-block rounded-full bg-gray-200" style={{ width: size, height: size }} />
      }
      <span className="truncate max-w-[160px]">
        {p?.username || `${addr.slice(0,6)}…${addr.slice(-4)}`}
      </span>
      {isDev && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800">Dev</span>}
    </>
  );

  return (
    <Link href={`/u/${addr}`} prefetch={false} className={`inline-flex items-center gap-2 ${className}`}>
      {inner}
    </Link>
  );
}
