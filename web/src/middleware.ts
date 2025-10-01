// src/middleware.ts
import { NextRequest, NextResponse } from "next/server";

function makeNonce() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const nonce = makeNonce();

  // expose nonce to the app via a header
  res.headers.set("x-nonce", nonce);

  const isProd = process.env.NODE_ENV === "production";

  // CSP bits
  const scriptSrc = isProd
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' https://secure.walletconnect.org https://verify.walletconnect.com`
    : `'self' 'unsafe-inline' 'unsafe-eval'`;
  const styleSrc = `'self' 'unsafe-inline' https://fonts.googleapis.com`;
  const styleSrcEl = styleSrc;
  const imgSrc = `'self' data: blob: https:`;
  const fontSrc = `'self' https://fonts.gstatic.com data:`;
  const frameSrc = `'self' https://secure.walletconnect.org https://verify.walletconnect.com`;

  const connectList = [
    `'self'`,
    "https:",
    "wss:",
    process.env.NEXT_PUBLIC_BSC_HTTP_1 || "",
    process.env.NEXT_PUBLIC_BSC_HTTP_2 || "",
    process.env.NEXT_PUBLIC_BSC_HTTP_3 || "",
    process.env.NEXT_PUBLIC_BSC_HTTP_4 || "",
    process.env.NEXT_PUBLIC_BSC_HTTP_5 || "",
    process.env.NEXT_PUBLIC_BASE_HTTP || "",
  ]
    .filter(Boolean)
    .join(" ");

  const csp = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `style-src-elem ${styleSrcEl}`,
    `img-src ${imgSrc}`,
    `font-src ${fontSrc}`,
    `connect-src ${connectList}`,
    `frame-src ${frameSrc}`,
  ].join("; ");

  // Security headers (COOP updated for Coinbase Smart Wallet)
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set(
    "Permissions-Policy",
    "geolocation=(), camera=(), microphone=(), payment=()"
  );
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups"); // ← changed
  res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  res.headers.set("Origin-Agent-Cluster", "?1");
  res.headers.set("X-DNS-Prefetch-Control", "off");

  return res;
}

// Don’t apply CSP to static assets
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
