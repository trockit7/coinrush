// src/app/token-lite/[pool]/layout.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0; // or: false

import React from "react";

export default function TokenLitePoolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // keep it empty; just enforces segment options at the dynamic level
  return <>{children}</>;
}