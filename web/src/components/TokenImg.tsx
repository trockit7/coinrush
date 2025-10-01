"use client";
import React from "react";

export default function TokenImg({ src, alt, size = 44 }: { src?: string; alt: string; size?: number }) {
  const FALLBACK =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>
        <rect width='100%' height='100%' fill='#f3f4f6'/>
        <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle'
              font-size='${Math.max(10, Math.floor(size/4))}' fill='#9ca3af'>TOKEN</text>
      </svg>`
    );

  return (
    <img
      src={src || "/token-placeholder.png"}
      alt={alt}
      width={size}
      height={size}
      style={{ borderRadius: 8, objectFit: "cover", background: "#f3f4f6" }}
      onError={(e) => {
        const el = e.currentTarget as HTMLImageElement;
        el.onerror = null;
        // try local placeholder first; if that's not available, inline fallback
        el.src = "/token-placeholder.png";
        setTimeout(() => { if (el.naturalWidth === 0) el.src = FALLBACK; }, 0);
      }}
    />
  );
}
