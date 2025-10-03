// src/app/token-lite/layout.tsx

// This layout applies ONLY to routes under /token-lite/*
// and forces a valid (primitive) revalidate value.

export const revalidate = 0;                 // ✅ primitive (number) — no cache
export const dynamic = "force-dynamic";      // read at request time
export const fetchCache = "force-no-store";  // don't cache fetches

export default function TokenLiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
