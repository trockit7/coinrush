// src/components/PriceLine.tsx
"use client";
import React from "react";
import { Contract } from "ethers";
import { getPublicProvider } from "@/lib/eth";

type Pt = { time: number; value: number };
const nowSec = () => Math.floor(Date.now() / 1000);

// Ethers-friendly minimal ABI (string fragments)
const POOL_ABI_RW = [
  // preferred reader
  "function priceWeiPerToken() view returns (uint256)",
  // fallback readers (if pool lacks priceWeiPerToken)
  "function reserveNative() view returns (uint256)",
  "function reserveToken() view returns (uint256)",
  "function x0() view returns (uint256)",
  "function y0() view returns (uint256)",
] as const;

export default function PriceLine({
  pool,
  chain = 97,
  height = 260,
}: {
  pool: string;
  chain?: number;
  height?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<any>(null);
  const seriesRef = React.useRef<any>(null);
  const key = `price:line:${chain}:${pool.toLowerCase()}`;
  const MAX_POINTS = 20000;

  async function readPrice(): Promise<number | null> {
    try {
      const c = new Contract(pool, POOL_ABI_RW, getPublicProvider(chain)) as any;

      // Try direct price
      try {
        const wei: bigint = await c.priceWeiPerToken();
        if (wei && typeof wei === "bigint") return Number(wei) / 1e18;
      } catch {
        // ignore and try fallback
      }

      // Fallback: (reserveNative + x0) * 1e18 / (reserveToken + y0)
      try {
        const [rN, rT, x0, y0] = await Promise.all([
          c.reserveNative().catch(() => 0n),
          c.reserveToken().catch(() => 0n),
          c.x0().catch(() => 0n),
          c.y0().catch(() => 0n),
        ]);
        const num = (BigInt(rN) + BigInt(x0)) * 10n ** 18n;
        const den = BigInt(rT) + BigInt(y0);
        if (den > 0n) return Number(num / den) / 1e18;
      } catch {
        // ignore
      }

      return null;
    } catch {
      return null;
    }
  }

  function loadLS(): Pt[] {
    try {
      const j = JSON.parse(localStorage.getItem(key) || "null");
      return Array.isArray(j?.data) ? j.data : [];
    } catch {
      return [];
    }
  }
  function saveLS(data: Pt[]) {
    try {
      localStorage.setItem(key, JSON.stringify({ data }));
    } catch {}
  }

  React.useEffect(() => {
    let dead = false;
    let timer: any;

    (async () => {
      if (!ref.current) return;
      const { createChart } = await import("lightweight-charts");
      if (dead) return;

      ref.current.innerHTML = "";
      const chart = createChart(ref.current, {
        height,
        layout: { background: { color: "transparent" } },
        grid: { horzLines: { color: "#eee" }, vertLines: { color: "#eee" } },
        timeScale: { timeVisible: true, secondsVisible: true },
      });
      const series = chart.addLineSeries({ lineWidth: 2 });
      chartRef.current = chart;
      seriesRef.current = series;

      const data: Pt[] = loadLS();
      if (data.length) {
        series.setData(data as any);
        chart.timeScale().fitContent();
      }

      async function tick() {
        const p = await readPrice();
        if (p != null) {
          const t = nowSec();
          const last = data[data.length - 1];
          if (!last || t > last.time) data.push({ time: t, value: p });
          else data[data.length - 1] = { time: t, value: p };
          if (data.length > MAX_POINTS) data.splice(0, data.length - MAX_POINTS);
          series.setData(data as any);
          saveLS(data);
        }
        timer = setTimeout(tick, 10000);
      }
      await tick();
    })();

    return () => {
      dead = true;
      try {
        clearTimeout(timer);
      } catch {}
      try {
        chartRef.current?.remove();
      } catch {}
      chartRef.current = null;
      seriesRef.current = null;
      if (ref.current) ref.current.innerHTML = "";
    };
  }, [pool, chain, height]);

  return <div ref={ref} />;
}
