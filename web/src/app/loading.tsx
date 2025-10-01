// src/app/loading.tsx
export default function Loading() {
    return (
      <main style={{ maxWidth: 1120, margin: "32px auto", padding: 16, color: "#8aa6c2" }}>
        <div style={{ height: 56, borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(0,255,255,0.08)" }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
          <div style={{ height: 320, borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(0,255,255,0.08)" }} />
          <div style={{ height: 320, borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(0,255,255,0.08)" }} />
        </div>
        <div style={{ height: 220, borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(0,255,255,0.08)", marginTop: 16 }} />
        <div style={{ height: 220, borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(0,255,255,0.08)", marginTop: 16 }} />
      </main>
    );
  }
  