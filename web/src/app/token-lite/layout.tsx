// src/app/token-lite/layout.tsx

// server layout just for segment options
export const dynamic = "force-dynamic";
export const revalidate = 0;            // or: false
export const fetchCache = "force-no-store";

import React from "react";

export default function TokenLiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
