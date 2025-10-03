// src/app/token-lite/[pool]/layout.tsx

// server layout for the dynamic segment too
export const dynamic = "force-dynamic";
export const revalidate = 0;            // or: false
export const fetchCache = "force-no-store";

export default function TokenLitePoolLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
