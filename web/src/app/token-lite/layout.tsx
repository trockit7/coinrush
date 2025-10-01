// src/app/token-lite/layout.tsx

// Keep this layout minimal; the root layout already imports globals.css
// and wraps the app with Web3Modal/Wagmi/QueryClient providers.

export default function TokenLiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}