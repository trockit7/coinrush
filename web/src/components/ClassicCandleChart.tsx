"use client";

import React from "react";

function patchUserAgentDataForIOS() {
  try {
    // iOS (incl. Chrome on iOS) lacks navigator.userAgentData
    const nav: any = typeof navigator !== "undefined" ? navigator : undefined;
    if (!nav) return;
    if (!("userAgentData" in nav)) {
      // Define a minimal, harmless stub so libraries that do `.brands.some(...)` don't crash
      Object.defineProperty(nav, "userAgentData", {
        value: { brands: [], mobile: /Mobi|iP(hone|od|ad)/i.test(nav.userAgent), platform: nav.platform || "" },
        configurable: true,
      });
    } else if (!Array.isArray((nav as any).userAgentData?.brands)) {
      try { (nav as any).userAgentData.brands = []; } catch {}
    }
  } catch {
    // ignore — if we can't patch, we'll still handle with a fallback render
  }
}

async function safeImportLightweightCharts() {
  patchUserAgentDataForIOS();
  // Now try to import the lib
  return await import("lightweight-charts");
}

/** Accepts data from your buildCandles(trades) (time in *seconds*). */
export type CandlePoint = {
  time: number;    // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
};

export default function ClassicCandleChart({
  candles,
  height = 300,
  dark = false,
}: {
  candles: CandlePoint[];
  height?: number;
  dark?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<any>(null);
  const seriesRef = React.useRef<any>(null);

  // mount: create chart client-side
  React.useEffect(() => {
    if (!ref.current) return;
    let disposed = false;
    let resizeObs: ResizeObserver | undefined;

    (async () => {
      // ✅ import ColorType too
      const { createChart, CrosshairMode, ColorType } = await safeImportLightweightCharts();
      if (disposed || !ref.current) return;

      const bg = dark ? "#0b0f17" : "#ffffff";
      const fg = dark ? "#cbd5e1" : "#0f172a";
      const grid = dark ? "#1f2937" : "#e5e7eb";

      const chart = createChart(ref.current, {
        height,
        layout: {
          background: { type: ColorType.Solid, color: bg }, // ✅ use enum, not string
          textColor: fg,
        },
        grid: { vertLines: { color: grid }, horzLines: { color: grid } },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderVisible: false },
        timeScale: {
          borderVisible: false,
          timeVisible: true,
          secondsVisible: true,
          rightOffset: 2,
          barSpacing: 7,                    // narrower look
          lockVisibleTimeRangeOnResize: true,
        },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
      });

      const series = chart.addCandlestickSeries({
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderVisible: false,
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
        priceFormat: { type: "price", precision: 9, minMove: 1e-9 }, // tiny prices supported
      });

      chartRef.current = chart;
      seriesRef.current = series;

      // initial data
      const data = (candles ?? [])
        .filter(c => Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close))
        .map(c => ({ time: c.time as any, open: c.open, high: c.high, low: c.low, close: c.close }));

      series.setData(data);
      chart.timeScale().fitContent();

      // responsive
      resizeObs = new ResizeObserver(() => {
        if (!ref.current) return;
        chart.applyOptions({ width: ref.current.clientWidth, height });
        chart.timeScale().fitContent();
      });
      resizeObs.observe(ref.current);
    })();

    return () => {
      disposed = true;
      try {
        if (resizeObs && ref.current) resizeObs.unobserve(ref.current);
      } catch {}
      try {
        chartRef.current?.remove();
      } catch {}
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [dark, height]);

  // update on data change
  React.useEffect(() => {
    const s = seriesRef.current;
    const ch = chartRef.current;
    if (!s || !ch) return;

    const data = (candles ?? [])
      .filter(c => Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close))
      .map(c => ({ time: c.time as any, open: c.open, high: c.high, low: c.low, close: c.close }));

    s.setData(data);
    ch.timeScale().fitContent();
  }, [candles]);

  return <div ref={ref} style={{ width: "100%", height }} />;
}
