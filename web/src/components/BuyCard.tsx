// src/components/BuyCard.tsx
"use client";

import React from "react";
import { useConnectWallet } from "@web3-onboard/react";

type Props = {
  onBuy: () => Promise<void>; // your existing buy handler
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
  title?: string;
};

export default function BuyCard({ onBuy, disabled, children, className, title }: Props) {
  // Onboard connection state + connect action
  const [{ wallet }, connect] = useConnectWallet();
  const isConnected = !!wallet;

  return (
    <button
      className={className}
      title={title}
      disabled={disabled}
      onClick={async () => {
        try {
          if (!isConnected) {
            const res = await connect();
            // If user closed modal or no wallet connected, stop here
            if (!res || !res[0]) return;
          }
          await onBuy();
        } catch (e) {
          // keep silent; your onBuy already handles errors/UX
          console.debug("BuyCard click error:", e);
        }
      }}
    >
      {children ?? "Buy"}
    </button>
  );
}
