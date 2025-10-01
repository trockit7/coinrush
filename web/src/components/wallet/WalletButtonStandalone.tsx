"use client";

// Side-effect init (single source of truth)
import "@/app/providers/web3modal-init";

import * as React from "react";
import { WalletButton } from "./WalletButton";

/**
 * Standalone wrapper that used to spin up its own Wagmi/Web3Modal.
 * We remove all local initialization to avoid duplicates and weird Auth UI.
 * It now just renders the same WalletButton used on Home.
 */
export function WalletButtonStandalone() {
  return <WalletButton />;
}

export default WalletButtonStandalone;
