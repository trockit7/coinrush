// src/components/wallet/CompactWalletButton.tsx
"use client";

import React from "react";
import { useConnectWallet } from "@web3-onboard/react";

export default function CompactWalletButton({ className }: { className?: string }) {
  const [{ wallet, connecting }, connect, disconnect] = useConnectWallet();
  const [mounted, setMounted] = React.useState(false);
  const [showMenu, setShowMenu] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const address = wallet?.accounts?.[0]?.address || "";
  const isConnected = !!wallet;

  // Persist last address (same behavior you had)
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (isConnected && address) localStorage.setItem("cr:lastAddress", address);
    else localStorage.removeItem("cr:lastAddress");
  }, [isConnected, address]);

  const short = (a: string) => (a ? `…${a.slice(-6)}` : "");
  const label =
    mounted && isConnected && address ? short(address) : connecting ? "Connecting…" : "Connect Wallet";

  // Close the small menu when clicking outside
  React.useEffect(() => {
    if (!showMenu) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (!t.closest?.("[data-compact-wallet]")) setShowMenu(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [showMenu]);

  return (
    <span
      data-compact-wallet
      style={{ position: "relative", display: "inline-block", minWidth: 120 }}
    >
      {/* Visible pill */}
      <button
        type="button"
        className={className}
        title={isConnected && address ? address : "Connect wallet"}
        onClick={async () => {
          if (!isConnected) {
            const res = await connect();
            if (!res || !res[0]) return; // user closed
          } else {
            // Toggle small popover menu
            setShowMenu((s) => !s);
          }
        }}
      >
        {label}
      </button>

      {/* Tiny popover when connected */}
      {isConnected && showMenu && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 180,
            borderRadius: 10,
            border: "1px solid rgba(0,255,255,0.25)",
            background:
              "linear-gradient(180deg, rgba(12,19,27,0.95), rgba(9,14,21,0.95))",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(0,255,255,0.08)",
            padding: 8,
            zIndex: 40,
          }}
        >
          <div
            style={{
              fontSize: 12,
              opacity: 0.9,
              color: "#9ccbf3",
              marginBottom: 6,
              wordBreak: "break-all",
            }}
            title={address}
          >
            {address}
          </div>

          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address);
              } catch {}
              setShowMenu(false);
            }}
            style={itemStyle}
          >
            Copy address
          </button>

          <button
            type="button"
            onClick={async () => {
              try {
                await disconnect(wallet);
              } catch {}
              setShowMenu(false);
            }}
            style={itemStyle}
          >
            Disconnect
          </button>
        </div>
      )}
    </span>
  );
}

const itemStyle: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(0,255,255,0.12)",
  background: "rgba(0,0,0,0.15)",
  color: "#d8ecff",
  cursor: "pointer",
  marginBottom: 6,
};
