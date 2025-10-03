"use client";

import * as React from "react";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[token-lite/error] digest:", error?.digest, "full:", error);
  }, [error]);

  return (
    <main style={{
      maxWidth: 960, margin: "40px auto", padding: 16,
      color: "#d8ecff",
      background: "linear-gradient(180deg, #0b1018, #0e1622)",
      borderRadius: 12, border: "1px solid rgba(0,220,255,0.18)"
    }}>
      <h1 style={{marginTop:0}}>Token route failed</h1>
      <p>Open DevTools → Console to see the full stack trace.</p>
      <div style={{marginTop: 8}}>Digest: <code>{String(error?.digest ?? "n/a")}</code></div>
      <button
        onClick={() => reset()}
        style={{
          marginTop: 14, padding: "8px 12px", borderRadius: 10,
          border: "1px solid rgba(0,255,255,0.28)",
          background: "linear-gradient(180deg, rgba(12,19,27,0.85), rgba(9,14,21,0.85))",
          color: "#e7faff", fontWeight: 700, cursor: "pointer"
        }}
      >
        Retry
      </button>
    </main>
  );
}
