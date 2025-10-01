// src/components/PoolCandleWidget.tsx
"use client";

import React from "react";
import dynamic from "next/dynamic";

type Candle = { time: number; open: number; high: number; low: number; close: number };

const ClassicCandleChart = dynamic(
  () => import("@/components/ClassicCandleChart"),
  { ssr: false }
);

type Props = {
  pool: string;
  chain: number;
  height?: number;
  dark?: boolean;
  windowSec?: number; // default 1h
  stepSec?: number;   // default 60s
  auto?: boolean;     // default true
};

export default function PoolCandleWidget({
  pool,
  chain,
  height = 300,
  dark = true,
  windowSec = 3600,
  stepSec = 60,
  auto = true,
}: Props) {
  const [candles, setCandles] = React.useState<Candle[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = React.useState<string>("");

  const fetchOnce = React.useCallback(async () => {
    try {
      setErr(null);
      const u = `/api/candles?pool=${pool}&chain=${chain}&window=${windowSec}&interval=${stepSec}`;
      const r = await fetch(u, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "fetch failed");
      setCandles(j.candles || []);
      setUpdatedAt(new Date().toLocaleTimeString());
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [pool, chain, windowSec, stepSec]);

  React.useEffect(() => { fetchOnce(); }, [fetchOnce]);

  React.useEffect(() => {
    if (!auto) return;
    const id = setInterval(fetchOnce, Math.max(10_000, stepSec * 1000));
    return () => clearInterval(id);
  }, [auto, stepSec, fetchOnce]);

  return (
    <div>
      {/* Header/meta removed on purpose */}
      <ClassicCandleChart candles={candles} height={height} dark={dark} />
    </div>
  );
}
