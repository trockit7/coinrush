"use client";
import * as React from "react";
import { getOnboard } from "@/lib/wallet/onboard";

export default function OnboardProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    getOnboard(); // init once
  }, []);
  return <>{children}</>;
}