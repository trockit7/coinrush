"use client";

import React from "react";

type Props = { pool: string; meta?: any; snapshot?: any };

export default function TokenHeader({ pool, meta, snapshot }: Props) {
  const [name, setName] = React.useState<string>(meta?.name || "");
  const [symbol, setSymbol] = React.useState<string>(meta?.symbol || snapshot?.symbol || "");
  const [imageUrl, setImageUrl] = React.useState<string>("");

  React.useEffect(() => {
    if (meta?.name) setName(meta.name);
    if (meta?.symbol || snapshot?.symbol) setSymbol(meta?.symbol || snapshot?.symbol || "");

    (async () => {
      try {
        const r = await fetch(`/api/tokens/lookup?pool=${pool}`, { cache: "no-store" });
        const j = await r.json();
        if (j?.ok && j.found) {
          if (j.name) setName(j.name);
          if (j.symbol) setSymbol(j.symbol);
          if (j.image_url) setImageUrl(j.image_url);
        }
      } catch {}
    })();
  }, [pool, meta?.name, meta?.symbol, snapshot?.symbol]);

  const displayName = name || "Token";
  const displaySymbol = symbol || "TOKEN";
  const img = imageUrl || "/token-placeholder.png";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
      <img
        src={img}
        alt=""
        width={40}
        height={40}
        style={{ borderRadius: 8, objectFit: "cover", background: "#f3f4f6" }}
      />
      <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.2 }}>
        {displayName} <span style={{ color: "#6b7280", fontWeight: 500 }}>({displaySymbol})</span>
      </h1>
    </div>
  );
}
