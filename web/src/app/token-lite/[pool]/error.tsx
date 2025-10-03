"use client";

import * as React from "react";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Surface the real error to the browser console in prod
  React.useEffect(() => {
    // Log both the error and digest so you can correlate with server logs
    console.error("token-lite/[pool] error:", error, { digest: error?.digest });
  }, [error]);

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 8 }}>Something went wrong on this page.</h2>
      <div style={{ opacity: 0.8, marginBottom: 16 }}>
        Check the browser console for the full error (we printed it there).
        {error?.digest ? (
          <>
            {" "}Digest: <code>{error.digest}</code>
          </>
        ) : null}
      </div>
      <button
        onClick={() => reset()}
        style={{
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.2)",
          background: "rgba(255,255,255,0.06)",
          cursor: "pointer"
        }}
      >
        Try again
      </button>
    </div>
  );
}
