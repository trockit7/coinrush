// src/app/me/page.tsx
"use client";

export const dynamic = "force-dynamic" as const;

import * as React from "react";
import { BrowserProvider } from "ethers";

/*────────────────────────────────────────────────────────
  Types
────────────────────────────────────────────────────────*/
type Profile = {
  username?: string;
  avatar_url?: string; // data URL (PNG) sanitized client-side
  twitter?: string;
  telegram?: string;
};

/*────────────────────────────────────────────────────────
  Tiny utils
────────────────────────────────────────────────────────*/
const short = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const same = (a?: string, b?: string) => (a || "").toLowerCase() === (b || "").toLowerCase();

// Use relative URLs for same-origin API routes (robust across hosts)
const api = {
  profileBulk: "/api/profile/bulk",
  profileSave: "/api/profile",
};

/* Neon UI (same feel as your other pages) */
const ui = {
  page: {
    maxWidth: 1120,
    margin: "32px auto 64px",
    padding: 16,
    color: "#d8ecff",
    background:
      "radial-gradient(800px 400px at 10% -10%, rgba(0,255,255,0.08), transparent 60%), radial-gradient(800px 400px at 110% 120%, rgba(0,255,255,0.06), transparent 60%), #070b11",
  } as React.CSSProperties,
  header: {
    wrap: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "12px 14px",
      borderRadius: 14,
      background: "linear-gradient(180deg, rgba(8,14,22,0.65), rgba(9,13,20,0.6))",
      boxShadow: "0 0 0 1px rgba(0,255,255,0.18) inset, 0 0 30px -16px rgba(0,240,255,0.5)",
      marginBottom: 16,
    } as React.CSSProperties,
    brand: {
      fontWeight: 900,
      letterSpacing: 1.2,
      fontSize: 22,
      padding: "6px 12px",
      borderRadius: 12,
      boxShadow: "0 0 0 1px rgba(0,255,255,0.22) inset, 0 0 16px rgba(0,240,255,0.25)",
      background: "linear-gradient(180deg, rgba(12,19,27,0.6), rgba(9,14,21,0.6))",
    } as React.CSSProperties,
    nav: { display: "flex", gap: 18, marginLeft: 12, opacity: 0.92 } as React.CSSProperties,
    navLink: { color: "#d8ecff", textDecoration: "none", borderBottom: "none" } as React.CSSProperties,
    grow: { flex: 1 } as React.CSSProperties,
    btn: {
      padding: "8px 12px",
      borderRadius: 12,
      border: "1px solid rgba(0,255,255,0.28)",
      background: "linear-gradient(180deg, rgba(12,19,27,0.85), rgba(9,14,21,0.85))",
      color: "#e7faff",
      fontWeight: 700,
      textDecoration: "none",
      cursor: "pointer",
    } as React.CSSProperties,
  },
  card: {
    base: {
      background: "linear-gradient(180deg, #0b1018, #0e1622)",
      borderRadius: 14,
      padding: 16,
      position: "relative" as const,
      boxShadow: "0 0 0 1px rgba(0,220,255,0.10) inset, 0 0 30px -12px rgba(0,240,255,0.5)",
    },
    title: { fontWeight: 800, letterSpacing: 0.3, opacity: 0.95, marginBottom: 10, fontSize: 20 },
    smallNote: { fontSize: 12, color: "#8aa6c2", marginTop: 8 },
  },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  dim: { color: "#8aa6c2" },
};

/*────────────────────────────────────────────────────────
  Avatar safety: verify type + strip EXIF + resize to 256 PNG
────────────────────────────────────────────────────────*/
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
const AVATAR_SIZE = 256;

async function sniffMagicBytes(file: File): Promise<"png" | "jpg" | "gif" | "webp" | "unknown"> {
  const buf = await file.slice(0, 16).arrayBuffer();
  const b = new Uint8Array(buf);
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return "unknown";
}

function drawCoverToCanvas(img: HTMLImageElement, size = AVATAR_SIZE): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const side = Math.min(iw, ih);
  const sx = Math.max(0, Math.floor((iw - side) / 2));
  const sy = Math.max(0, Math.floor((ih - side) / 2));
  ctx.fillStyle = "#0e1622";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  return c;
}

async function fileToSafeAvatarDataURL(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error("File too large (max 5MB).");
  if (!ALLOWED_MIME.includes(file.type)) throw new Error("Unsupported type. Use PNG/JPG/WEBP/GIF.");
  const magic = await sniffMagicBytes(file);
  if (magic === "unknown") throw new Error("Not recognized as an image.");

  const blobUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const el = new Image();
      el.onload = () => res(el);
      el.onerror = () => rej(new Error("Unable to load image"));
      el.src = blobUrl;
    });
    const canvas = drawCoverToCanvas(img, AVATAR_SIZE);
    const dataUrl = canvas.toDataURL("image/png");
    if (!dataUrl.startsWith("data:image/png;base64,")) throw new Error("Failed to encode image.");
    return dataUrl;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/*────────────────────────────────────────────────────────
  Fetch helpers (relative URLs + no-store)
────────────────────────────────────────────────────────*/
async function fetchProfile(addr: string): Promise<Profile> {
  try {
    const r = await fetch(api.profileBulk, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ addresses: [addr.toLowerCase()] }),
      cache: "no-store",
    });
    if (!r.ok) return {};
    const j = await r.json();

    if (Array.isArray(j)) {
      const hit = j.find((p: any) => same(p?.address, addr));
      return {
        username: hit?.username || "",
        avatar_url: hit?.avatar_url || "",
        twitter: hit?.twitter || "",
        telegram: hit?.telegram || "",
      };
    }
    return j?.[addr.toLowerCase()] || {};
  } catch (e) {
    // surface to console for debugging env/network issues
    console.error("fetchProfile failed", e);
    return {};
  }
}

async function saveProfileAPI(p: {
  address: string;
  username: string;
  avatar_url: string;
  twitter: string;
  telegram: string;
}) {
  const r = await fetch(api.profileSave, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-addr": p.address,
    },
    cache: "no-store",
    body: JSON.stringify(p),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(t || `Save failed (${r.status})`);
  }
}

/*────────────────────────────────────────────────────────
  Component
────────────────────────────────────────────────────────*/
export default function ProfileEditPage() {
  const [address, setAddress] = React.useState<string>("");
  const [loadingWallet, setLoadingWallet] = React.useState(true);

  const [form, setForm] = React.useState<Profile>({
    username: "",
    avatar_url: "",
    twitter: "",
    telegram: "",
  });
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string>("");

  const [avatarBusy, setAvatarBusy] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);

  // Dev-only unhandled rejection logger to expose "Uncaught (in promise) Object"
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const onUR = (e: PromiseRejectionEvent) => {
      // Many wallets / libs reject with plain objects
      console.error("UNHANDLED PROMISE REJECTION", e.reason);
    };
    window.addEventListener("unhandledrejection", onUR);
    return () => window.removeEventListener("unhandledrejection", onUR);
  }, []);

  // Wallet/address detection (no flicker, no auto-reset)
  React.useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const cached = typeof window !== "undefined" ? localStorage.getItem("cr:lastAddress") : "";
        if (cached) {
          if (!stop) setAddress(cached);
          const p = await fetchProfile(cached);
          if (!stop)
            setForm({
              username: p.username || "",
              avatar_url: p.avatar_url || "",
              twitter: p.twitter || "",
              telegram: p.telegram || "",
            });
          return;
        }
        const eth = (globalThis as any).ethereum;
        if (eth?.request) {
          try {
            const accs: string[] = await eth.request({ method: "eth_accounts" });
            const a = (accs?.[0] || "").toLowerCase();
            if (a) {
              if (!stop) setAddress(a);
              try { localStorage.setItem("cr:lastAddress", a); } catch {}
              const p = await fetchProfile(a);
              if (!stop)
                setForm({
                  username: p.username || "",
                  avatar_url: p.avatar_url || "",
                  twitter: p.twitter || "",
                  telegram: p.telegram || "",
                });
            }
          } catch (e) {
            // Some wallets reject with plain objects
            console.error("eth_accounts failed", e);
          }
        }
      } catch (e) {
        console.error("init effect failed", e);
      } finally {
        if (!stop) setLoadingWallet(false);
      }
    })();
    return () => {
      stop = true;
    };
  }, []);

  async function connectWallet() {
    setError("");
    try {
      const eth = (globalThis as any).ethereum;
      if (!eth) {
        setError("No wallet detected. Install MetaMask or a compatible wallet.");
        return;
      }
      // Some providers throw synchronously if not allowed in this context
      try {
        new BrowserProvider(eth);
      } catch {}
      const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
      const a = (accounts?.[0] || "").toLowerCase();
      if (!a) {
        setError("Wallet connection failed or was rejected.");
        return;
      }
      setAddress(a);
      try { localStorage.setItem("cr:lastAddress", a); } catch {}
      const p = await fetchProfile(a);
      setForm({
        username: p.username || "",
        avatar_url: p.avatar_url || "",
        twitter: p.twitter || "",
        telegram: p.telegram || "",
      });
    } catch (e: any) {
      console.error("connectWallet failed", e);
      setError(e?.message || "Unable to connect wallet.");
    }
  }

  function disconnect() {
    setAddress("");
    setForm({ username: "", avatar_url: "", twitter: "", telegram: "" });
    try { localStorage.removeItem("cr:lastAddress"); } catch {}
  }

  async function handleAvatarFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const f = files[0];
    setAvatarBusy(true);
    setError("");
    try {
      const dataUrl = await fileToSafeAvatarDataURL(f);
      setForm((prev) => ({ ...prev, avatar_url: dataUrl }));
    } catch (e: any) {
      console.error("avatar processing failed", e);
      setError(e?.message || "Invalid image.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function onSave() {
    if (!address) {
      setError("Connect your wallet first.");
      return;
    }
    setSaving(true);
    setError("");
    setSavedAt(null);
    try {
      const payload = {
        address: address.toLowerCase(),
        username: (form.username || "").trim(),
        avatar_url: (form.avatar_url || "").trim(),
        twitter: (form.twitter || "").replace(/^@/, "").trim(),
        telegram: (form.telegram || "").replace(/^@/, "").trim(),
      };
      if (!payload.username) throw new Error("Username is required.");
      await saveProfileAPI(payload);
      setSavedAt(Date.now());
      const p = await fetchProfile(address);
      setForm({
        username: p.username || "",
        avatar_url: p.avatar_url || "",
        twitter: p.twitter || "",
        telegram: p.telegram || "",
      });
    } catch (e: any) {
      console.error("save failed", e);
      setError(e?.message || "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main style={ui.page}>
      {/* Header */}
      <div style={ui.header.wrap}>
        <div style={ui.header.brand}>COINRUSH</div>
        <nav style={ui.header.nav}>
          <a href="/" style={ui.header.navLink}>Home</a>
          <a href="/explore" style={ui.header.navLink}>Explore</a>
          <a href="/create" style={ui.header.navLink}>Create</a>
          <a href="/docs" style={ui.header.navLink}>Docs</a>
        </nav>
        <div style={ui.header.grow} />
        {address ? (
          <a href={`/u/${address}`} style={{ ...ui.header.btn, marginRight: 8 }}>
            View public profile
          </a>
        ) : null}
        <button onClick={address ? disconnect : connectWallet} disabled={loadingWallet} style={ui.header.btn}>
          {address ? "Disconnect" : loadingWallet ? "Checking wallet…" : "Connect Wallet"}
        </button>
      </div>

      {/* Status messages */}
      {error ? (
        <div
          style={{
            marginBottom: 12,
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid rgba(255,100,100,0.3)",
            background: "rgba(255,80,80,0.08)",
            color: "#ffb3b3",
            fontSize: 14,
          }}
        >
          {error}
        </div>
      ) : savedAt ? (
        <div
          style={{
            marginBottom: 12,
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid rgba(0,200,140,0.35)",
            background: "rgba(0,200,140,0.10)",
            color: "#9ff3cc",
            fontSize: 14,
          }}
        >
          Saved ✓
        </div>
      ) : null}

      {/* Form + Preview */}
      <div style={ui.grid2 as React.CSSProperties}>
        {/* Form card */}
        <section style={ui.card.base}>
          <div style={ui.card.title}>Edit Profile</div>
          {!address && (
            <div style={{ ...ui.dim, marginBottom: 8, fontSize: 14 }}>
              Connect your wallet to enable editing and saving.
            </div>
          )}

          {/* Avatar uploader */}
          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation(); setDragOver(false);
              handleAvatarFiles(e.dataTransfer?.files || null);
            }}
            title={address ? "Click or drop an image" : "Connect your wallet first"}
            style={{
              display: "block",
              borderRadius: 12,
              padding: 12,
              border: `2px dashed ${dragOver ? "rgba(0,255,255,0.5)" : "rgba(0,220,255,0.25)"}`,
              cursor: address ? "pointer" : "not-allowed",
              background: dragOver ? "rgba(0,220,255,0.06)" : "transparent",
              marginBottom: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <img
                src={form.avatar_url || "/avatar-placeholder.png"}
                alt=""
                width={72}
                height={72}
                onError={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  if (!img.src.endsWith("/avatar-placeholder.png")) img.src = "/avatar-placeholder.png";
                }}
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 12,
                  objectFit: "cover",
                  background: "#0e1622",
                  boxShadow: "0 0 0 2px rgba(0,255,255,0.25), 0 0 18px rgba(0,240,255,0.25)",
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>Avatar</div>
                <div style={{ ...ui.dim, fontSize: 12 }}>
                  PNG / JPG / WEBP / GIF • up to 5MB • resized to {AVATAR_SIZE}×{AVATAR_SIZE}
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <input
                    id="avatar-input"
                    type="file"
                    accept="image/*"
                    disabled={!address || avatarBusy}
                    style={{ display: "none" }}
                    onChange={(e) => handleAvatarFiles(e.target.files)}
                  />
                  <label
                    htmlFor="avatar-input"
                    style={{
                      ...ui.header.btn,
                      padding: "6px 10px",
                      fontWeight: 600,
                      cursor: address && !avatarBusy ? "pointer" : "not-allowed",
                      opacity: address && !avatarBusy ? 1 : 0.6,
                    }}
                  >
                    {avatarBusy ? "Processing…" : "Choose image"}
                  </label>
                  {form.avatar_url ? (
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, avatar_url: "" }))}
                      style={{ ...ui.header.btn, padding: "6px 10px", fontWeight: 600 }}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </label>

          {/* Username */}
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 14, fontWeight: 600 }}>Username *</label>
            <input
              value={form.username || ""}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="e.g. onchainbuilder"
              disabled={!address}
              style={input}
            />
          </div>

          {/* Socials */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
            <div>
              <label style={{ fontSize: 14, fontWeight: 600 }}>Twitter</label>
              <input
                value={form.twitter || ""}
                onChange={(e) => setForm((f) => ({ ...f, twitter: e.target.value }))}
                placeholder="@handle"
                disabled={!address}
                style={input}
              />
            </div>
            <div>
              <label style={{ fontSize: 14, fontWeight: 600 }}>Telegram</label>
              <input
                value={form.telegram || ""}
                onChange={(e) => setForm((f) => ({ ...f, telegram: e.target.value }))}
                placeholder="@handle"
                disabled={!address}
                style={input}
              />
            </div>
          </div>

          <button onClick={onSave} disabled={!address || saving} style={{ ...ui.header.btn, width: "100%", marginTop: 12 }}>
            {saving ? "Saving…" : address ? "Save Profile" : "Connect wallet to save"}
          </button>
        </section>

        {/* Preview card */}
        <section style={ui.card.base}>
          <div style={ui.card.title}>Public Preview</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <img
              src={form.avatar_url || "/avatar-placeholder.png"}
              alt=""
              width={80}
              height={80}
              onError={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                const fallback = "/avatar-placeholder.png";
                if (!img.src.endsWith(fallback)) img.src = fallback;
              }}
              style={{
                width: 80,
                height: 80,
                borderRadius: 16,
                objectFit: "cover",
                background: "#0e1622",
                boxShadow: "0 0 0 2px rgba(0,255,255,0.25), 0 0 18px rgba(0,240,255,0.25)",
              }}
            />
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{form.username || "Unnamed"}</div>
              <div style={{ fontSize: 12, ...ui.dim }}>
                {address ? short(address) : "Connect wallet to claim your profile"}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 4, fontSize: 14 }}>
            {form.twitter ? (
              <div>
                Twitter:{" "}
                <a
                  href={`https://twitter.com/${String(form.twitter).replace(/^@/, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#d8ecff", textDecoration: "underline" }}
                >
                  @{String(form.twitter).replace(/^@/, "")}
                </a>
              </div>
            ) : null}
            {form.telegram ? (
              <div>
                Telegram:{" "}
                <a
                  href={`https://t.me/${String(form.telegram).replace(/^@/, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#d8ecff", textDecoration: "underline" }}
                >
                  @{String(form.telegram).replace(/^@/, "")}
                </a>
              </div>
            ) : null}
          </div>

          {address ? (
            <a href={`/u/${address}`} style={{ ...ui.header.btn, marginTop: 12, display: "inline-block" }}>
              View public profile
            </a>
          ) : null}
        </section>
      </div>

      {/* Footer tip */}
      <div style={{ ...ui.dim, marginTop: 16, fontSize: 12 }}>
        Tip: avatars are sanitized client-side (re-encoded PNG {AVATAR_SIZE}×{AVATAR_SIZE}) before saving.
      </div>
    </main>
  );
}

/*────────────────────────────────────────────────────────
  Inputs (match neon vibe)
────────────────────────────────────────────────────────*/
const input: React.CSSProperties = {
  width: "100%",
  border: "1px solid rgba(0,220,255,0.25)",
  background: "rgba(255,255,255,0.03)",
  borderRadius: 10,
  padding: 10,
  fontSize: 14,
  color: "#d8ecff",
  outline: "none",
};
