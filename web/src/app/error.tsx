// src/app/error.tsx – applies to the root segment
"use client";
import * as React from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }, reset: () => void }) {
  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[RENDER ERROR]", error);
    fetch("/api/_client-log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "render", message: error.message, stack: error.stack, digest: error.digest }),
      keepalive: true,
      cache: "no-store",
    }).catch(() => {});
  }, [error]);

  return (
    <html>
      <body style={{ fontFamily: "system-ui", padding: 24 }}>
        <h2>Something went wrong</h2>
        <p style={{ opacity: 0.7 }}>{error?.message}</p>
        <button onClick={() => reset()} style={{ padding: "8px 12px", borderRadius: 8, cursor: "pointer" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
