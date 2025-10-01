"use client";
import React from "react";

export default function TokenFees({ pool, chain = 97 }: { pool: string; chain?: number }) {
  const [creatorPct, setCreatorPct] = React.useState<number | null>(null);

  React.useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`/api/pool/fees?pool=${pool}&chain=${chain}`, { cache: "no-store" });
        const j = await r.json();
        const pct = (Number(j?.creatorBps) || 0) / 100;
        if (!dead) setCreatorPct(pct);
      } catch {
        if (!dead) setCreatorPct(0);
      }
    })();
    return () => { dead = true; };
  }, [pool, chain]);

  const display = creatorPct == null ? "…" : `${creatorPct.toFixed(2)}%`;

  return (
    <div className="text-sm">
      <b>Taxes</b>: {display}
    </div>
  );
}
