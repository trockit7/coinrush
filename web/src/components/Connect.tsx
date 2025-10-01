// src/components/Connect.tsx
"use client";

import React from "react";
import { useConnectWallet } from "@web3-onboard/react";

export default function Connect() {
  const [{ wallet, connecting }, connect, disconnect] = useConnectWallet();

  const isConnected = !!wallet;
  const addr = wallet?.accounts?.[0]?.address || "";

  const short = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

  return (
    <div style={{ display: "inline-flex", gap: 8 }}>
      <button
        type="button"
        onClick={async () => {
          if (!isConnected) {
            const res = await connect();
            if (!res || !res[0]) return; // user closed or no wallet
          } else {
            await disconnect(wallet);
          }
        }}
        disabled={connecting}
        title={isConnected ? addr : "Connect wallet"}
        style={{
          padding: "8px 12px",
          borderRadius: 10,
          border: "1px solid rgba(0,255,255,0.25)",
          background:
            "linear-gradient(180deg, rgba(12,19,27,0.7), rgba(9,14,21,0.7))",
          color: "#d8ecff",
          cursor: "pointer",
        }}
      >
        {connecting
          ? "Connecting…"
          : isConnected
          ? short(addr)
          : "Connect Wallet"}
      </button>
    </div>
  );
}
