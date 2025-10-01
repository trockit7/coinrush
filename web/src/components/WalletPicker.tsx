// src/components/WalletPicker.tsx
"use client";
import React from "react";
import { useConnectWallet } from "@web3-onboard/react";

function short(addr?: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}

export default function WalletPicker() {
  const [{ wallet, connecting }, connect, disconnect] = useConnectWallet();
  const isConnected = !!wallet;
  const address = wallet?.accounts?.[0]?.address || "";

  return (
    <div style={{ display: "inline-flex", gap: 8 }}>
      {!isConnected ? (
        <button
          type="button"
          onClick={async () => { if (!connecting) await connect(); }}
          disabled={connecting}
          className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15"
          aria-label="Connect wallet"
        >
          {connecting ? "Connecting…" : "Connect Wallet"}
        </button>
      ) : (
        <>
          <span
            className="px-3 py-2 rounded-lg bg-white/5"
            title={address}
            aria-label="Connected address"
          >
            {short(address)}
          </span>
          <button
            type="button"
            onClick={async () => { if (wallet) await disconnect(wallet); }}
            className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15"
            aria-label="Disconnect wallet"
          >
            Disconnect
          </button>
        </>
      )}
    </div>
  );
}
