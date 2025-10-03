// src/app/token-lite/layout.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0; // primitive number (or use: false)
export const fetchCache = "force-no-store";  // extra guard

import React from "react";

export default function TokenLiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // no server fetches here
  return <>{children}</>;