// src/components/wallet/ConnectOrDisconnect.tsx
"use client";

import React from "react";
import { useConnectWallet } from "@web3-onboard/react";

function short(addr?: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}

export default function ConnectOrDisconnect() {
  const [{ wallet, connecting }, connect, disconnect] = useConnectWallet();

  const isConnected = !!wallet;
  const address = wallet?.accounts?.[0]?.address || "";

  if (!isConnected) {
    // Opens Onboard's connect modal
    return (
      <button
        onClick={async () => {
          if (!connecting) await connect();
        }}
        className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15"
        aria-label="Connect wallet"
        type="button"
        disabled={connecting}
      >
        {connecting ? "Connecting…" : "Connect Wallet"}
      </button>
    );
  }

  // When connected, show ONLY a Disconnect button
  return (
    <button
      onClick={async () => {
        if (wallet) await disconnect(wallet);
      }}
      className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15"
      title={address}
      aria-label="Disconnect wallet"
      type="button"
    >
      Disconnect {short(address)}
    </button>
  );
}
