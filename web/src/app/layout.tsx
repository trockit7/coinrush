// web/src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import React from "react";
import { headers } from "next/headers";
import Script from "next/script";

import ClientProviders from "./providers/ClientProviders";
import ClientErrorProbe from "./ClientErrorProbe"; // ✅ add

export const metadata: Metadata = {
  title: "Coinrush",
  description: "Coinrush dApp",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = headers().get("x-nonce") || undefined;

  return (
    <html lang="en" style={{ background: "#070b11" }} suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="dark only" />
        <meta name="theme-color" content="#070b11" />
        <style id="cr-anti-fouc">{`
          :root, html, body { background:#070b11; color-scheme: dark; }
          html, body { margin:0; min-height:100%; }
        `}</style>
        <Script id="app-init" nonce={nonce} strategy="beforeInteractive">
          {`window.__APP_ENV__ = "${process.env.NODE_ENV}";`}
        </Script>
      </head>
      <body style={{ background: "#070b11", margin: 0 }}>
        <ClientProviders>{children}</ClientProviders>
        <ClientErrorProbe /> {/* ✅ mounts global error listener */}
      </body>
    </html>
  );
}
