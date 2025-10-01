"use client";
import * as React from "react";

export function useBnbUsd(pollMs = 30000) {
  const [usd, setUsd] = React.useState<number | null>(null);
  React.useEffect(() => {
    let alive = true, t: any;
    const run = async () => {
      try {
        const r = await fetch("/api/price/bnb", { cache: "no-store" });
        const j = await r.json();
        const v = Number(j?.usdPerBnb);
        if (alive && Number.isFinite(v) && v > 0) setUsd(v);
      } catch {}
      t = setTimeout(run, pollMs);
    };
    run();
    return () => { alive = false; clearTimeout(t); };
  }, [pollMs]);
  return usd;
}
