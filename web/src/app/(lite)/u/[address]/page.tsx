// src/app/(lite)/u/[address]/page.tsx
import React from "react";
import dynamicImport from "next/dynamic";
import { headers } from "next/headers";
import AvatarImg from "@/components/AvatarImg"; // client image shim (no server onError)

// Show fresh data
export const revalidate = 0;

type Profile = {
  username?: string;
  avatar_url?: string;
  twitter?: string;
  telegram?: string;
};

type Card = {
  pool_addr: string;
  token_addr: string;
  name: string;
  symbol: string;
  image_url?: string;
  price_bnb?: number;
  pct_change_24h?: number | null;
  created_at?: number;

  // any of these might exist depending on your API
  created_by?: string;
  createdBy?: string;
  creator?: string;
  owner?: string;
  created_addr?: string;
  createdByAddress?: string;
};

// client-only wallet button (avoids useContext crash in server)
const WalletBtn = dynamicImport(
  () => import("@/components/wallet/WalletButton").then((m) => m.WalletButton),
  { ssr: false }
);

// UI bits (neon header like home)
const ui = {
  page: {
    maxWidth: 1120,
    margin: "32px auto 64px",
    padding: 16,
  } as React.CSSProperties,
  header: {
    wrap: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "12px 14px",
      borderRadius: 14,
      background: "linear-gradient(180deg, rgba(8,14,22,0.65), rgba(9,13,20,0.6))",
      boxShadow:
        "0 0 0 1px rgba(0,255,255,0.18) inset, 0 0 30px -16px rgba(0,240,255,0.5)",
      marginBottom: 16,
    } as React.CSSProperties,
    brand: {
      fontWeight: 900,
      letterSpacing: 1.2,
      fontSize: 22,
      padding: "6px 12px",
      borderRadius: 12,
      boxShadow:
        "0 0 0 1px rgba(0,255,255,0.22) inset, 0 0 16px rgba(0,240,255,0.25)",
      background: "linear-gradient(180deg, rgba(12,19,27,0.6), rgba(9,14,21,0.6))",
    } as React.CSSProperties,
    nav: { display: "flex", gap: 18, marginLeft: 12, opacity: 0.92 } as React.CSSProperties,
    navLink: { color: "#d8ecff", textDecoration: "none", borderBottom: "none" } as React.CSSProperties,
    grow: { flex: 1 } as React.CSSProperties,
  },
  sectionCard: {
    background: "linear-gradient(180deg, #0b1018, #0e1622)",
    borderRadius: 14,
    padding: 16,
    position: "relative" as const,
    boxShadow:
      "0 0 0 1px rgba(0,220,255,0.10) inset, 0 0 30px -12px rgba(0,240,255,0.5)",
    marginTop: 16,
  },
  title: { fontWeight: 800, letterSpacing: 0.3, opacity: 0.95, marginBottom: 10, fontSize: 20 },
  rowCardsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 },
  rowCard: {
    base: {
      padding: 12,
      borderRadius: 12,
      background: "linear-gradient(180deg, rgba(12,19,27,0.7), rgba(9,14,21,0.7))",
      boxShadow: "0 0 0 1px rgba(0,220,255,0.10) inset",
      textDecoration: "none",
      color: "#d8ecff",
      display: "block",
    } as React.CSSProperties,
  },
  dim: { color: "#8aa6c2" },
};

function short(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function same(a?: string, b?: string) {
  return (a || "").toLowerCase() === (b || "").toLowerCase();
}

function isCreatedBy(t: Card, who: string) {
  return (
    same(t.created_by, who) ||
    same(t.createdBy, who) ||
    same(t.creator, who) ||
    same(t.owner, who) ||
    same(t.created_addr, who) ||
    same(t.createdByAddress, who)
  );
}

async function getBaseUrl() {
  const h = headers();
  const proto = h.get("x-forwarded-proto") || "http";
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function postJson<T>(url: string, body: any): Promise<T | null> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export default async function PublicUserPage({ params }: { params: { address: string } }) {
  const addr = (params?.address || "").toLowerCase();
  const base = await getBaseUrl();

  // 1) Profile fetch (robust to different shapes)
  const profileBook = await postJson<Record<string, Profile> | Profile[]>(
    `${base}/api/profile/bulk`,
    { addresses: [addr] }
  );

  let profile: Profile = {};
  if (Array.isArray(profileBook)) {
    // array shape: [{ address, username, ... }]
    const hit = profileBook.find((p: any) => same(p?.address, addr));
    profile = {
      username: (hit as any)?.username || "",
      avatar_url: (hit as any)?.avatar_url || "",
      twitter: (hit as any)?.twitter || "",
      telegram: (hit as any)?.telegram || "",
    };
  } else if (profileBook && typeof profileBook === "object") {
    // map shape: { "0x..": { username, ... } }
    profile = (profileBook as any)?.[addr] || {};
  }

  // 2) Tokens by this creator (try existing endpoints first)
  const [latest, trending] = await Promise.all([
    getJson<Card[]>(`${base}/api/token/latest-db?limit=500`),
    getJson<Card[]>(`${base}/api/token/trending-db?limit=500`),
  ]);

  // ⬇⬇⬇ REPLACED helper + `created` block WITH THIS EXACT SNIPPET ⬇⬇⬇

  // helper: accept undefined or null
  const fromArr = (arr: Card[] | null | undefined) =>
    (arr ?? []).filter((t) => isCreatedBy(t, addr));

  // use let because we mutate `created` below
  let created: Card[] = [...fromArr(latest), ...fromArr(trending)];

  // de-dupe by pool_addr
  const seen = new Set<string>();
  created = created.filter((t) => {
    const key = (t.pool_addr || "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // optional fallback
  if (created.length === 0) {
    const byCreator = await getJson<Card[]>(
      `${base}/api/token/by-creator?address=${addr}`
    );
    if (Array.isArray(byCreator) && byCreator.length) {
      const seen2 = new Set<string>();
      created = byCreator.filter((t) => {
        const key = (t.pool_addr || "").toLowerCase();
        if (!key || seen2.has(key)) return false;
        seen2.add(key);
        return true;
      });
    }
  }

  // ⬆⬆⬆ END REPLACED BLOCK ⬆⬆⬆

  return (
    <main style={ui.page}>
      {/* Header */}
      <div style={ui.header.wrap as React.CSSProperties}>
        <div style={ui.header.brand as React.CSSProperties}>COINRUSH</div>
        <nav style={ui.header.nav}>
          <a href="/" style={ui.header.navLink}>Home</a>
          <a href="/explore" style={ui.header.navLink}>Explore</a>
          <a href="/create" style={ui.header.navLink}>Create</a>
          <a href="/docs" style={ui.header.navLink}>Docs</a>
        </nav>
        <div style={ui.header.grow} />
        <WalletBtn />
      </div>

      {/* Profile header card */}
      <section style={ui.sectionCard}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AvatarImg
  src={profile?.avatar_url || "/avatar-placeholder.png"}
  alt=""
  style={{
    width: 88,
    height: 88,
    borderRadius: 12,
    objectFit: "cover",
    background: "#0e1622",
    boxShadow: "0 0 0 2px rgba(0,255,255,0.25), 0 0 18px rgba(0,240,255,0.25)",
    border: "none",
    display: "block",
  }}
/>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>
              {profile?.username || short(addr)}
            </div>
            <div style={{ fontSize: 12, ...ui.dim }}>{short(addr)}</div>
            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              {profile?.twitter ? (
                <a
                  href={`https://twitter.com/${String(profile.twitter).replace(/^@/, "")}`}
                  target="_blank"
                >
                  @{String(profile.twitter).replace(/^@/, "")}
                </a>
              ) : null}
              {profile?.telegram ? (
                <a
                  href={`https://t.me/${String(profile.telegram).replace(/^@/, "")}`}
                  target="_blank"
                >
                  @{String(profile.telegram).replace(/^@/, "")}
                </a>
              ) : null}
            </div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <a
              href="/me"
              style={{
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px solid rgba(0,255,255,0.28)",
                background:
                  "linear-gradient(180deg, rgba(12,19,27,0.85), rgba(9,14,21,0.85))",
                color: "#e7faff",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              Edit Profile
            </a>
          </div>
        </div>
      </section>

      {/* Created tokens */}
      <section style={ui.sectionCard}>
        <div style={ui.title}>Created Tokens</div>

        {created.length === 0 ? (
          <div style={ui.dim}>
            No tokens found for this creator.
            <br />
            <span style={{ fontSize: 12 }}>
              Ensure your token list APIs include a creator field
              (e.g. <code>created_by</code>/<code>creator</code>/<code>owner</code>).
              This page checks several common names automatically.
            </span>
          </div>
        ) : (
          <div style={ui.rowCardsGrid}>
            {created.map((t) => (
              <a key={t.pool_addr} href={`/token-lite/${t.pool_addr}`} style={ui.rowCard.base}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <img
                    src={t.image_url || "/token-placeholder.png"}
                    width={44}
                    height={44}
                    alt=""
                    style={{
                      borderRadius: 10,
                      objectFit: "cover",
                      background: "#0e1622",
                      boxShadow:
                        "0 0 0 2px rgba(0,255,255,0.25), 0 0 18px rgba(0,240,255,0.25)",
                      display: "block",
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 700 }}>{t.name || t.symbol || "Token"}</div>
                    <div style={{ fontSize: 12, ...ui.dim }}>{t.symbol || "—"}</div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* Footer note */}
      <div style={{ marginTop: 16, fontSize: 12, ...ui.dim }}>
        You’re viewing a public profile.
      </div>
    </main>
  );
}
