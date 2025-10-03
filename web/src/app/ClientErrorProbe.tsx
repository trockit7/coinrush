"use client";

import * as React from "react";

export default function ClientErrorProbe() {
  React.useEffect(() => {
    // Pretty-print any top-level error
    const onError = (event: ErrorEvent) => {
      const msg = event?.message || "Unknown error";
      const src = event?.filename ? ` @ ${event.filename}:${event.lineno || 0}:${event.colno || 0}` : "";
      // eslint-disable-next-line no-console
      console.error("[CRASH] window.onerror:", msg + src, event?.error || event);
      // ship to server logs (best-effort)
      try {
        fetch("/api/_client-log", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "onerror",
            message: msg,
            filename: event?.filename,
            lineno: event?.lineno,
            colno: event?.colno,
            stack: event?.error?.stack || String(event?.error || ""),
            ua: navigator.userAgent,
            path: location.href,
          }),
          keepalive: true,
          cache: "no-store",
        }).catch(() => {});
      } catch {}
    };

    // Many libs reject with plain objects → this shows *exact* reason
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      // eslint-disable-next-line no-console
      console.error("[CRASH] unhandledrejection:", event?.reason);
      try {
        const reason = event?.reason;
        fetch("/api/_client-log", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "unhandledrejection",
            message: (reason?.message || reason?.toString?.() || String(reason)),
            stack: reason?.stack || "",
            reason,
            ua: navigator.userAgent,
            path: location.href,
          }),
          keepalive: true,
          cache: "no-store",
        }).catch(() => {});
      } catch {}
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
