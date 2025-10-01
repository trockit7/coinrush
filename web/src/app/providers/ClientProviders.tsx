"use client";

import React from "react";
import { Web3OnboardProvider } from "@web3-onboard/react";
import onboard from "@/lib/wallet/onboard"; // <-- import the instance created at module load

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return <Web3OnboardProvider web3Onboard={onboard}>{children}</Web3OnboardProvider>;
}
