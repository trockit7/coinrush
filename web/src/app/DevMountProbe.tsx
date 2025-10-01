"use client";
import React from "react";

export default function DevMountProbe({ note }: { note?: string }) {
  React.useEffect(() => {
    console.log("[DevMountProbe] mounted", note ?? "");
  }, [note]);

  return (
    <div
      style={{
        position: "fixed",
        inset: "10px auto auto 10px",
        zIndex: 99999,
        background: "rgba(0,0,0,0.4)",
        color: "#0f0",
        padding: "4px 8px",
        borderRadius: 6,
        fontSize: 12,
      }}
    >
      • probe {note ? `(${note})` : ""}
    </div>
  );
}
