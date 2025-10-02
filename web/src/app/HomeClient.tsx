// src/app/HomeClient.tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { createTokenAndPoolWithSigner, factoryContract } from "@/lib/eth";
import { formatEther, BrowserProvider } from "ethers";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useBnbUsd } from "@/lib/useBnbUsd";
import { LoadingStripe } from "@/components/LoadingStripe";
import { assertChainId, assertAddressAllowed } from "@/lib/security/wallet-preflight";
import { loadTrades } from "@/lib/tokenPublic";
import { useConnectWallet } from "@web3-onboard/react";

// ⬇️ NEW: initialize onboard & add persistence helpers
import onboard, { autoReconnectLastWallet, subscribeRememberWallet } from "@/lib/wallet/onboard";

/*────────────────────────────────────────────────────────
  Types
────────────────────────────────────────────────────────*/
type Card = {
  pool_addr: string;
  token_addr: string;
  name: string;
  symbol: string;
  image_url?: string;
  price_bnb?: number;
  pct_change_24h?: number | null;
  created_at?: number;

  // optional server-provided trending hints (any naming)
  tx_24h?: number;
  trades_24h?: number;
  txCount24h?: number;
  trades24h?: number;
  trx24h?: number;
  count_24h?: number;
  volume_tx_24h?: number;
  pct24h?: number;
  change24h?: number;
};

type Trade = {
  type: "BUY" | "SELL";
  ts?: number; time?: number; timestamp?: number;
  bnbIn?: number; bnbOut?: number;
  tokenIn?: number; tokensOut?: number;
};

/*────────────────────────────────────────────────────────
  Constants / helpers
────────────────────────────────────────────────────────*/
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID || 97);

function robustTokenTs(t: any): number {
  const vals = [
    t?.created_at_ms, t?.ts_ms, t?.timestamp_ms, t?.created_ts_ms,
    t?.created_ts, t?.ts, t?.timestamp,
    t?.created_block, t?.block, t?.block_number, t?.factory_block, t?.factory_log_block,
    Date.parse(String(t?.created_at ?? t?.created ?? t?.timestamp ?? "")),
    t?.rowid, t?.id,
  ]
    .map((x: any) => (typeof x === "string" ? Number(x) : x))
    .filter((x) => Number.isFinite(x)) as number[];

  if (!vals.length) return 0;
  const v = Math.max(...vals);
  if (v > 1e12) return v;        // ms
  if (v > 1e9) return v * 1000;  // sec → ms
  return v;
}

const fmtUSDv = (usdPerBnb: number | undefined, bnbPrice?: number) =>
  bnbPrice == null || !usdPerBnb
    ? "—"
    : `$${(bnbPrice * usdPerBnb).toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
const fmtBNBv = (n?: number) =>
  n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 8 });

/* Trending normalization + sorting */
function pickNum(...cands: any[]): number | null {
  for (const c of cands) {
    const n = Number(c);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}
type TrendingView = Card & { _tx24: number; _pct: number | null };

function normalizeTrending(cards: Card[]): TrendingView[] {
  return (cards || []).map((t) => {
    const tx24 = pickNum(
      t.tx_24h, t.trades_24h, t.txCount24h, t.trades24h, t.trx24h, t.count_24h, t.volume_tx_24h
    ) ?? 0;
    const pct = pickNum(t.pct_change_24h, t.pct24h, t.change24h);
    return { ...t, _tx24: tx24, _pct: pct };
  });
}

function sortTrending(arr: TrendingView[]) {
  return [...arr].sort((a, b) => {
    if (b._tx24 !== a._tx24) return b._tx24 - a._tx24;                 // 1) tx count desc
    const ap = a._pct ?? -Infinity, bp = b._pct ?? -Infinity;
    if (bp !== ap) return bp - ap;                                     // 2) pct desc
    return robustTokenTs(b) - robustTokenTs(a);                         // 3) newest
  });
}

/* Derive stats from trades (24h tx & % change) */
function tradeTs(t: Trade): number {
  return Number(t.ts ?? t.time ?? t.timestamp ?? 0);
}
function tradePriceBNBPerToken(t: Trade): number | null {
  const bIn = Number(t.bnbIn || 0);
  const bOut = Number(t.bnbOut || 0);
  const tokIn = Number(t.tokenIn || 0);
  const tokOut = Number(t.tokensOut || 0);
  if (t.type === "BUY")  { if (tokOut > 0) return bIn  / tokOut; }
  if (t.type === "SELL") { if (tokIn  > 0) return bOut / tokIn; }
  return null;
}

function compute24hStats(trades: Trade[]): { tx24: number; pct?: number | null } {
  const cutoff = Math.floor(Date.now() / 1000) - 24*3600;
  let tx24 = 0;
  let firstInWindow: number | null = null;
  let lastInWindow: number | null = null;

  for (const t of trades) {
    const ts = tradeTs(t);
    if (!ts) continue;
    if (ts >= cutoff) {
      tx24++;
      const p = tradePriceBNBPerToken(t);
      if (p != null) {
        if (firstInWindow == null) firstInWindow = p; // first seen (newest)
        lastInWindow = p;                              // keep updating → last (oldest in window)
      }
    }
  }

  let pct: number | null = null;
  if (firstInWindow != null && lastInWindow != null && lastInWindow > 0) {
    pct = ((firstInWindow / lastInWindow) - 1) * 100;
  }
  return { tx24, pct };
}

/*────────────────────────────────────────────────────────
  UI tokens
────────────────────────────────────────────────────────*/
const ui = {
  page: {
    maxWidth: 1120, margin: "32px auto 64px", padding: 16, color: "#d8ecff",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"',
    background:
      "radial-gradient(800px 400px at 10% -10%, rgba(0,255,255,0.08), transparent 60%), radial-gradient(800px 400px at 110% 120%, rgba(0,255,255,0.06), transparent 60%), #070b11",
    position: "relative" as const,
  },
  header: {
    wrap: {
      display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: 14,
      background: "linear-gradient(180deg, rgba(8,14,22,0.65), rgba(9,13,20,0.6))",
      boxShadow: "0 0 0 1px rgba(0,255,255,0.18) inset, 0 0 30px -16px rgba(0,240,255,0.5)",
      marginBottom: 16,
    } as React.CSSProperties,
    brand: {
      fontWeight: 900, letterSpacing: 1.2, fontSize: 22, padding: "6px 12px", borderRadius: 12,
      boxShadow: "0 0 0 1px rgba(0,255,255,0.22) inset, 0 0 16px rgba(0,240,255,0.25)",
      background: "linear-gradient(180deg, rgba(12,19,27,0.6), rgba(9,14,21,0.6))",
      textShadow: "0 0 14px rgba(0,240,255,0.35)",
    } as React.CSSProperties,
    nav: { display: "flex", gap: 18, marginLeft: 12, opacity: 0.92 } as React.CSSProperties,
    navLink: { color: "#d8ecff", textDecoration: "none", borderBottom: "none" } as React.CSSProperties,
    grow: { flex: 1 } as React.CSSProperties,
  },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 8, position: "relative" as const },
  card: {
    base: {
      background: "linear-gradient(180deg, #0b1018, #0e1622)", borderRadius: 14, padding: 16, position: "relative" as const,
      boxShadow: "0 0 0 1px rgba(0,220,255,0.14) inset, 0 0 30px -12px rgba(0,240,255,0.55)",
    },
    title: { fontWeight: 800, letterSpacing: 0.3, opacity: 0.95, fontSize: 20 },
    subtitle: { color: "#8aa6c2", fontSize: 14, lineHeight: 1.5 },
    bullet: { display: "flex", alignItems: "center", gap: 8, color: "#8aa6c2", fontSize: 14 },
    btn: {
      padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,255,255,0.28)",
      background: "linear-gradient(180deg, rgba(12,19,27,0.85), rgba(9,14,21,0.85))",
      color: "#e7faff", fontWeight: 700, cursor: "pointer",
      boxShadow: "0 0 22px -8px rgba(0,240,255,0.55)", textShadow: "0 0 8px rgba(255,255,255,0.35)",
      transition: "transform .15s ease, box-shadow .15s ease",
    } as React.CSSProperties,
    smallNote: { fontSize: 12, color: "#8aa6c2", marginTop: 8 },
  },
  rowCardsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 },
  rowCard: {
    base: {
      padding: 12, borderRadius: 12,
      background: "linear-gradient(180deg, rgba(12,19,27,0.7), rgba(9,14,21,0.7))",
      boxShadow: "0 0 0 1px rgba(0,220,255,0.10) inset, 0 0 24px -12px rgba(0,240,255,0.35)",
      textDecoration: "none", color: "#d8ecff", display: "block",
    } as React.CSSProperties,
  },
};

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

function normUrl(u: string) {
  if (!u) return "";
  try {
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    const url = new URL(u);
    return url.toString();
  } catch { return ""; }
}

/*────────────────────────────────────────────────────────
  Tiny memoized card components
────────────────────────────────────────────────────────*/
const LatestCard: React.FC<{ t: Card; usdPerBnb?: number }> = React.memo(({ t, usdPerBnb }) => {
  return (
    <a key={t.pool_addr} href={`/token-lite/${t.pool_addr}`} style={ui.rowCard.base}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img
          src={t.image_url || "/token-placeholder.png"}
          width={44} height={44} alt=""
          onError={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            if (!img.src.endsWith("/token-placeholder.png")) img.src = "/token-placeholder.png";
          }}
          style={{
            borderRadius: 10, objectFit: "cover", background: "#0e1622",
            boxShadow: "0 0 0 2px rgba(0,255,255,0.25), 0 0 18px rgba(0,240,255,0.25)",
          }}
        />
        <div>
          <div style={{ fontWeight: 700 }}>{t.name || t.symbol || "Token"}</div>
          <div style={{ fontSize: 12, color: "#8aa6c2" }}>{t.symbol || "—"}</div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 14 }}>{t.price_bnb != null ? `${fmtBNBv(t.price_bnb)} BNB` : "—"}</div>
          <div style={{ fontSize: 12, color: "#8aa6c2" }}>
            {t.price_bnb != null ? fmtUSDv(usdPerBnb, t.price_bnb) : ""}
          </div>
        </div>
      </div>
    </a>
  );
});
LatestCard.displayName = "LatestCard";

const TrendingCard: React.FC<{ t: TrendingView }> = React.memo(({ t }) => {
  const pct = t._pct ?? null;
  const badge = pct == null ? "—" : (pct >= 0 ? `+${pct.toFixed(2)}%` : `${pct.toFixed(2)}%`);
  const badgeColor = pct == null ? "#8aa6c2" : pct >= 0 ? "#3ae68b" : "#ff6b6b";
  return (
    <a key={t.pool_addr} href={`/token-lite/${t.pool_addr}`} style={ui.rowCard.base}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img
          src={t.image_url || "/token-placeholder.png"}
          width={44} height={44} alt=""
          onError={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            if (!img.src.endsWith("/token-placeholder.png")) img.src = "/token-placeholder.png";
          }}
          style={{
            borderRadius: 10, objectFit: "cover", background: "#0e1622",
            boxShadow: "0 0 0 2px rgba(0,255,255,0.25), 0 0 18px rgba(0,240,255,0.25)",
          }}
        />
        <div>
          <div style={{ fontWeight: 700 }}>{t.name || t.symbol || "Token"}</div>
          <div style={{ fontSize: 12, color: "#8aa6c2" }}>{t.symbol || "—"}</div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 12, color: badgeColor }}>{badge}</div>
          <div style={{ fontSize: 12, color: "#8aa6c2", marginTop: 2 }}>Tx 24h: {t._tx24}</div>
        </div>
      </div>
    </a>
  );
});
TrendingCard.displayName = "TrendingCard";

/*────────────────────────────────────────────────────────
  Guarded Button (Onboard)
────────────────────────────────────────────────────────*/
function GuardedActionButton({
  onRun,
  children,
  style,
  disabled,
}: {
  onRun: () => Promise<void>;
  children: React.ReactNode;
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  const [{ wallet }, connect] = useConnectWallet();
  const isConnected = !!wallet;

  return (
    <button
      style={{
        ...ui.card.btn,
        ...(style || {}),
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      disabled={!!disabled}
      onClick={async () => {
        if (disabled) return;
        if (!isConnected) {
          const res = await connect();
          if (!res?.length) return; // user closed modal
          try {
            const addr = res?.[0]?.accounts?.[0]?.address || "";
            if (addr) localStorage.setItem("cr:lastAddress", addr.toLowerCase());
          } catch {}
        }
        await onRun();
      }}
    >
      {children}
    </button>
  );
}

/*────────────────────────────────────────────────────────
  FormContent (the missing component)
────────────────────────────────────────────────────────*/
type FormContentProps = {
  creationFee: string | null;
  platformFeePct: string | null;
  creatorFeePct: string;
  setCreatorFeePct: React.Dispatch<React.SetStateAction<string>>;
  initialBuyBNB: string;
  setInitialBuyBNB: React.Dispatch<React.SetStateAction<string>>;
  totalNow: number | null;
  usdPerBnb?: number;
  status: string;
  onCreate: (e: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  creating: boolean;
};

function FormContent({
  creationFee,
  platformFeePct,
  creatorFeePct,
  setCreatorFeePct,
  initialBuyBNB,
  setInitialBuyBNB,
  totalNow,
  usdPerBnb,
  status,
  onCreate,
  onClose,
  creating,
}: FormContentProps) {
  const totalNowStr =
    totalNow == null ? "—" : `${totalNow.toLocaleString(undefined, { maximumFractionDigits: 8 })} BNB`;
  const totalUsdStr =
    totalNow == null || !usdPerBnb
      ? ""
      : ` (${(totalNow * usdPerBnb).toLocaleString(undefined, { maximumFractionDigits: 2 })} USD)`;

  const formRef = React.useRef<HTMLFormElement>(null);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={ui.card.title}>Create Token</div>
        <button type="button" onClick={onClose} style={{ ...ui.card.btn, padding: "6px 10px", fontWeight: 600 }}>
          Back
        </button>
      </div>

      <div style={{ marginBottom: 12, lineHeight: 1.6, color: "#8aa6c2" }}>
        <b style={{ color: "#d8ecff" }}>Creation fee:</b> {creationFee ?? "—"} BNB
        {platformFeePct && <> • <b style={{ color: "#d8ecff" }}>Platform fee:</b> {platformFeePct}% per trade</>}
      </div>

      <form ref={formRef} onSubmit={onCreate} style={{ display: "grid", gap: 10 }}>
        <div>
          <label htmlFor="name"><b>Token Name</b></label>
          <input id="name" name="name" placeholder="e.g., Dog Rush" required style={input} />
        </div>
        <div>
          <label htmlFor="symbol"><b>Symbol</b></label>
          <input id="symbol" name="symbol" placeholder="e.g., DOGR" required style={input} />
        </div>

        {/* Optional extras */}
        <div>
          <label htmlFor="description"><b>Token Description</b> <small>(optional)</small></label>
          <textarea id="description" name="description" placeholder="What is your token about?"
            maxLength={500}
            style={{ ...input, minHeight: 90, resize: "vertical" as const }} />
          <div style={ui.card.smallNote}>Up to 500 characters.</div>
        </div>
        <div>
          <label htmlFor="website"><b>Website</b> <small>(optional)</small></label>
          <input id="website" name="website" placeholder="https://example.com" style={input} />
        </div>
        <div>
          <label htmlFor="telegram"><b>Telegram</b> <small>(optional)</small></label>
          <input id="telegram" name="telegram" placeholder="https://t.me/yourchannel" style={input} />
        </div>
        <div>
          <label htmlFor="twitter"><b>Twitter (X)</b> <small>(optional)</small></label>
          <input id="twitter" name="twitter" placeholder="https://twitter.com/yourhandle" style={input} />
        </div>

        <div>
          <label htmlFor="creatorFeePct"><b>Creator Fee (%)</b> <small>(max 5%)</small></label>
          <input
            id="creatorFeePct" name="creatorFeePct" type="number" min={0} max={5} step="0.1"
            value={creatorFeePct} onChange={(e) => setCreatorFeePct(e.target.value)} style={input}
          />
          <div style={ui.card.smallNote}>Your % of each curve trade (in BNB).</div>
        </div>
        <div>
          <label htmlFor="initialBuyBNB"><b>Creator initial buy (BNB)</b></label>
          <input
            id="initialBuyBNB" name="initialBuyBNB" type="text"
            value={initialBuyBNB} onChange={(e) => setInitialBuyBNB(e.target.value)} style={input}
          />
          <div style={ui.card.smallNote}>First buy is capped at 10% of supply.</div>
        </div>
        <div>
          <label htmlFor="image"><b>Token Image</b> <small>(PNG/JPG)</small></label>
          <input id="image" name="image" type="file" accept="image/*" style={input} />
          <div style={ui.card.smallNote}>Optional, but recommended.</div>
        </div>

        {/* Total Now */}
        <div style={{ marginTop: 4, fontSize: 14, color: "#8aa6c2" }}>
          <b style={{ color: "#d8ecff" }}>Total BNB needed now:</b> {totalNowStr}
          <span style={{ color: "#8aa6c2" }}>{totalUsdStr}</span>
          <div style={ui.card.smallNote}>
            Total = <i>creation fee</i> + <i>your initial buy</i>.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
          <GuardedActionButton
            onRun={async () => { formRef.current?.requestSubmit(); }}
            style={{ background: "linear-gradient(180deg, rgba(38,60,78,0.9), rgba(22,34,48,0.9))" }}
            disabled={creating}
          >
            {creating ? "Launching…" : "Launch Token"}
          </GuardedActionButton>
          <button type="button" onClick={onClose} style={ui.card.btn} disabled={creating}>
            Cancel
          </button>
        </div>
      </form>

      {status && (
        <pre
          style={{
            whiteSpace: "pre-wrap", marginTop: 10, padding: 10,
            border: "1px dashed rgba(0,220,255,0.25)", borderRadius: 10,
            color: "#8aa6c2", background: "rgba(255,255,255,0.02)",
          }}
        >
          {status}
        </pre>
      )}
    </div>
  );
}

/*────────────────────────────────────────────────────────
  Page Component
────────────────────────────────────────────────────────*/
export default function HomeClient({
  initialLatest,
  initialTrending,
}: {
  initialLatest: Card[];
  initialTrending: Card[];
}) {
  const router = useRouter();
  const [status, setStatus] = React.useState("");
  const usdPerBnb = useBnbUsd();

  // progress overlay (global)
  const [working, setWorking] = React.useState<null | {
    label: string;
    percent: number;
    step: "switch" | "upload" | "create" | "save" | "done" | "error";
  }>(null);

  const [creating, setCreating] = React.useState(false);

  // Access Onboard wallet
  const [{ wallet }, connect] = useConnectWallet();

  // ⬇️ NEW: start persistence + auto-reconnect once on mount
  React.useEffect(() => {
    subscribeRememberWallet();
    autoReconnectLastWallet();
  }, []);

  // ✅ Self-contained signer acquisition (connect + switch chain + get signer)
  async function getFreshSigner() {
    // 1) Ensure connected
    let w = wallet;
    if (!w) {
      const res = await connect();
      if (!res || res.length === 0) {
        throw new Error("Wallet connection was cancelled.");
      }
      w = res[0];
    }

    // 2) Ensure chain = BSC Testnet (0x61)
    const eip1193 = (w as any).provider;
    try {
      await eip1193.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x61" }],
      });
    } catch (err: any) {
      const msg = String(err?.message || "").toLowerCase();
      if (msg.includes("unrecognized chain id") || msg.includes("not added") || err?.code === 4902) {
        try {
          await eip1193.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0x61",
              chainName: "BSC Testnet",
              nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
              rpcUrls: ["https://bsc-testnet.publicnode.com"],
              blockExplorerUrls: ["https://testnet.bscscan.com"],
            }],
          });
          await eip1193.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x61" }],
          });
        } catch {
          throw new Error("Could not switch to BSC Testnet (0x61).");
        }
      } else {
        throw err;
      }
    }

    // 3) Return ethers v6 signer
    const provider = new BrowserProvider(eip1193);
    return provider.getSigner();
  }

  const defaultTarget = process.env.NEXT_PUBLIC_DEFAULT_TARGET_CAP_BNB || "40";
  const [creatorFeePct, setCreatorFeePct] = React.useState("2.0");
  const [initialBuyBNB, setInitialBuyBNB] = React.useState("0.001");
  const [targetCapBNB] = React.useState<string>(defaultTarget);

  const [latest, setLatest] = React.useState<Card[]>(initialLatest || []);
  const [trending, setTrending] = React.useState<TrendingView[]>(sortTrending(normalizeTrending(initialTrending || [])));
  const [listsBusy, setListsBusy] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const [openForm, setOpenForm] = React.useState(false);
  const [creationFee, setCreationFee] = React.useState<string | null>(null);
  const [platformFeePct, setPlatformFeePct] = React.useState<string | null>(null);

  // progress helper
  const step = (label: string, percent: number, s: "switch"|"upload"|"create"|"save"|"done"|"error") =>
    setWorking({ label, percent, step: s });

  React.useEffect(() => {
    if (!openForm) return;
    let cancelled = false;
    (async () => {
      try {
        const f = factoryContract(true, CHAIN_ID);
        const factoryAddr = String((f as any).target ?? (f as any).address ?? "");
        if (factoryAddr) assertAddressAllowed(factoryAddr);

        const feeWei: bigint = await f.creationFeeWei();
        const pfBps: number = Number(await f.platformFeeBps());
        if (!cancelled) {
          setCreationFee(formatEther(feeWei));
          setPlatformFeePct((pfBps / 100).toFixed(2));
        }
      } catch (e: any) {
        if (!cancelled) setStatus("Failed to read factory address from env. " + (e.message || String(e)));      }
    })();
    return () => { cancelled = true; };
  }, [openForm]);

  const totalBNBNow = React.useMemo(() => {
    const fee = creationFee != null ? Number(creationFee) : NaN;
    const seed = Number(initialBuyBNB || "0");
    const tot = fee + seed;
    return Number.isFinite(tot) ? tot : null;
  }, [creationFee, initialBuyBNB]);

  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => { setHydrated(true); }, []);

  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const check = () => setIsMobile(window.matchMedia("(max-width: 980px)").matches);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  React.useEffect(() => {
    if (isMobile && openForm) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [isMobile, openForm]);

  // 🔑 Force re-fetch of lists when value changes
  const [refreshKey, setRefreshKey] = React.useState(0);

  // 🔁 Bump on window focus and every 15s (keeps home fresh)
  React.useEffect(() => {
    const onFocus = () => setRefreshKey(k => k + 1);
    window.addEventListener("focus", onFocus);
    const iv = setInterval(() => setRefreshKey(k => k + 1), 15000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(iv);
    };
  }, []);

  // Background refresh — prioritize speed, but no stale cache
  React.useEffect(() => {
    let stop = false;

    const fetchJSON = async (url: string, ms = 4000) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), ms);
      try {
        const r = await fetch(url, {
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
          signal: ctl.signal,
        });
        if (!r.ok) return null;
        return (await r.json()) as unknown;
      } catch {
        return null;
      } finally {
        clearTimeout(t);
      }
    };

    const enrichOne = async (pool: string, ms = 2500): Promise<{ tx24: number; pct: number | null }> => {
      const timeout = new Promise<{ tx24: number; pct: number | null }>((resolve) =>
        setTimeout(() => resolve({ tx24: 0, pct: null }), ms)
      );
      const task = (async () => {
        try {
          const trades = (await loadTrades(pool, CHAIN_ID, 18)) as any[];
          const { tx24, pct } = compute24hStats(trades || []);
          return { tx24, pct: pct ?? null };
        } catch {
          return { tx24: 0, pct: null };
        }
      })();
      return Promise.race([timeout, task]);
    };

    const run = async () => {
      try {
        setListsBusy(true);

        // cache busters ensure we never see stale results
        const latestUrl = `/api/token/latest-db?limit=6&v=${refreshKey}`;
        const trendingUrl = `/api/token/trending-db?limit=12&v=${refreshKey}`;

        const [a1Raw, a2Raw] = await Promise.all([
          fetchJSON(latestUrl, 4000),
          fetchJSON(trendingUrl, 4000),
        ]);

        if (stop) return;

        const latestArr = Array.isArray(a1Raw) ? (a1Raw as Card[]) : [];
        const trendingArr = Array.isArray(a2Raw) ? (a2Raw as Card[]) : [];

        const latestSorted = (() => {
          const arr = [...latestArr];
          const hasTs = arr.some((x) => robustTokenTs(x) > 0);
          return hasTs ? arr.sort((a, b) => robustTokenTs(b) - robustTokenTs(a)) : arr.reverse();
        })();

        let tr = normalizeTrending(trendingArr);
        tr = sortTrending(tr);

        startTransition(() => {
          if (!stop) {
            setLatest(latestSorted);
            setTrending(tr);
          }
        });

        // Small, bounded enrichment for top 4
        const needsLiteEnrich = tr.length > 0 && tr.slice(0, 4).some((x) => (x._tx24 || 0) === 0 && (x._pct == null));
        if (needsLiteEnrich) {
          const head = tr.slice(0, 4);
          const stats = await Promise.all(head.map((t) => enrichOne(t.pool_addr, 2500)));
          head.forEach((t, i) => {
            t._tx24 = stats[i].tx24;
            t._pct = stats[i].pct ?? t._pct ?? null;
          });
          const final = sortTrending([...head, ...tr.slice(4)]);
          if (!stop) setTrending(final);
        }
      } finally {
        if (!stop) setListsBusy(false);
      }
    };

    run();
    return () => { stop = true; };
  // 🔑 rerun whenever refreshKey changes
  }, [refreshKey]);

  /*──────────────────────────────────────────────────────
    Create — close form first so progress overlay shows
  ──────────────────────────────────────────────────────*/
  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);

    const formEl = e.currentTarget;
    const fd = new FormData(formEl);

    const name = String(fd.get("name") || "");
    const symbol = String(fd.get("symbol") || "");
    const imageF = fd.get("image") as File | null;

    const description = String(fd.get("description") || "").slice(0, 500);
    const website = normUrl(String(fd.get("website") || ""));
    const telegram = normUrl(String(fd.get("telegram") || ""));
    const twitter = normUrl(String(fd.get("twitter") || ""));

    setOpenForm(false);
    setWorking({ label: "Starting…", percent: 6, step: "switch" });

    let imageUrl = "";

    try {
      if (Number(creatorFeePct) > 5) throw new Error("Creator fee cannot exceed 5%");

      if (imageF && imageF.size > 0) {
        setWorking({ label: "Uploading image…", percent: 16, step: "upload" });
        const ufd = new FormData();
        ufd.append("file", imageF);
        const up = await fetch("/api/upload/token", { method: "POST", body: ufd });
        const rawUp = await up.text();
        let uj: any = null;
        if (rawUp) { try { uj = JSON.parse(rawUp); } catch {} }
        if (!up.ok) throw new Error((uj && uj.error) || "upload failed");
        imageUrl = uj?.url || "";
      }

      setWorking({ label: "Switching wallet to BSC Testnet (97)…", percent: 28, step: "switch" });

      // Ensure correct chain & get signer (connects if needed)
      const freshSigner = await getFreshSigner();
      const net = await freshSigner.provider?.getNetwork?.();
      const currentChainId = Number(net?.chainId ?? 0);
      assertChainId(currentChainId);

      const fForAssert = factoryContract(true, CHAIN_ID);
      const factoryAddr = String((fForAssert as any).target ?? (fForAssert as any).address ?? "");
      if (factoryAddr) assertAddressAllowed(factoryAddr);

      setWorking({ label: "Creating token & pool… confirm in wallet", percent: 58, step: "create" });
      const { pool, token } = await createTokenAndPoolWithSigner(freshSigner, {
        name,
        symbol,
        creatorFeePercent: creatorFeePct,
        targetCapBNB,
        initialBuyBNB,
        chainId: CHAIN_ID,
      });

      let created_by = (
        typeof window !== "undefined" ? localStorage.getItem("cr:lastAddress") || "" : ""
      ).toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(created_by)) {
        try { created_by = (await freshSigner.getAddress()).toLowerCase(); } catch { created_by = ""; }
      }

      setWorking({ label: "Saving token record…", percent: 82, step: "save" });
      const r = await fetch("/api/token/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token_addr: token,
          pool_addr: pool,
          name,
          symbol,
          image_url: imageUrl,
          created_by,
          description, website, telegram, twitter,
        }),
      });
      const raw = await r.text();
      let j: any = null;
      if (raw) { try { j = JSON.parse(raw); } catch {} }
      if (!r.ok) throw new Error((j && j.error) ? j.error : `record save failed (${r.status})`);

      setWorking({ label: "Created ✓ Redirecting…", percent: 100, step: "done" });
      router.push(`/token-lite/${pool}`);
      try { formEl.reset(); } catch {}
    } catch (e: any) {
      setWorking({ label: "Create failed", percent: 100, step: "error" });
      setStatus("Create failed: " + (e?.message || String(e)));
    } finally {
      setCreating(false);
      setTimeout(() => setWorking(null), 1200);
    }
  }

  /*──────────────────────────────────────────────────────
    Render
  ──────────────────────────────────────────────────────*/
  return (
    <main style={ui.page}>
      {/* Header / Top Bar */}
      <div style={ui.header.wrap}>
        <div style={ui.header.brand}>COINRUSH</div>
        <nav style={ui.header.nav}>
          <a href="/" style={ui.header.navLink}>Home</a>
          <a href="/explore" style={ui.header.navLink}>Explore</a>
          <a href="/create" style={ui.header.navLink}>Create</a>
          <a href="/docs" style={ui.header.navLink}>Docs</a>
        </nav>
        <div style={ui.header.grow} />
        <WalletButton />
      </div>

      {/* Progress Overlay (top, global) */}
      {working && (
        <div
          style={{
            position: "sticky", top: 8, zIndex: 50, marginBottom: 12,
            borderRadius: 12, padding: 10,
            background: "linear-gradient(180deg, rgba(12,19,27,0.9), rgba(9,14,21,0.9))",
            boxShadow: "0 0 0 1px rgba(0,255,255,0.18) inset, 0 10px 28px rgba(0,0,0,0.35)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{ fontWeight: 700 }}>Launching…</div>
            <div style={{ color: "#8aa6c2", fontSize: 13 }}>{working.label}</div>
            <div style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{Math.round(working.percent)}%</div>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: "rgba(0,255,255,0.15)", overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.max(0, Math.min(100, working.percent))}%`,
                height: "100%", borderRadius: 999,
                background: "linear-gradient(90deg, rgba(0,220,255,0.9), rgba(50,255,200,0.9))",
                boxShadow: "0 0 20px rgba(0,240,255,0.35)",
                transition: "width .25s ease",
              }}
            />
          </div>
        </div>
      )}

      {/* Two hero cards */}
      <div style={ui.grid2}>
        {/* LEFT: Create BSC Token */}
        <section style={{ ...ui.card.base, position: "relative" }}>
          {/* Banner (hidden when open) */}
          <div style={{ display: openForm ? "none" : "block" }}>
            <div style={ui.card.title}>Create BSC Token</div>
            <p style={ui.card.subtitle}>
              Launch on BSC with our reployer. One-click liquidity and fair settings.
            </p>
            <ul style={{ display: "grid", gap: 8, margin: "10px 0 16px", padding: 0, listStyle: "none" }}>
              <li style={ui.card.bullet}>✓ Zero-code deploy</li>
              <li style={ui.card.bullet}>✓ Auto verify contract</li>
              <li style={ui.card.bullet}>✓ Liquidity lock helpers</li>
              <li style={ui.card.bullet}>✓ Fair-launch presets</li>
            </ul>
            <button type="button" style={ui.card.btn} onClick={() => setOpenForm(true)}>
              Start on BSC
            </button>
          </div>

          {/* SINGLE FORM INSTANCE — desktop: slide; mobile: overlay */}
          <div
            style={
              isMobile
                ? {
                    display: openForm ? "block" : "none",
                    position: "fixed", inset: 0, zIndex: 100,
                    padding: 12,
                    background: "rgba(9,13,20,0.98)",
                    boxShadow: "0 0 0 1px rgba(0,255,255,0.18) inset, 0 0 30px -12px rgba(0,240,255,0.55)",
                    overflowY: "auto",
                    WebkitOverflowScrolling: "touch",
                    transform: "translateZ(0)",
                  }
                : {
                    overflow: "hidden",
                    transition: hydrated ? "max-height 260ms ease, opacity 220ms ease, transform 220ms ease" : "none",
                    maxHeight: openForm ? 2000 : 0,
                    opacity: openForm ? 1 : 0,
                    transform: openForm ? "translateY(0)" : "translateY(-6px)",
                  }
            }
          >
            <FormContent
              creationFee={creationFee}
              platformFeePct={platformFeePct}
              creatorFeePct={creatorFeePct}
              setCreatorFeePct={setCreatorFeePct}
              initialBuyBNB={initialBuyBNB}
              setInitialBuyBNB={setInitialBuyBNB}
              totalNow={totalBNBNow}
              usdPerBnb={usdPerBnb ?? undefined}
              status={status}
              onCreate={onCreate}
              onClose={() => setOpenForm(false)}
              creating={creating}
            />
          </div>
        </section>

        {/* RIGHT: Create Base Token (static banner) */}
        <section style={ui.card.base}>
          <div style={ui.card.title}>Create Base Token</div>
          <p style={ui.card.subtitle}>
            Want to launch on Base? Use our reployer with one-click liquidity &amp; fair settings.
          </p>
          <ul style={{ display: "grid", gap: 8, margin: "10px 0 16px", padding: 0, listStyle: "none" }}>
            <li style={ui.card.bullet}>✓ Zero code deploy</li>
            <li style={ui.card.bullet}>✓ Auto, verify contract</li>
            <li style={ui.card.bullet}>✓ Liquidity lock helpers</li>
            <li style={ui.card.bullet}>✓ Fair-launch presets</li>
          </ul>
          <button type="button" style={ui.card.btn} onClick={() => { window.location.href = "/base"; }}>
            Start on Base
          </button>
        </section>
      </div>

      {/* Lists */}
      <div style={{ marginTop: 18 }}>
        {/* Latest Tokens */}
        <section style={ui.card.base}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={ui.card.title}>Latest Tokens</div>
            <button
              type="button"
              onClick={() => setRefreshKey(k => k + 1)}
              style={{ ...ui.card.btn, padding: "8px 12px", marginLeft: 10 }}
            >
              Refresh
            </button>
          </div>

          {(listsBusy && latest.length === 0) ? (
            <LoadingStripe label="Fetching latest tokens…" />
          ) : latest.length === 0 ? (
            <LoadingStripe label="No recent tokens yet…" />
          ) : (
            <div style={ui.rowCardsGrid}>
              {latest.map((t) => (
                <LatestCard key={t.pool_addr} t={t} usdPerBnb={usdPerBnb ?? undefined} />
              ))}
            </div>
          )}
        </section>

        {/* Top Trending Tokens */}
        <section style={{ ...ui.card.base, marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={ui.card.title}>Top Trending Tokens</div>
            <button
              type="button"
              onClick={() => setRefreshKey(k => k + 1)}
              style={{ ...ui.card.btn, padding: "8px 12px", marginLeft: 10 }}
            >
              Refresh
            </button>
          </div>

          {(listsBusy && trending.length === 0) ? (
            <LoadingStripe label="Computing trending tokens…" />
          ) : trending.length === 0 ? (
            <LoadingStripe label="No trending tokens yet…" />
          ) : (
            <div style={ui.rowCardsGrid}>
              {trending.map((t) => (
                <TrendingCard key={t.pool_addr} t={t} />
              ))}
            </div>
          )}
        </section>
      </div>

      <div style={{ textAlign: "center", opacity: 0.75, color: "#8aa6c2", fontSize: 12, marginTop: 18 }}>
        Investing in cryptocurrencies involves risks.
      </div>
    </main>
  );
}
