// src/components/MinimalWalletButtonStandalone.tsx
"use client";

// Ensure Web3Modal init runs for its side-effect (client only)

import * as React from "react";
import { isW3MReady } from "@/app/providers/w3m-ready";

/**
 * We render a stable placeholder on the server and on the very first client render.
 * After mount (useEffect), we flip to "ready" once init is confirmed.
 * This keeps server HTML identical to the client's initial paint, avoiding hydration mismatch.
 */

// Isolated inner button that actually uses the hooks.
// We keep the hook usage inside this component so the outer shell can gate when it mounts.
function InnerWalletButton() {
  // Import here so hooks are only evaluated once we choose to render this component
  const { useAccount } = require("wagmi");

  const { isConnected, address } = useAccount();

  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Connect Wallet";

  return (
    <button
      type="button"
      onClick={() => open()}
      style={{
        padding: "10px 14px",
        borderRadius: 14,
        border: "1px solid rgba(0,255,255,0.28)",
        background: "linear-gradient(180deg, rgba(12,19,27,0.85), rgba(9,14,21,0.85))",
        color: "#e7faff",
        fontWeight: 700,
        cursor: "pointer",
      }}
      aria-label={isConnected ? `Wallet ${short}` : "Connect Wallet"}
    >
      {isConnected ? short : "Connect Wallet"}
    </button>
  );
}

export function MinimalWalletButtonStandalone() {
  // IMPORTANT: Start false so SSR and first client render output IDENTICAL HTML ("Initializing…")
  const [ready, setReady] = React.useState(false);

  // After mount, check readiness and then flip to the real button.
  React.useEffect(() => {
    // Fast path
    if (isW3MReady()) {
      setReady(true);
      return;
    }
    // Tiny poll to cover slow chunk/async init
    let tries = 0;
    const id = setInterval(() => {
      if (isW3MReady() || tries++ > 40) {
        setReady(true);
        clearInterval(id);
      }
    }, 25); // ~1s max
    return () => clearInterval(id);
  }, []);

  if (!ready) {
    // Render a stable placeholder that matches SSR exactly to avoid hydration mismatch.
    // Note: suppressHydrationWarning guards any micro-diffs in whitespace if they occur.
    return (
      <button
        type="button"
        disabled
        style={{
          padding: "10px 14px",
          borderRadius: 14,
          border: "1px solid rgba(0,255,255,0.12)",
          background: "linear-gradient(180deg, rgba(12,19,27,0.45), rgba(9,14,21,0.45))",
          color: "rgba(231,250,255,0.6)",
          fontWeight: 700,
          cursor: "not-allowed",
        }}
        aria-label="Initializing wallet"
      >
        <span suppressHydrationWarning>Initializing…</span>
      </button>
    );
  }

  return <InnerWalletButton />;
}

export default MinimalWalletButtonStandalone;
