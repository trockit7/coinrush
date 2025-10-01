"use client";

import * as React from "react";

export function useBnbUsd(pollMs = 15_000) {
  const [usd, setUsd] = React.useState<number | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (startedRef.current) return; // strict-mode guard
    startedRef.current = true;

    let aborted = false;

    const tick = async () => {
      try {
        const r = await fetch("/api/price/bnb", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (!aborted && typeof j.usdPerBnb === "number") setUsd(j.usdPerBnb);
      } catch {}
      if (!aborted) timerRef.current = setTimeout(tick, pollMs);
    };

    tick();

    const onVisibility = () => {
      const d: any = typeof document !== "undefined" ? document : null;
      if (!d) return;
      if (d.visibilityState === "visible") {
        if (!timerRef.current) tick();
      } else {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      aborted = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [pollMs]);

  return usd;
}
