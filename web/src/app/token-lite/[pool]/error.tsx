"use client";

import * as React from "react";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Log everything — you’ll see the real stack in the browser console
  React.useEffect(() => {
    // next hides details in prod; we log them here
    // eslint-disable-next-line no-console
    console.error("[token-lite/[pool]/error] digest:", error?.digest, "full:", error);
  }, [error]);

  return (
    <main style={{
      maxWidth: 960, margin: "40px auto", padding: 16,
      color: "#d8ecff",
      background: "linear-gradient(180deg, #0b1018, #0e1622)",
      borderRadius: 12, border: "1px solid rgba(0,220,255,0.18)"
    }}>
      <h1 style={{marginTop:0}}>Something broke on this token page</h1>
      <p>We captured the full error in your browser console for debugging.</p>

      <div style={{
        marginTop: 12, padding: 12, borderRadius: 8,
        background: "rgba(255,100,100,0.08)",
        border: "1px solid rgba(255,100,100,0.25)", color: "#ffcaca"
      }}>
        <div style={{fontWeight:700}}>Digest:</div>
        <code>{String(error?.digest ?? "n/a")}</code>
      </div>

      <details style={{marginTop:12}}>
        <summary>Show message</summary>
        <pre style={{whiteSpace:"pre-wrap"}}>{String(error?.message ?? "n/a")}</pre>
      </details>

      <button
        onClick={() => reset()}
        style={{
          marginTop: 14, padding: "8px 12px", borderRadius: 10,
          border: "1px solid rgba(0,255,255,0.28)",
          background: "linear-gradient(180deg, rgba(12,19,27,0.85), rgba(9,14,21,0.85))",
          color: "#e7faff", fontWeight: 700, cursor: "pointer"
        }}
      >
        Try again
      </button>
    </main>
  );
}
