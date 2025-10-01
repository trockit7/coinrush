"use client";

import React from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  LineStyle,
  PriceScaleMode,
  UTCTimestamp,
} from "lightweight-charts";

/** Candle shape you pass in (from buildCandles) */
export type Candle = {
  time: number | string;     // ignored for spacing; we build index time
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
};

type Props = {
  candles: Candle[];          // pass buildCandles(trades)
  height?: number;
  dark?: boolean;
  /** show candlesticks only when at least this many rows exist */
  minCandlesForBars?: number;
  /** synthetic spacing (seconds per bar) */
  stepSec?: number;
  /** console logging */
  debug?: boolean;
};

const EPS = 1e-18;

function toNum(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string") {
    const v = Number(x.trim());
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

function sanitizeOHLC(input: Candle[], debug = false) {
  const out: { open: number; high: number; low: number; close: number }[] = [];

  for (const c of input || []) {
    // tolerate missing O/H/L — if close exists, build a “flat” candle
    let cl = toNum(c?.close);
    if (cl == null) continue; // must have close
    cl = Math.max(EPS, cl);

    let o = toNum(c?.open);
    let h = toNum(c?.high);
    let l = toNum(c?.low);

    if (o == null) o = cl;
    if (h == null) h = Math.max(cl, o);
    if (l == null) l = Math.min(cl, o);

    o = Math.max(EPS, o);
    h = Math.max(EPS, h);
    l = Math.max(EPS, l);
    if (l > h) [l, h] = [h, l];

    out.push({ open: o, high: h, low: l, close: cl });
  }

  if (debug) {
    console.log("[PumpChart] sanitizeOHLC", {
      in: input?.length || 0,
      kept: out.length,
      sampleIn: (input || []).slice(0, 3),
      sampleOut: out.slice(0, 3),
    });
  }
  return out;
}

/** Map N rows to a strictly increasing time grid (even spacing). */
function withIndexTime<T extends { close: number }>(rows: T[], stepSec: number) {
  const n = rows.length;
  if (n === 0) return [] as (T & { time: UTCTimestamp })[];
  const now = Math.floor(Date.now() / 1000);
  const start = now - (n - 1) * stepSec;

  const out: (T & { time: UTCTimestamp })[] = [];
  for (let i = 0; i < n; i++) out.push({ ...(rows[i] as any), time: (start + i * stepSec) as UTCTimestamp });
  return out;
}

function toArea(rows: { time: UTCTimestamp; close: number }[]) {
  return rows.map((r) => ({ time: r.time, value: Math.max(EPS, r.close) }));
}

export default function PumpStyleChart({
  candles,
  height = 300,
  dark = true,
  minCandlesForBars = 10,
  stepSec = 60,
  debug = false,
}: Props) {
  const holderRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const candleSeriesRef = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const areaSeriesRef = React.useRef<ISeriesApi<"Area"> | null>(null);
  const [empty, setEmpty] = React.useState(false);

  // expose a debug hook
  React.useEffect(() => {
    if (debug) (window as any).__PUMP_CHART__ = { raw: candles };
  }, [candles, debug]);

  // build chart once
  React.useEffect(() => {
    if (!holderRef.current) return;

    try { chartRef.current?.remove(); } catch {}
    chartRef.current = null;

    const bg = dark ? "#0b0f15" : "#ffffff";
    const text = dark ? "#cbd5e1" : "#111827";
    const grid = dark ? "#1f2937" : "#e5e7eb";

    const chart = createChart(holderRef.current, {
      height,
      layout: { background: { type: ColorType.Solid, color: bg }, textColor: text },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.16 },
        mode: PriceScaleMode.Normal,
      },
      timeScale: {
        rightOffset: 4,
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true,
      },
      grid: {
        vertLines: { color: grid, style: LineStyle.Solid },
        horzLines: { color: grid, style: LineStyle.Solid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true },
    });

    // high precision so tiny BNB-per-token prices don't collapse to 0.00
    const commonPriceFormat = { type: "price" as const, precision: 12, minMove: 1e-12 };

    const candle = chart.addCandlestickSeries({
      upColor: "#16a34a",
      downColor: "#ef4444",
      borderUpColor: "#16a34a",
      borderDownColor: "#ef4444",
      wickUpColor: "#16a34a",
      wickDownColor: "#ef4444",
      priceLineVisible: false,
      priceFormat: commonPriceFormat,
    });

    const area = chart.addAreaSeries({
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      topColor: "rgba(34,197,94,0.35)",
      bottomColor: "rgba(34,197,94,0.00)",
      lineColor: "#22c55e",
      priceFormat: commonPriceFormat,
    });

    candle.applyOptions({ visible: false });
    area.applyOptions({ visible: false });

    chartRef.current = chart;
    candleSeriesRef.current = candle;
    areaSeriesRef.current = area;

    const onResize = () => {
      if (!holderRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: holderRef.current.clientWidth });
      chartRef.current.timeScale().fitContent();
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      try { chart.remove(); } catch {}
    };
  }, [height, dark]);

  // feed data
  React.useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !areaSeriesRef.current) return;

    const ohlc = sanitizeOHLC(candles || [], debug);
    const n = ohlc.length;

    if (n === 0) {
      // last resort: try closes-only from raw input
      const closes = (candles || [])
        .map((c) => toNum(c?.close))
        .filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
        .map((v) => ({ close: Math.max(EPS, v) }));
      if (debug) console.log("[PumpChart] closes-only fallback", { in: candles?.length || 0, kept: closes.length });

      if (closes.length === 0) {
        candleSeriesRef.current.applyOptions({ visible: false });
        areaSeriesRef.current.applyOptions({ visible: true });
        areaSeriesRef.current.setData([]);
        setEmpty(true);
        return;
      }

      const rows = withIndexTime(closes, stepSec);
      candleSeriesRef.current.applyOptions({ visible: false });
      areaSeriesRef.current.applyOptions({ visible: true });
      areaSeriesRef.current.setData(toArea(rows) as any);
      setEmpty(false);
      chartRef.current.timeScale().fitContent();
      return;
    }

    // normal path
    const rows = withIndexTime(ohlc, stepSec);

    if (n >= minCandlesForBars) {
      candleSeriesRef.current.setData(rows as any);
      candleSeriesRef.current.applyOptions({ visible: true });
      areaSeriesRef.current.applyOptions({ visible: false });
    } else {
      areaSeriesRef.current.setData(toArea(rows) as any);
      areaSeriesRef.current.applyOptions({ visible: true });
      candleSeriesRef.current.applyOptions({ visible: false });
    }

    setEmpty(false);
    chartRef.current.timeScale().fitContent();
  }, [candles, minCandlesForBars, stepSec, debug]);

  return (
    <div style={{ position: "relative", width: "100%", height }}>
      <div ref={holderRef} style={{ width: "100%", height: "100%" }} />
      {/* overlay when truly empty */}
      {empty && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: dark ? "#94a3b8" : "#6b7280",
            fontSize: 13,
          }}
        >
          No chart data yet
        </div>
      )}
    </div>
  );
}
