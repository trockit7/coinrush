// src/components/wallet/GuardedActionButton.tsx
"use client";

import React from "react";
import { useConnectWallet } from "@web3-onboard/react";

type Props = {
  onRun: () => Promise<void> | void; // your async action
  children: React.ReactNode;         // button label / content
  disabled?: boolean;
  className?: string;
};

export default function GuardedActionButton({ onRun, children, disabled, className }: Props) {
  const [{ wallet, connecting }, connect] = useConnectWallet();
  const isConnected = !!wallet;

  const handleClick = async () => {
    if (!isConnected) {
      if (!connecting) await connect();
      return;
    }
    await onRun();
  };

  return (
    <button onClick={handleClick} disabled={disabled || connecting} className={className}>
      {connecting ? "Connecting…" : children}
    </button>
  );
}

