// components/LoadingStripe.tsx
import React from "react";

export function LoadingStripe({ height = 6, radius = 8, label }: { height?: number; radius?: number; label?: string }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {label ? <div style={{ color:"#8aa6c2", fontSize:12 }}>{label}</div> : null}
      <div
        role="progressbar"
        aria-label={label || "Loading"}
        style={{
          height,
          borderRadius: radius,
          background:
            "linear-gradient(90deg, rgba(0,220,255,0.15) 25%, rgba(0,220,255,0.45) 50%, rgba(0,220,255,0.15) 75%)",
          backgroundSize: "200% 100%",
          boxShadow: "0 0 0 1px rgba(0,220,255,0.18) inset, 0 0 24px -10px rgba(0,240,255,0.55)",
          animation: "cr-stripe 1.15s linear infinite",
        }}
      />
      <style>{`
        @keyframes cr-stripe {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
