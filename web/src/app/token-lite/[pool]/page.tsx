// src/app/token-lite/[pool]/page.tsx
"use client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";  // extra guard

import React from "react";
import { useParams } from "next/navigation";
import nextDynamic from "next/dynamic";
import styles from "./styles.module.css";
import { useConnectWallet } from "@web3-onboard/react";

// ✅ client-safe base URL helper (call at use sites, not at module top)
function clientBaseUrl() {
  if (typeof window !== "undefined") return window.location.origin;
  return (process.env.NEXT_PUBLIC_DAPP_URL || "").replace(/\/+$/, "") || "";
}

import {
  Snapshot,
  readSnapshot,
  loadTrades,
  loadTopHoldersSafe,
  Trade,
  getProvider,
} from "@/lib/tokenPublic";
import { useBnbUsd } from "@/lib/useBnbUsd";
import { pancakeSwapLink, PANCAKE_V2_ROUTER } from "@/lib/routers";
import {
  Contract,
  formatEther,
  formatUnits,
  parseUnits,
  Interface,
  BrowserProvider,
} from "ethers";
import AddTokenButton from "@/components/AddTokenButton";
import { WalletButton } from "@/components/wallet/WalletButton";

// ——— imports: REPLACED wagmi/RainbowKit with Onboard helpers ———
import { getEthersSigner, ensureChain, getConnectedAddress } from "@/lib/wallet/signing";

// Security preflights
import {
  assertChainId,
  assertAddressAllowed,
  limitApprovalAmount
} from "@/lib/security/wallet-preflight";

// Auto-detect pool buy signature (from old page)
import { detectBuySignature } from "@/lib/poolBuy";

// ✅ live minimum helper (if pool exposes a min buy)
import { findMinBnbInWei } from "@/lib/poolPreview";

// ——— unified fetch error helper ———
async function readErr(r: Response): Promise<string> {
  try {
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const j = await r.json().catch(() => ({} as any));
      return (
        j?.error ??
        j?.message ??
        (Object.keys(j).length ? JSON.stringify(j) : `${r.status} ${r.statusText}`)
      );
    }
    const t = await r.text().catch(() => "");
    return t || `${r.status} ${r.statusText}`;
  } catch {
    return `${r.status} ${r.statusText}`;
  }
}

// --- Local ethers-friendly ABIs (string fragments) ---
const POOL_ABI_RW = [
  // reads
  "function token() view returns (address)",
  "function owner() view returns (address)",
  "function migrated() view returns (bool)",
  "function isMigrated() view returns (bool)",
  "function x0() view returns (uint256)",
  "function y0() view returns (uint256)",
  "function reserveNative() view returns (uint256)",
  "function reserveToken() view returns (uint256)",
  "function targetMarketCapWei() view returns (uint256)",
  "function priceWeiPerToken() view returns (uint256)",
  "function creatorFeeBps() view returns (uint256)",
  "function platformFeeBps() view returns (uint256)",

  // writes / simulations
  "function buy(uint256 minOut) payable returns (uint256)",
  "function sell(uint256 tokenIn, uint256 minOut) returns (uint256)",
  "function migrate(address router, address to) returns (bool)"
] as const;

const ERC20_MIN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
] as const;

/* small utils */

const toBI = (v: number | bigint) => (typeof v === "bigint" ? v : BigInt(Math.trunc(v)));
const RemoteCandlesChart = nextDynamic(() => import("@/components/RemoteCandlesChart"), { ssr: false });

/* helper: works whether getConnectedAddress returns string or Promise<string> */
async function safeConnectedAddress(): Promise<string> {
  try {
    const res = (getConnectedAddress as any)?.();
    const addr = await Promise.resolve(res); // handle sync or async
    return (addr || "").toString();
  } catch {
    return "";
  }
}

// Debug helper (safe in prod; just writes to console)
function logSell(msg: string, extra?: any) {
  try { console.debug(`[SELL] ${msg}`, extra ?? ""); } catch {}
}
/* iOS UA patch */
function patchUserAgentDataForIOS() {
  try {
    const nav: any = typeof navigator !== "undefined" ? navigator : undefined;
    if (!nav) return;
    const hasUAD = "userAgentData" in nav && nav.userAgentData;
    const brandsOk = hasUAD && Array.isArray(nav.userAgentData.brands);
    if (!hasUAD || !brandsOk) {
      Object.defineProperty(nav, "userAgentData", {
        value: {
          brands: [],
          mobile: /Mobi|iP(hone|od|ad)/i.test(nav.userAgent || ""),
          platform: nav.platform || "",
        },
        configurable: true,
      });
    }
  } catch {}
}
/* ───────────────── helpers ───────────────── */
const fmtUSD = (n: number, bigDp = 2, smallDp = 7) =>
  !isFinite(n)
    ? "—"
    : n >= 1
      ? `$${n.toLocaleString(undefined, { maximumFractionDigits: bigDp })}`
      : `$${n.toLocaleString(undefined, { maximumFractionDigits: smallDp })}`;

const fmtBNB = (n: number, maxWhole = 8) => {
  if (!isFinite(n)) return "—";
  if (n === 0) return "0";
  if (Math.abs(n) < 1) return n.toLocaleString(undefined, { maximumFractionDigits: 12 });
  return n.toLocaleString(undefined, { maximumFractionDigits: maxWhole });
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const last6 = (a: string) => (a && a.length >= 6 ? a.slice(-6) : a || "");
const trimZeros = (s: string) => s.replace(/(\.\d*?[1-9])0+$|\.0+$/,"$1");
const cleanDecimalInput = (raw: string) => raw.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
const toUnitsSafe = (raw: string, decimals: number): bigint | null => {
  if (raw === "" || raw === ".") return null;
  try { return parseUnits(raw, decimals); } catch { return null; }
};

/* price from trades */
function tradePriceBNBPerToken(t: Trade): number | null {
  const type = (t as any).type;
  const bIn = Number((t as any).bnbIn || 0);
  const bOut = Number((t as any).bnbOut || 0);
  const tokIn = Number((t as any).tokenIn || 0);
  const tokOut = Number((t as any).tokensOut || 0);
  if (type === "BUY")  { if (tokOut > 0) return bIn  / tokOut; }
  if (type === "SELL") { if (tokIn  > 0) return bOut / tokIn; }
  return null;
}
const tradeTs = (t: any): number => Number(t?.ts ?? t?.time ?? t?.timestamp ?? 0);

/* profiles */
type ProfileEntry = { username?: string; avatar_url?: string; twitter?: string; telegram?: string };
type ProfilesBook = Record<string, ProfileEntry>;
async function fetchProfiles(addrs: string[]): Promise<ProfilesBook> {
  const uniq = Array.from(new Set((addrs || []).map(a => (a || "").toLowerCase()).filter(Boolean)));
  if (!uniq.length) return {};
  try {
    const r = await fetch(`${clientBaseUrl()}/api/profile/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ addresses: uniq }),
      cache: "no-store",
    });
    if (!r.ok) return {};
    const book = await r.json();
    const out: ProfilesBook = {};
    for (const a of uniq) out[a] = book?.[a] || {};
    return out;
  } catch { return {}; }
}
const prettyAddr = (profiles: ProfilesBook, a: string) =>
  profiles[a?.toLowerCase?.()]?.username || short(a);

/* ───────── Chain control / gas helpers ───────── */
function hexChain(chainId: number) { return `0x${Number(chainId).toString(16)}`; }
async function ensureWalletOnChainEIP(signer: any, wantedChainId: number) {
  const prov: any = signer?.provider || (signer as any)?.runner?.provider || null;
  if (!prov) return;
  let current = 0;
  try { const net = await prov.getNetwork?.(); current = Number(net?.chainId ?? 0); } catch {}
  if (current === wantedChainId) return;
  const params = [{ chainId: hexChain(wantedChainId) }];
  try { await prov.send?.("wallet_switchEthereumChain", params); return; } catch {}
  if (wantedChainId === 97) {
    try {
      await prov.send?.("wallet_addEthereumChain", [{
        chainId: "0x61", chainName: "BSC Testnet",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        rpcUrls: ["https://bsc-testnet.publicnode.com"],
        blockExplorerUrls: ["https://testnet.bscscan.com"],
      }]);
      await prov.send?.("wallet_switchEthereumChain", params);
      return;
    } catch {}
  }
  if (wantedChainId === 56) {
    try {
      await prov.send?.("wallet_addEthereumChain", [{
        chainId: "0x38", chainName: "BNB Smart Chain",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        rpcUrls: ["https://bsc-dataseed.binance.org"],
        blockExplorerUrls: ["https://bscscan.com"],
      }]);
      await prov.send?.("wallet_switchEthereumChain", params);
      return;
    } catch {}
  }
  throw new Error("Wrong network in wallet. Please switch to BSC and try again.");
}
// ── Helpers (add once) ──────────────────────────────────────────────
async function readTokenBalance(chainId: number, tokenAddr: string, owner: string): Promise<bigint> {
  try {
    const prov = await getProvider(chainId);
    const erc = new Contract(tokenAddr, ERC20_MIN_ABI, prov) as any;
    return (await erc.balanceOf(owner)) as bigint;
  } catch {
    return 0n;
  }
}

async function waitForAllowanceAtLeast(
  chainId: number,
  tokenAddr: string,
  owner: string,
  spender: string,
  want: bigint,
  timeoutMs = 15000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const a = await getAllowanceOf(chainId, tokenAddr, owner, spender);
    if (a >= want) return true;
    await new Promise(r => setTimeout(r, 700));
  }
  return false;
}
async function getWalletChainId(signer: any): Promise<number | null> {
  try {
    const prov: any = signer?.provider || (signer as any)?.runner?.provider || null;
    const net = await prov?.getNetwork?.();
    return Number(net?.chainId ?? 0) || null;
  } catch { return null; }
}

async function getLegacyGasPrice(prov: any): Promise<bigint> {
  try {
    const fd = await prov?.getFeeData?.();
    const gp = (fd?.gasPrice ?? fd?.maxFeePerGas);
    if (gp != null) return BigInt(gp);
  } catch {}
  try {
    const gp = await prov?.getGasPrice?.();
    if (gp != null) return BigInt(gp);
  } catch {}
  return parseUnits("10", 9);
}

async function ensureEnoughNativeForTx(
  signer: any,
  tx: { to: string; data?: string; value?: bigint; from?: string; chainId: number }
) {
  const prov = signer.provider;
  const from = tx.from || (await signer.getAddress());
  const value = tx.value ?? 0n;
  const gasPrice = await getLegacyGasPrice(prov);
  let gasLimit: bigint = 120_000n;
  try { const est = await prov.estimateGas({ to: tx.to, data: tx.data, value, from }); gasLimit = (est * 12n) / 10n; } catch {}
  const need = gasLimit * gasPrice + value;
  const bal = await prov.getBalance(from);
  if (bal < need) {
    const deficit = Number(need - bal) / 1e18;
    const rounded = Math.max(0.000001, Math.ceil(deficit * 1e6) / 1e6);
    throw new Error(`NEED_NATIVE_GAS:${rounded}`);
  }
  return { gasPrice, gasLimit };
}

function normalizeNativeGasError(e: any, chainSymbol = "BNB") {
  const m = (e?.shortMessage || e?.message || "").toLowerCase();
  if (m.includes("insufficient funds")) return `Insufficient ${chainSymbol} balance for gas fee.`;
  if (typeof e?.message === "string" && e.message.startsWith("NEED_NATIVE_GAS:")) {
    const need = e.message.split(":")[1];
    return `Insufficient ${chainSymbol} for gas. You need about ${need} ${chainSymbol}.`;
  }
  return e?.shortMessage || e?.message || "Transaction failed";
}

/* quotes (buy/sell) */
async function quoteBuy(poolAddr: string, bnbIn: string, chainId: number, tokenDecimals: number) {
  const weiIn = toUnitsSafe(bnbIn, 18);
  if (weiIn == null || weiIn <= 0n) return { tokensOut: 0n, ok: false };

  const provider = await getProvider(chainId);
  const p = new Contract(poolAddr, POOL_ABI_RW, provider) as any;

  try {
    // On-chain sim
    const out: bigint = await p.buy.staticCall(0n, { value: weiIn });
    return { tokensOut: out, ok: out > 0n };
  } catch {
    // CPMM fallback
    try {
      const [rN, rT, x0, y0, cB, pB] = await Promise.all([
        p.reserveNative().catch(() => 0n),
        p.reserveToken().catch(() => 0n),
        p.x0().catch(() => 0n),
        p.y0().catch(() => 0n),
        p.creatorFeeBps?.().catch(() => 0n),
        p.platformFeeBps?.().catch(() => 0n),
      ]);
      const inFeeBps  = Number(cB || 0n) + Number(pB || 0n);
      const effIn   = (weiIn * BigInt(10_000 - inFeeBps)) / 10_000n;
      const k       = (toBI(rN) + toBI(x0)) * (toBI(rT) + toBI(y0));
      const denom   = toBI(rN) + toBI(x0) + toBI(effIn);
      const grossOut = denom !== 0n ? (toBI(rT) + toBI(y0)) - (k / denom) : 0n;
      const netOut = grossOut; // (out-fee can be applied here if needed)
      return { tokensOut: netOut, ok: netOut > 0n };
    } catch { return { tokensOut: 0n, ok: false }; }
  }
}

async function quoteSellOnChain(
  poolAddr: string,
  tokensInStr: string,
  chainId: number,
  from: string | undefined,
  tokenDecimals: number
) {
  const weiIn = toUnitsSafe(tokensInStr, tokenDecimals);
  if (weiIn == null || weiIn <= 0n) return null;

  try {
    const provider = await getProvider(chainId);
    const p = new Contract(poolAddr, POOL_ABI_RW, provider) as any;
    const out: bigint = await p.sell.staticCall(weiIn, 0n, from ? { from } : {});
    const effPrice = (out * (10n ** BigInt(tokenDecimals))) / weiIn; // wei (BNB) per 1 token
    return { bnbOut: out, priceWei: effPrice };
  } catch {
    return null;
  }
}

/* ✅ NEW: Robust ensure — try Web3Onboard ensureChain first, then EIP-1193 fallback via signer */
async function ensureChainRobust(hexId: string, numericId: number) {
  try {
    await ensureChain(hexId);
    return;
  } catch (e: any) {
    const msg = String(e?.message || e).toLowerCase();
    if (msg.includes("invalid network") || msg.includes("chainid") || msg.includes("unknown chain")) {
      // Fallback to direct EIP-1193 flow via current signer/provider
      const signer = await getEthersSigner();
      await ensureWalletOnChainEIP(signer, numericId);
      return;
    }
    throw e;
  }
}


/* ✅ NEW: probe a working minimum buy when pool doesn't expose a min */
async function findWorkingMinBuyWeiByProbe(
  poolAddr: string,
  chain: number,
  {
    lower = 1_000_000_000_000n,       // 0.000001 BNB
    upper = 200_000_000_000_000_000n, // 0.2 BNB ceiling
    steps = 16,                        // ~log2 range
  }: { lower?: bigint; upper?: bigint; steps?: number } = {}
): Promise<bigint> {
  const ro = await getProvider(chain);
  const pool = new Contract(poolAddr, POOL_ABI_RW, ro) as any;

  try {
    const ok = await pool.buy.staticCall(0n, { value: lower }).then((out: bigint) => out > 0n).catch(() => false);
    if (ok) return lower;
  } catch {}

  let lo = lower, hi = upper, ans = -1n;
  for (let i = 0; i < steps; i++) {
    const mid = lo + ((hi - lo) >> 1n);
    try {
      const out: bigint = await pool.buy.staticCall(0n, { value: mid });
      if (out > 0n) { ans = mid; hi = mid; } else { lo = mid + 1n; }
    } catch {
      lo = mid + 1n;
    }
    if (lo >= hi) break;
  }
  return ans; // -1n if nothing worked up to `upper`
}

/* allowance helpers */
const MAX_UINT256 = (1n << 256n) - 1n;
async function getAllowanceOf(chainId: number, tokenAddr: string, owner: string, spender: string): Promise<bigint> {
  try {
    const prov = await getProvider(chainId);
    const erc = new Contract(tokenAddr, ERC20_MIN_ABI, prov) as any;
    return (await erc.allowance(owner, spender)) as bigint;
  } catch { return 0n; }
}
async function ensureAllowanceIfNeeded(opts: {
  tokenAddr: string;
  owner: string;
  spender: string;
  signer: any;
  want: bigint;             // amount needed for this sell
  grant?: bigint;           // how much we grant; defaults to a safe cap
  onStatus?: (s: string) => void;
  chainId?: number;
}) {
  const { tokenAddr, owner, spender, signer, want, grant, onStatus, chainId } = opts;

  // ✅ Preflights
  assertAddressAllowed(tokenAddr);
  assertAddressAllowed(spender);
  if (chainId != null) assertChainId(chainId);

  const prov = signer.provider;
  const erc  = new Contract(tokenAddr, ERC20_MIN_ABI, signer) as any;
  const iface = new Interface(ERC20_MIN_ABI);

  onStatus?.("checking-allowance");

  const wantSafe  = limitApprovalAmount(want);
  const grantSafe = limitApprovalAmount(grant ?? wantSafe);

  let current: bigint = 0n;
  try { current = await erc.allowance(owner, spender); } catch {}

  if (current >= wantSafe) {
    onStatus?.("allowance-ok");
    return false; // no tx sent
  }

  // Small helpers
  const gasPrice = await getLegacyGasPrice(prov);
  const mkGas = async (data: string, value: bigint = 0n) => {
    try {
      const est = await prov.estimateGas({ to: tokenAddr, data, from: owner, value });
      return (est * 12n) / 10n;
    } catch {
      return 60_000n;
    }
  };
  const send = async (data: string) => {
    const gasLimit = await mkGas(data);
    await ensureEnoughNativeForTx(signer, { to: tokenAddr, data, value: 0n, from: owner, chainId: chainId ?? 97 });
    const tx = await signer.sendTransaction({
      to: tokenAddr, data, value: 0n, type: 0, gasPrice, gasLimit, chainId: chainId ?? 97,
    });
    await tx.wait();
  };

  // Path A: from ZERO → non-zero (single approve; no revoke)
  if (current === 0n) {
    onStatus?.("approving");
    await send(iface.encodeFunctionData("approve", [spender, grantSafe]));
    onStatus?.("approved");
    return true;
  }

  // Path B: current > 0n — try direct increase via staticCall
  let canIncreaseDirect = false;
  try {
    await erc.approve.staticCall(spender, grantSafe);
    canIncreaseDirect = true;
  } catch {}

  if (canIncreaseDirect) {
    onStatus?.("approving");
    await send(iface.encodeFunctionData("approve", [spender, grantSafe]));
    onStatus?.("approved");
    return true;
  }

  // Two-step required
  onStatus?.("allowance-revoke-then-approve");
  onStatus?.("approving");
  try {
    await send(iface.encodeFunctionData("approve", [spender, 0n]));
  } catch {
    // last resort: grant exactly what we need
    await send(iface.encodeFunctionData("approve", [spender, wantSafe]));
    onStatus?.("approved");
    return true;
  }
  await send(iface.encodeFunctionData("approve", [spender, grantSafe]));
  onStatus?.("approved");
  return true;
}

/* ───────────────── component ───────────────── */
export default function PublicTokenLitePage() {
  const params = useParams() as { pool?: string } | null;
  const pool = params?.pool ?? "";
  const poolAddr = String(pool);

  // Chain from env (97 default). We'll derive pool chain kind from it.
  const chain = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID || 97);
  const poolChain: "bsc" | "base" = [56, 97].includes(chain) ? "bsc" : "base";

  const NEWS_ADMIN = (process.env.NEXT_PUBLIC_NEWS_ADMIN || "").toLowerCase();

  // Connection state (Onboard)
  const [addr, setAddr] = React.useState<string>("");
  const [isConnected, setIsConnected] = React.useState<boolean>(false);

  // Onboard connection state → keep `addr` / `isConnected` updated
  const [{ wallet }] = useConnectWallet();
  React.useEffect(() => {
    const a = (wallet?.accounts?.[0]?.address || "").toLowerCase();
    setAddr(a);
    setIsConnected(!!a);
    try { if (a) localStorage.setItem("cr:lastAddress", a); } catch {}
  }, [wallet]);

  // price + metadata states
  const bnbUsd = useBnbUsd();
  const usdPerBnb = bnbUsd ?? Number(process.env.NEXT_PUBLIC_USD_PER_BNB_FALLBACK || "500");

  const [snap, setSnap] = React.useState<Snapshot | null>(null);
  const [meta, setMeta] = React.useState<{
    name?: string;
    image_url?: string;
    migrated?: boolean;
    created_by?: string;
    description?: string;
    website?: string;
    telegram?: string;
    twitter?: string;
    symbol?: string;
  } | null>(null);

  const [trades, setTrades] = React.useState<Trade[]>([]);
  const [holders, setHolders] = React.useState<Array<{ address: string; balance: string; pct: number }>>([]);
  const [profiles, setProfiles] = React.useState<ProfilesBook>({});
  const [walletBnb, setWalletBnb] = React.useState<number | null>(null);
  const [walletTokenStr, setWalletTokenStr] = React.useState<string>("");
  const [busyWallet, setBusyWallet] = React.useState(false);

  const [mounted, setMounted] = React.useState(false);
  const [viewerAddrForBtn, setViewerAddrForBtn] = React.useState<string>("");
  const [hasProfile, setHasProfile] = React.useState<boolean>(false);
  const viewer = mounted ? (typeof window !== "undefined" ? (localStorage.getItem("cr:lastAddress") || "") : "") : "";

  const [uaPatched, setUaPatched] = React.useState(false);
  const [delta24h, setDelta24h] = React.useState<number | null>(null);

  // BUY/SELL form state
  const [buyBnb, setBuyBnb] = React.useState("");
  const [buyOut, setBuyOut] = React.useState<string>("");
  const [buying, setBuying] = React.useState(false);
  const [buyMsg, setBuyMsg] = React.useState("");

  const [sellTokens, setSellTokens] = React.useState("");
  const [sellQuote, setSellQuote] = React.useState<{ price: number | null; net: number | null }>({ price: null, net: null });
  const [selling, setSelling] = React.useState(false);
  const [sellMsg, setSellMsg] = React.useState("");

  const [migrating, setMigrating] = React.useState(false);
  const [migMsg, setMigMsg] = React.useState("");

  /* ───── Global News state (from token-lite) ───── */
  type NewsItem = { id: number; body: string; created_at: number; created_by: string };
  const [news, setNews] = React.useState<NewsItem[]>([]);
  const [newsOpen, setNewsOpen] = React.useState(false);
  const [newsBody, setNewsBody] = React.useState("");
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [authHint, setAuthHint] = React.useState<string>("");

  // Track connected address (additional mount tasks + UA patch)
  React.useEffect(() => {
    setMounted(true);
    patchUserAgentDataForIOS();
    setUaPatched(true);

    (async () => {
      const a = await safeConnectedAddress();
      const lower = a ? a.toLowerCase() : "";
      // Don't override isConnected here; Onboard effect above is source of truth.
      setAddr((prev) => prev || lower);
      try { localStorage.setItem("cr:lastAddress", lower || ""); setViewerAddrForBtn(last6(lower)); } catch {}
    })();

    const checkResize = () => document?.documentElement && null;
    window.addEventListener("resize", checkResize);
    return () => window.removeEventListener("resize", checkResize);
  }, []);

  const isNewsAdmin = !!addr && addr.toLowerCase() === NEWS_ADMIN;

  const fetchNews = React.useCallback(async () => {
    try {
      const r = await fetch(`${clientBaseUrl()}/api/news?pool=${poolAddr}`, { cache: "no-store" });
      const j = await r.json();
      setNews(Array.isArray(j) ? j : []);
    } catch {}
  }, [poolAddr]);

  // 2) POST/PUT include pool + x-addr
  async function submitNews() {
    try {
      const a = (await safeConnectedAddress())?.toLowerCase() || addr || "";
      if (!a) { alert("Connect wallet first"); return; }
      const method = editingId ? "PUT" : "POST";
      const payload = editingId
        ? { id: editingId, body: newsBody, pool: poolAddr }
        : { body: newsBody, pool: poolAddr };
      const r = await fetch(`${clientBaseUrl()}/api/news`, {
        method,
        headers: { "content-type": "application/json", "x-addr": a },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await readErr(r));

      setNewsBody(""); setEditingId(null); setNewsOpen(false); setAuthHint("");
      await fetchNews();
    } catch (e: any) {
      alert(e?.message || "Failed");
    }
  }

  async function deleteNews(id: number) {
    try {
      const a = (await safeConnectedAddress())?.toLowerCase() || addr || "";

      if (!a) { setAuthHint("Connect wallet first"); return; }

      const r = await fetch(`${clientBaseUrl()}/api/news`, {
        method: "DELETE",
        headers: { "content-type": "application/json", "x-addr": a },
        body: JSON.stringify({ id }),
      });

      if (!r.ok) {
        if (r.status === 401 || r.status === 403) {
          setAuthHint("You’re not authorized. Only the news admin can delete.");
        }
        throw new Error(await readErr(r));
      }
      await fetchNews();
    } catch (e: any) {
      alert(e?.message || "Delete failed");
    }
  }

  const checkProfile = React.useCallback(async (addressLower?: string) => {
    const a = (addressLower || addr || viewer || "").toLowerCase();
    if (!a) { setHasProfile(false); return; }
    try {
      const r = await fetch(`${clientBaseUrl()}/api/profile/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses: [a] }),
        cache: "no-store",
      });
      if (!r.ok) { setHasProfile(false); return; }
      const book = await r.json();
      const p = book?.[a];
      setHasProfile(!!p && !!(p.username || p.avatar_url || p.twitter || p.telegram));
    } catch { setHasProfile(false); }
  }, [addr, viewer]);

  /* mount + responsive */
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const check = () => setIsMobile(window.matchMedia("(max-width: 980px)").matches);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // snapshot + metadata
  React.useEffect(() => {
    (async () => {
      if (!poolAddr) return;
      try {
        const s = await readSnapshot(poolAddr, chain);
        setSnap(s);

        let j: any = {};
        try { j = await fetch(`${clientBaseUrl()}/api/pool/meta?pool=${poolAddr}&chain=${chain}`).then(r => r.json()).catch(() => ({})); } catch {}
        let migrated = Boolean(j?.migrated);
        let created_by = (j?.created_by || "").toLowerCase();

        // try onchain migrated
        try {
          const ro = await getProvider(chain);
          const poolC = new Contract(poolAddr, POOL_ABI_RW, ro) as any;
          if (typeof poolC.isMigrated === "function") {
            const onchainMigrated = await poolC.isMigrated().catch(() => false);
            if (typeof onchainMigrated === "boolean") migrated = onchainMigrated;
          }
        } catch {}

        setMeta({
          name: j?.name,
          image_url: j?.image_url,
          migrated,
          created_by,
          description: j?.description,
          website: j?.website,
          telegram: j?.telegram,
          twitter: j?.twitter,
          symbol: j?.symbol || s?.symbol,
        });

        // defer heavy lists
        setTimeout(async () => {
          try {
            const t = await loadTrades(poolAddr, chain, s.tokenDecimals);
            setTrades(t);

            const addrs = new Set<string>();
            if (created_by) addrs.add(created_by);
            t.forEach(x => (x as any).addr && addrs.add((x as any).addr));

            const h = await loadTopHoldersSafe(poolAddr, chain, s.token, s.totalSupply, [...addrs], s.tokenDecimals);
            setHolders(h.holders);

            const allAddrs = new Set<string>([...addrs]);
            (h.holders || []).forEach((hh: any) => hh?.address && allAddrs.add(String(hh.address).toLowerCase()));
            const book = await fetchProfiles([...allAddrs]);
            setProfiles(book);
          } catch {}
        }, 0);
      } catch (e) { console.error(e); }
    })();
  }, [poolAddr, chain]);
  // refresh trades/holders
  React.useEffect(() => {
    if (!poolAddr || !snap) return;
    let tick = 0, stop = false;
    const run = async () => {
      if (stop) return;
      try {
        const t = await loadTrades(poolAddr, chain, snap.tokenDecimals);
        setTrades(prev => (prev.length && t.length && (prev as any)[0].tx === (t as any)[0].tx) ? prev : t);
        tick++;
        if (tick % 4 === 0) {
          const base = new Set<string>(t.map((x: any) => (x.addr || "").toLowerCase()).filter(Boolean));
          const h = await loadTopHoldersSafe(poolAddr, chain, snap.token, snap.totalSupply, [...base], snap.tokenDecimals);
          setHolders(h.holders);
        }
      } catch {}
    };
    const id = setInterval(run, 15000);
    run();
    return () => { stop = true; clearInterval(id); };
  }, [poolAddr, chain, snap]);

  // periodic snapshot refresh
  React.useEffect(() => {
    if (!poolAddr) return;
    let stop = false;
    const id = setInterval(async () => {
      if (stop) return;
      try { const s = await readSnapshot(poolAddr, chain); setSnap((prev) => (prev && s && prev.pWei === s.pWei ? prev : s)); } catch {}
    }, 30000);
    return () => { stop = true; clearInterval(id); };
  }, [poolAddr, chain]);

  // balances (use connected address via Onboard)
  const refreshWallet = async () => {
    if (!snap?.token) return;
    try {
      setBusyWallet(true);
      const prov = await getProvider(chain);
      const address =
        (await safeConnectedAddress())?.toLowerCase() ||
        (typeof window !== "undefined" ? (localStorage.getItem("cr:lastAddress") || "").toLowerCase() : "");
      if (!address) { setWalletBnb(null); setWalletTokenStr(""); return; }
      const [bnbWei, tokenWei] = await Promise.all([
        prov.getBalance(address),
        (new Contract(snap.token, ERC20_MIN_ABI, prov) as any).balanceOf(address),
      ]);
      setWalletBnb(Number(formatEther(bnbWei)));
      setWalletTokenStr(formatUnits(tokenWei, snap.tokenDecimals));
      setAddr(address);
      setIsConnected(!!address);
      try { localStorage.setItem("cr:lastAddress", address); setViewerAddrForBtn(last6(address)); } catch {}
    } catch { setWalletBnb(null); setWalletTokenStr(""); }
    finally { setBusyWallet(false); }
  };
  React.useEffect(() => { if (snap?.token) refreshWallet(); }, [snap?.token, snap?.tokenDecimals, chain]); // eslint-disable-line

  // ✅ buy preview (+ live minimum read)
  React.useEffect(() => {
    (async () => {
      if (!snap) { setBuyOut(""); return; }
      if (!buyBnb || buyBnb === ".") { setBuyOut(""); setBuyMsg(""); return; }

      const q = await quoteBuy(poolAddr, buyBnb, chain, snap.tokenDecimals);
      if (q.ok) setBuyOut(formatUnits(q.tokensOut, snap.tokenDecimals)); else setBuyOut("");

      // live min from pool if exposed; otherwise probe
      try {
        let minIn = -1n;
        try {
          const x = await findMinBnbInWei(poolAddr);
          minIn = typeof x === "bigint" ? x : -1n;
        } catch {}
        if (minIn === -1n) {
          minIn = await findWorkingMinBuyWeiByProbe(poolAddr, chain);
        }
        if (minIn !== -1n) {
          setBuyMsg(minIn > 0n ? `Minimum right now: ${(Number(minIn)/1e18).toFixed(6)} BNB` : "");
        }
      } catch {}
    })();
  }, [snap, buyBnb, poolAddr, chain]);

  // ✅ periodic min refresh
  React.useEffect(() => {
    if (!poolAddr) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        let minIn = -1n;
        try {
          const x = await findMinBnbInWei(poolAddr);
          minIn = typeof x === "bigint" ? x : -1n;
        } catch {}
        if (minIn === -1n) {
          minIn = await findWorkingMinBuyWeiByProbe(poolAddr, chain);
        }
        if (minIn !== -1n) {
          setBuyMsg(minIn > 0n ? `Minimum right now: ${(Number(minIn)/1e18).toFixed(6)} BNB` : "");
        }
      } catch {}
    };
    const id = setInterval(tick, 12000);
    tick();
    return () => { stop = true; clearInterval(id); };
  }, [poolAddr, chain]);

  // sell preview
  React.useEffect(() => {
    (async () => {
      if (!snap) { setSellQuote({ price: null, net: null }); return; }
      if (!sellTokens || sellTokens === ".") { setSellQuote({ price: null, net: null }); return; }
      const me = (await safeConnectedAddress())?.toLowerCase() || addr || undefined;
      const q = await quoteSellOnChain(poolAddr, sellTokens, chain, me, snap.tokenDecimals);
      if (q) {
        const netPrice = Number(q.priceWei) / 1e18;
        const netBnb   = Number(q.bnbOut)  / 1e18;
        setSellQuote({ price: netPrice, net: netBnb });
      } else setSellQuote({ price: null, net: null });
    })();
  }, [snap, sellTokens, poolAddr, chain, addr]);

  // 24h delta
  React.useEffect(() => {
    if (!(trades as any)?.length) { setDelta24h(null); return; }
    const cutoff = Math.floor(Date.now() / 1000) - 24 * 3600;
    const latestFromTrade = tradePriceBNBPerToken((trades as any)[0]);
    let firstInWindow: number | null = null;
    let lastInWindow: number | null = null;
    for (let i = (trades as any).length - 1; i >= 0; i--) {
      const ts = tradeTs((trades as any)[i]);
      if (ts && ts >= cutoff) {
        const p = tradePriceBNBPerToken((trades as any)[i]);
        if (p != null) {
          if (firstInWindow == null) firstInWindow = p;
          lastInWindow = p;
        }
      }
    }
    if (firstInWindow != null && lastInWindow != null && firstInWindow > 0) {
      setDelta24h((lastInWindow / firstInWindow - 1) * 100);
    } else { setDelta24h(null); }
    if (latestFromTrade != null && snap) {
      const newPwei = BigInt(Math.floor(latestFromTrade * 1e18));
      if (newPwei !== snap.pWei) setSnap({ ...snap, pWei: newPwei });
    }
  }, [trades]); // eslint-disable-line

  // compute hex chain id once from numeric `chain` (e.g. 97 -> "0x61")
  const chainHexId = React.useMemo(() => `0x${Number(chain || 0).toString(16)}`, [chain]);

  /* ACTIONS: buy/sell/migrate — Onboard ensureChain + getEthersSigner */
  const onBuy = async () => {
    if (!snap) return;
    setBuying(true); setBuyMsg("");
    try {
      // 🔒 ensure correct network in wallet (HEX string!)
      await ensureChainRobust(chainHexId, chain);

      // ✅ always fetch signer AFTER ensureChain so the wallet is ready
      const freshSigner = await getEthersSigner();

      // (optional) extra safety
      await ensureWalletOnChainEIP(freshSigner, chain);
      const ch = await getWalletChainId(freshSigner);

      // ✅ Preflight
      assertChainId(ch ?? 0);
      assertAddressAllowed(poolAddr);
      if (ch !== chain) { setBuyMsg("Wrong network in wallet."); return; }

      const weiIn = toUnitsSafe(buyBnb, 18);
      if (weiIn == null || weiIn <= 0n) { setBuyMsg("Enter a valid BNB amount."); return; }

      // live/probed minimum
      let minIn = -1n;
      try {
        const x = await findMinBnbInWei(poolAddr);
        minIn = typeof x === "bigint" ? x : -1n;
      } catch {}
      if (minIn === -1n) minIn = await findWorkingMinBuyWeiByProbe(poolAddr, chain);
      if (minIn !== -1n && weiIn < minIn) {
        setBuyMsg(`Amount too small right now. Minimum that works is ~${(Number(minIn)/1e18).toFixed(6)} BNB. Try a larger amount.`);
        return;
      }

      // Slippage via on-chain preview
      const preview = await quoteBuy(poolAddr, buyBnb, chain, snap.tokenDecimals);
      if (!preview.ok || preview.tokensOut <= 0n) { setBuyMsg("Amount too small or pool can’t quote."); return; }
      const slippageBps = 500n; // 5%
      const minOut = (preview.tokensOut * (10_000n - slippageBps)) / 10_000n;

      // ❶ Try signature-aware detector first
      try {
        const meAddr = (await freshSigner.getAddress()).toLowerCase();
        const det: any = await detectBuySignature(poolAddr, meAddr);
        const rc = await det.buy(minOut, weiIn); // handles overrides
        await rc?.wait?.();
        setBuyMsg("Buy sent ✅");
      } catch (e: any) {
        const m = (e?.shortMessage || e?.message || "").toLowerCase();
        if (m.includes("could not find a compatible buy")) {
          // ❷ Fallback to manual tx
          const iface = new Interface(POOL_ABI_RW);
          const data = iface.encodeFunctionData("buy", [minOut]);
          const from = (await freshSigner.getAddress()).toLowerCase();

          const { gasPrice, gasLimit } = await ensureEnoughNativeForTx(freshSigner, {
            to: poolAddr, data, value: weiIn, from, chainId: chain,
          });

          const tx = await freshSigner.sendTransaction({
            to: poolAddr, data, value: weiIn, type: 0, gasPrice, gasLimit, chainId: chain,
          });
          await tx.wait();
          setBuyMsg("Buy sent ✅");
        } else if (m.includes("insufficient") || m.includes("slippage")) {
          setBuyMsg("Trade reverted: not enough output for this amount. Try a larger amount or lower slippage.");
          return;
        } else if (m.includes("user rejected")) {
          setBuyMsg("Transaction cancelled in wallet.");
          return;
        } else {
          // Minimal fallback
          try {
            const pool = new Contract(poolAddr, POOL_ABI_RW, freshSigner) as any;
            const tx = await pool.buy(minOut, { value: weiIn });
            await tx.wait();
            setBuyMsg("Buy sent ✅");
          } catch (e2: any) {
            const msg = normalizeNativeGasError(e2, "BNB");
            setBuyMsg(msg);
            return;
          }
        }
      }

      await refreshWallet();
      const t = await loadTrades(poolAddr, chain, snap.tokenDecimals);
      setTrades(t);
    } catch (e: any) {
      const msg = normalizeNativeGasError(e, "BNB");
      if (/revert|reverted/i.test(e?.message || "")) {
        setBuyMsg("Pool rejected the transaction (slippage/liquidity?). Try a smaller amount.");
      } else {
        setBuyMsg(msg);
      }
    } finally { setBuying(false); }
  };

// ── DROP-IN replacement for onSell ──────────────────────────────────
const onSell = async () => {
  if (!snap) return;
  setSelling(true);
  setSellMsg("");

  try {
    // 1) Make sure wallet is on correct chain and get signer from Onboard
    const chainHexId = `0x${Number(chain).toString(16)}`;
    await ensureChain(chainHexId);
    const freshSigner = await getEthersSigner();
    await ensureWalletOnChainEIP(freshSigner, chain);

    const ch = await getWalletChainId(freshSigner);
    assertChainId(ch ?? 0);
    assertAddressAllowed(poolAddr);
    if (ch !== chain) { setSellMsg("Wrong network in wallet."); return; }

    const owner = (await freshSigner.getAddress()).toLowerCase();

    // 2) Parse input → wei
    const wantWei = toUnitsSafe(sellTokens, snap.tokenDecimals);
    if (wantWei == null || wantWei <= 0n) { setSellMsg("Enter a valid token amount."); return; }

    // 3) Quick balance check (user feedback if too much)
    const bal = await readTokenBalance(chain, snap.token, owner);
    if (bal < wantWei) {
      setSellMsg(`You only have ${formatUnits(bal, snap.tokenDecimals)} ${snap.symbol}.`);
      return;
    }

    // 4) Allowance: top up if needed, then wait until indexed
    let allowance = await getAllowanceOf(chain, snap.token, owner, poolAddr);
    if (allowance < limitApprovalAmount(wantWei)) {
      setSellMsg("Approving spending cap…");
      await ensureAllowanceIfNeeded({
        tokenAddr: snap.token,
        owner,
        spender: poolAddr,
        signer: freshSigner,
        want: wantWei,
        chainId: chain,
        onStatus: (s) => {
          // show friendly messages while approving
          if (s === "allowance-revoke-then-approve") {
            setSellMsg("Resetting old allowance, then approving…");
          } else if (s === "approved") {
            setSellMsg("Approval confirmed. Preparing sell…");
          } else {
            setSellMsg(s.replace(/-/g, " "));
          }
        },
      });

      // poll for allowance to reflect
      const ok = await waitForAllowanceAtLeast(chain, snap.token, owner, poolAddr, limitApprovalAmount(wantWei), 15000);
      if (!ok) {
        // still proceed, but let the user know it may be a subgraph/indexing lag
        setSellMsg("Approval broadcast. If the next step reverts, wait a few seconds and try again.");
      }
      allowance = await getAllowanceOf(chain, snap.token, owner, poolAddr);
    }

    // 5) Try a light-weight precheck (estimateGas). If it throws, show reason
    const pool = new Contract(poolAddr, POOL_ABI_RW, freshSigner) as any;
    try {
      // some pools require from override in simulation
      await pool.sell.estimateGas?.(wantWei, 0n, { from: owner });
    } catch (e: any) {
      const m = (e?.shortMessage || e?.message || "").toLowerCase();
      if (m.includes("insufficient allowance")) {
        setSellMsg("The token still reports low allowance. Wait a bit and try again.");
        return;
      }
      if (m.includes("insufficient balance")) {
        setSellMsg("Not enough token balance to sell that amount.");
        return;
      }
      // Generic guidance
      setSellMsg("That amount would revert right now (liquidity/slippage/fees). Try a smaller amount.");
      return;
    }

    // 6) Send the sell tx (legacy type-0 for better compatibility)
    const iface = new Interface(POOL_ABI_RW);
    const data = iface.encodeFunctionData("sell", [wantWei, 0n]);
    const { gasPrice, gasLimit } = await ensureEnoughNativeForTx(freshSigner, {
      to: poolAddr, data, value: 0n, from: owner, chainId: chain,
    });

    const tx = await freshSigner.sendTransaction({
      to: poolAddr,
      data,
      value: 0n,
      type: 0,
      gasPrice,
      gasLimit,
      chainId: chain,
    });
    await tx.wait();

    setSellMsg("Sell sent ✅");
    await refreshWallet();
    const t = await loadTrades(poolAddr, chain, snap.tokenDecimals);
    setTrades(t);
  } catch (e: any) {
    const msg = normalizeNativeGasError(e, "BNB");
    setSellMsg(msg || "Sell failed");
  } finally {
    setSelling(false);
  }
};

  
  const onMigrateClick = React.useCallback(async () => {
    if (!snap) return;
    setMigrating(true); setMigMsg("Migrating… check your wallet");
    try {
      await ensureChainRobust(chainHexId, chain);
      const freshSigner = await getEthersSigner();
      await ensureWalletOnChainEIP(freshSigner, chain);
      const ch = await getWalletChainId(freshSigner);

      // ✅ Preflight
      assertChainId(ch ?? 0);
      assertAddressAllowed(poolAddr);

      const from = (await freshSigner.getAddress()).toLowerCase();

      const iface = new Interface(POOL_ABI_RW);
      const routerAddr = PANCAKE_V2_ROUTER[chain] ?? PANCAKE_V2_ROUTER[97];
      const data = iface.encodeFunctionData("migrate", [routerAddr, from]);

      const { gasPrice, gasLimit } = await ensureEnoughNativeForTx(freshSigner, {
        to: poolAddr, data, value: 0n, from, chainId: chain,
      });

      const tx = await freshSigner.sendTransaction({
        to: poolAddr, data, value: 0n, type: 0, gasPrice, gasLimit, chainId: chain,
      });
      const rc = await tx.wait();
      setMigMsg(`Migrated ✅ tx=${rc?.hash ?? tx.hash}`);
    } catch (e: any) {
      const msg = normalizeNativeGasError(e, "BNB");
      setMigMsg(msg);
    } finally { setMigrating(false); }
  }, [snap, chain, poolAddr, chainHexId]);

  /* derived */
  const priceBnbPerToken = snap ? Number(snap.pWei) / 1e18 : null;
  const priceUsdPerToken = priceBnbPerToken != null ? priceBnbPerToken * usdPerBnb : null;
  const mcapBNB = snap ? Number(snap.mcWei) / 1e18 : null;
  const mcapUSD = mcapBNB != null ? mcapBNB * usdPerBnb : null;
  const progress = snap && snap.tCapWei > 0n ? Math.min(100, (Number(snap.mcWei) / Number(snap.tCapWei)) * 100) : 0;
  const isOwner = !!addr && !!snap && (addr.toLowerCase() === (snap.creator || "").toLowerCase() || addr.toLowerCase() === (snap.owner || "").toLowerCase());
  const migrated = Boolean(meta?.migrated);
  const creatorAddr = (meta?.created_by || snap?.creator || "").toLowerCase();
  const creatorName = creatorAddr ? (profiles[creatorAddr]?.username || prettyAddr(profiles, creatorAddr)) : "";

  const tokenSymbol = meta?.symbol || snap?.symbol || "TOKEN";
  const tokenFullName = meta?.name || (snap ? `${snap.symbol} Token` : "");

  return (
    <main className={styles.wrap}>
      {/* top bar */}
      <div className="topBar">
        <a href="/" className="linkPlain" style={{ color: "#fff" }}>Home</a>
        <div className="fill" />
        <div className="siteTitle">Coinrush</div>
      </div>

      {/* NEWS BAR (with fixed Manage visibility + mirror gap) */}
      <div
        className="newsBar"
        style={{
          ['--marquee-speed' as any]: '55s',
          ['--start-gap' as any]: '100%',
          ['--loop-gap' as any]: '40vw',
        }}
      >
        <div className="flash">⚡</div>

        <div
          className="newsMarquee"
          title={(news && news.length ? news.map(n => n.body).join('  •  ') : 'No news yet.')}
        >
          <div className="newsTrack">
            {/* first copy (always) */}
            <span className="newsChunk">
              {news && news.length ? (
                news.map((n, i) => (
                  <span key={`a-${n.id}`} className="newsItem">
                    {n.body}{i < news.length - 1 ? ' • ' : ''}
                  </span>
                ))
              ) : (
                <span className="dim">No news yet.</span>
              )}
            </span>

            {/* mirror copy */}
            <span className="newsChunk mirror" aria-hidden="true">
              {news && news.length ? (
                news.map((n, i) => (
                  <span key={`b-${n.id}`} className="newsItem">
                    {n.body}{i < news.length - 1 ? ' • ' : ''}
                  </span>
                ))
              ) : (
                <span className="dim">No news yet.</span>
              )}
            </span>
          </div>
        </div>

        <div className="newsActions">
          {isConnected && isNewsAdmin && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhostSm}`}
              onClick={() => setNewsOpen(true)}
              title="Manage news"
            >
              Manage
            </button>
          )}
        </div>
      </div>

      {/* header */}
      <div className={styles.header}>
        <div className={styles.brand}>
          <img
            src={meta?.image_url || "/token-placeholder.png"}
            alt="token"
            width={44} height={44}
            className={styles.logoImg}
            onError={(e) => {
              const img = e.currentTarget as HTMLImageElement;
              if (img.src !== (typeof window !== "undefined" ? window.location.origin : "") + "/token-placeholder.png")
                img.src = "/token-placeholder.png";
            }}
          />
          <div>
            <div className={styles.brandTitle}>{tokenSymbol}</div>

            {/* creator */}
            {creatorAddr && (
              <div className={styles.byline}>
                by <a href={`/u/${creatorAddr}`}>{creatorName}</a>
              </div>
            )}

            {/* Desktop inline meta */}
            {!isMobile && (
              <div className="metaLine">
                {meta?.description && <span className="desc">{meta.description}</span>}
                <div className="links">
                  {meta?.website && (
                    <a className="pill" href={meta.website} target="_blank" rel="noopener noreferrer nofollow">Website</a>
                  )}
                  {meta?.telegram && (
                    <a className="pill" href={meta.telegram} target="_blank" rel="noopener noreferrer nofollow">Telegram</a>
                  )}
                  {meta?.twitter && (
                    <a className="pill" href={meta.twitter} target="_blank" rel="noopener noreferrer nofollow">Twitter</a>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={styles.headerActions}>
          <a
            href="/me"
            className={`${styles.btn} ${styles.btnGhost} linkPlain`}
            data-viewer={viewerAddrForBtn || undefined}
            title={addr ? `Connected: …${last6(addr)}` : undefined}
          >
            Profile
          </a>
          <WalletButton />
          {snap?.token && migrated && (
            <a
              href={pancakeSwapLink(chain, snap.token, "buy")}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={`${styles.btn} ${styles.btnBuy}`}
            >
              Buy on Pancake
            </a>
          )}
        </div>
      </div>

      {/* stats + chart */}
      <div className={styles.row}>
        <div className={`${styles.card} ${styles.metrics}`}>
          <div className={styles.priceBlock}>
            {tokenFullName ? <div className="smallName">{tokenFullName}</div> : null}

            <div className={styles.bigPrice}>{priceUsdPerToken != null ? `${fmtUSD(priceUsdPerToken)}` : "—"}</div>
            <div className={styles.delta}>
              24h Δ{" "}
              {delta24h == null ? <span className={styles.dim}>—</span>
                : delta24h >= 0 ? <span className={styles.deltaUp}>+{delta24h.toFixed(2)}%</span>
                : <span className={styles.deltaDown}>{delta24h.toFixed(2)}%</span>}
            </div>
            <div className={styles.inlineStat}><span>Market Cap:</span><b>{mcapUSD != null ? fmtUSD(mcapUSD) : "—"}</b></div>
          </div>

          <div className={styles.progressWrap}>
            <div className={styles.progressHead}><span>Graduation</span><span>{progress.toFixed(0)}%</span></div>
            <div className={styles.progressBar}><div style={{ width: `${progress}%` }} /></div>

            {!migrated && isOwner && progress >= 100 && (
              <div className={styles.migrate}>
                <button
                  onClick={onMigrateClick}
                  disabled={migrating}
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  title={!addr ? "Connect wallet to migrate" : undefined}
                >
                  {migrating ? "Migrating…" : "Migrate to DEX"}
                </button>
                {migMsg && <div className={styles.note}>{migMsg}</div>}
              </div>
            )}
          </div>
        </div>

        <div className={`${styles.card} ${styles.chartCard}`}>
          <div className={styles.cardTitle}>Price (BNB / {tokenSymbol})</div>
          <div className={styles.chartBox}>
            {uaPatched ? (
              <RemoteCandlesChart pool={poolAddr} chain={chain} height={240} dark />
            ) : (
              <div className={styles.dim} style={{ padding: 12 }}>Loading chart…</div>
            )}
          </div>
        </div>
      </div>

      {/* buy / sell */}
      <div className={styles.row}>
        <div className={`${styles.card} ${styles.tradeCard}`}>
          <div className={styles.tradeTabs}>
            <button className={`${styles.tab} ${styles.active}`}>BUY</button>
            <button className={styles.tab}>SELL</button>
          </div>
          <div className={styles.formGrid}>
            <label>Amount (BNB)</label>
            <input
              value={buyBnb}
              onChange={(e) => setBuyBnb(cleanDecimalInput(e.target.value))}
              placeholder="0.10"
              className={styles.input}
              inputMode="decimal"
              pattern="[0-9]*[.]?[0-9]*"
            />
            <div className={styles.help}>Est. tokens: {buyOut ? `${buyOut} ${snap?.symbol || ""}` : "—"}</div>
            <div className={styles.help}>Est. USD: {buyBnb ? fmtUSD(Number(buyBnb || 0) * usdPerBnb) : "—"}</div>
            <button
              onClick={onBuy}
              disabled={buying}
              className={`${styles.btn} ${styles.btnBuy}`}
              title={!addr ? "Connect wallet to buy" : undefined}
            >
              {buying ? "Buying…" : "Buy"}
            </button>
            {buyMsg && <div className={styles.note}>{buyMsg}</div>}
          </div>

          <div className={styles.divider} />

          <div className={styles.formGrid}>
            <label>Amount ({snap?.symbol || "TOKEN"})</label>
            <div className={styles.inputRow}>
              <input
                value={sellTokens}
                onChange={(e) => setSellTokens(cleanDecimalInput(e.target.value))}
                placeholder="12345"
                className={styles.input}
                inputMode="decimal"
                pattern="[0-9]*[.]?[0-9]*"
              />
              <button
                type="button"
                onClick={async () => {
                  await refreshWallet();
                  if (walletTokenStr) setSellTokens(walletTokenStr);
                  else setSellMsg("No token balance to sell.");
                }}
                className={`${styles.btn} ${styles.btnGhostSm}`}
                title={walletTokenStr ? `${trimZeros(walletTokenStr)} ${snap?.symbol || ""}` : "No balance"}
              >
                Max
              </button>
            </div>
            <div className={styles.help}>
              Est. price: {sellQuote.price != null ? `${fmtUSD(usdPerBnb * sellQuote.price)} / ${snap?.symbol || ""}` : "—"}
              {sellQuote.price != null ? ` (${fmtBNB(sellQuote.price)} BNB / ${snap?.symbol || ""})` : ""}
            </div>
            <div className={styles.help}>
              Total (after fees): {sellQuote.net != null ? fmtUSD(sellQuote.net * usdPerBnb) : "—"}
              {sellQuote.net != null ? ` (${fmtBNB(Number(sellQuote.net))} BNB)` : ""}
            </div>
            <button
              onClick={onSell}
              disabled={selling}
              className={`${styles.btn} ${styles.btnSell}`}
              title={!addr ? "Connect wallet to sell" : undefined}
            >
              {selling ? "Selling…" : "Sell"}
            </button>
            {sellMsg && <div className={styles.note}>{sellMsg}</div>}

            {/* Add-to-Wallet */}
            <div style={{ marginTop: 10 }}>
              <AddTokenButton
                address={snap?.token || ""}
                symbol={tokenSymbol}
                decimals={Number((snap as any)?.tokenDecimals ?? 18)}
                imageUrl={meta?.image_url}
                className={`${styles.btn} ${styles.btnGhost}`}
              />
            </div>
          </div>
        </div>

        <div className={styles.sideCol}>
          {/* ✅ NEW: Auto Wallet card (BNB + current token) */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>Wallet</div>

            <ul className={styles.list}>
              <li className={styles.listRow}>
                <span className={styles.dim}>Address</span>
                <span title={addr || ""}>{addr ? short(addr) : "—"}</span>
              </li>

              <li className={styles.listRow}>
                <span className={styles.dim}>BNB</span>
                <b>{walletBnb != null ? fmtBNB(walletBnb) : "—"}</b>
              </li>

              <li className={styles.listRow}>
                <span className={styles.dim}>{snap?.symbol || "Token"}</span>
                <b>{walletTokenStr ? trimZeros(walletTokenStr) : "—"}</b>
              </li>
            </ul>

            <div className={styles.listRow} style={{ gap: 8, marginTop: 8 }}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhostSm}`}
                onClick={refreshWallet}
                disabled={busyWallet}
              >
                {busyWallet ? "Refreshing…" : "Refresh"}
              </button>

              {snap?.token && (
                <>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnGhostSm}`}
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(snap.token); } catch {}
                    }}
                    title="Copy token address"
                  >
                    Copy token
                  </button>

                  <AddTokenButton
                    address={snap.token}
                    symbol={tokenSymbol}
                    decimals={Number((snap as any)?.tokenDecimals ?? 18)}
                    imageUrl={meta?.image_url}
                    className={`${styles.btn} ${styles.btnGhostSm}`}
                  />
                </>
              )}
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Top Holders</div>
            <ol className={styles.list}>
              {holders.slice(0, 8).map((h, i) => (
                <li key={i} className={styles.listRow}>
                  <span className={styles.rank}>#{i+1}</span>
                  <a href={`/u/${h.address}`} className={styles.addrLink}>{prettyAddr(profiles, h.address)}</a>
                  <span className={styles.fill} />
                  <span className={styles.dim}>{Number(h.balance).toLocaleString()} {snap?.symbol}</span>
                  <span className={styles.pct}>{h.pct.toFixed(2)}%</span>
                </li>
              ))}
              {!holders.length && <div className={styles.dim}>No holder data.</div>}
            </ol>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Latest Transactions</div>
            <ul className={styles.list}>
              {trades.slice(0, 10).map((t, i) => (
                <li key={i} className={styles.listRow}>
                  <span className={`${styles.badge} ${t.type === "BUY" ? styles.buy : styles.sell}`}>{t.type}</span>
                  {(t as any).addr && <a href={`/u/${(t as any).addr}`} className={styles.addrLink}>{prettyAddr(profiles, (t as any).addr)}</a>}
                  <span className={styles.fill} />
                  {t.type === "BUY" ? (
                    <span className={styles.dim}>{fmtBNB(Number((t as any).bnbIn || 0))} BNB → {Number((t as any).tokensOut || 0).toLocaleString()} {snap?.symbol || ""}</span>
                  ) : (
                    <span className={styles.dim}>{Number((t as any).tokenIn || 0).toLocaleString()} {snap?.symbol || ""} → {fmtBNB(Number((t as any).bnbOut || 0))} BNB</span>
                  )}
                </li>
              ))}
              {!trades.length && <div className={styles.dim}>No trades yet.</div>}
            </ul>
          </div>
        </div>
      </div>

      {/* MOBILE-ONLY meta cards */}
      {isMobile && (
        <>
          {meta?.description ? (
            <div className={`${styles.card} mobileMetaCard`}>
              <div className="mobileCardTitle">About</div>
              <div className="mobileDesc">{meta.description}</div>
            </div>
          ) : null}

          {meta and (meta.website || meta.telegram || meta.twitter) ? (
            <div className={`${styles.card} mobileMetaCard`}>
              <div className="mobileCardTitle">Links</div>
              <div className="mobileLinks">
                {meta.website && <a className="pill" href={meta.website} target="_blank" rel="noopener noreferrer nofollow">Website</a>}
                {meta.telegram && <a className="pill" href={meta.telegram} target="_blank" rel="noopener noreferrer nofollow">Telegram</a>}
                {meta.twitter && <a className="pill" href={meta.twitter} target="_blank" rel="noopener noreferrer nofollow">Twitter</a>}
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* ✅ News Editor UI (modal) */}
      {newsOpen && (
        <div className="newsModal">
          <div className="newsPanel">
            <div className="newsHead">
              <div className="title">Manage News</div>
              <button
                className={`${styles.btn} ${styles.btnGhostSm}`}
                onClick={() => { setNewsOpen(false); setEditingId(null); setNewsBody(""); }}
              >
                Close
              </button>
            </div>

            <div className="newsForm">
              <textarea
                className="newsTextarea"
                placeholder="Write an update to show in the marquee…"
                value={newsBody}
                onChange={(e) => setNewsBody(e.target.value)}
                rows={4}
              />
              <div className="row">
                <button
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={submitNews}
                  disabled={!newsBody.trim()}
                >
                  {editingId ? "Update" : "Publish"}
                </button>
                {authHint && <div className="authHint">{authHint}</div>}
              </div>
            </div>

            <div className="newsList">
              {news.length === 0 ? (
                <div className={styles.dim}>No news yet.</div>
              ) : (
                news.map((n) => (
                  <div key={n.id} className="newsRow">
                    <div className="newsBody">{n.body}</div>
                    <div className="actions">
                      <button
                        className={`${styles.btn} ${styles.btn} ${styles.btnGhostSm}`}
                        onClick={() => { setEditingId(n.id); setNewsBody(n.body); }}
                      >
                        Edit
                      </button>
                      <button
                        className={`${styles.btn} ${styles.btnGhostSm}`}
                        onClick={() => deleteNews(n.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className={styles.risk}>Investing in cryptocurrencies involves risks.</div>

      {/* styles preserved from your file */}
      <style jsx>{`
        .topBar {
          display: flex; align-items: center; gap: 12px; height: 56px; padding: 0 14px; margin-bottom: 10px;
          border: 1px solid rgba(0,255,255,0.08); border-radius: 14px;
          background: linear-gradient(180deg, rgba(12,19,27,0.8), rgba(9,14,21,0.8));
          box-shadow: inset 0 0 0 1px rgba(0,255,255,0.05), 0 0 24px rgba(0,255,255,0.02);
        }
        .fill { flex: 1; }
        .siteTitle { font-weight: 700; opacity: 0.9; }
        .linkPlain { text-decoration: none; border-bottom: none; }
        .linkPlain:hover { text-decoration: none; }

        /* NEWS BAR */
        .newsBar {
          position: relative;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          margin: 10px 0 14px 0;
          border: 1px solid rgba(255,215,0,0.25);
          border-radius: 12px;
          background: radial-gradient(1200px 80px at 0% 50%, rgba(255,215,0,0.07), transparent 60%),
                      linear-gradient(180deg, rgba(18,14,5,0.85), rgba(16,12,3,0.85));
          box-shadow: inset 0 0 0 1px rgba(255,215,0,0.08), 0 0 22px rgba(255,215,0,0.05);
          overflow: hidden;
        }
        .flash { font-size: 20px; line-height: 1; filter: drop-shadow(0 0 6px rgba(255,215,0,0.6)); }
        .newsMarquee {
          position: relative;
          flex: 1;
          overflow: hidden;
          white-space: nowrap;
          mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
          -webkit-mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
        }
        .newsTrack {
          display: flex;
          width: fit-content;
          white-space: nowrap;
          will-change: transform;
          padding-left: var(--start-gap, 100%);
          animation: marquee var(--marquee-speed, 20s) linear infinite;
        }
        .newsChunk { flex: 0 0 auto; display: inline-block; white-space: nowrap; }
        .newsItem  { display: inline; padding-right: 10px; }
        .newsChunk.mirror { padding-left: var(--loop-gap, 40vw); }
        .newsMarquee:hover .newsTrack { animation-play-state: paused; }
        @keyframes marquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(calc(-50% - var(--start-gap, 100%))); }
        }
        .newsActions { display: flex; align-items: center; gap: 6px; }

        .metaLine { margin-top: 6px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .metaLine .desc  { opacity: 0.9; }
        .metaLine .links { display: flex; gap: 8px; flex-wrap: wrap; }
        .pill {
          padding: 4px 8px;
          border-radius: 999px;
          font-size: 12px;
          text-decoration: none;
          color: #d8ecff;
          border: 1px solid rgba(0,255,255,0.25);
          background: linear-gradient(180deg, rgba(12,19,27,0.6), rgba(9,14,21,0.6));
        }

        .mobileMetaCard { margin: 12px 0 0 0; }
        .mobileCardTitle { font-weight: 700; margin-bottom: 6px; opacity: 0.95; }
        .mobileDesc { color: #bcd3ea; line-height: 1.5; }
        .mobileLinks { display: flex; gap: 8px; flex-wrap: wrap; }

        .smallName { color: #8ecbff; font-size: 13px; margin-bottom: 4px; line-height: 1.2; }

        .newsModal { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 50; }
        .newsPanel {
          width: min(900px, 92vw);
          max-height: 84vh;
          overflow: auto;
          border: 1px solid rgba(255,215,0,0.25);
          border-radius: 14px;
          background: linear-gradient(180deg, rgba(18,14,5,0.95), rgba(16,12,3,0.95));
          box-shadow: 0 10px 36px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,215,0,0.08);
          padding: 14px;
        }
        .newsHead { display:flex; align-items:center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
        .newsHead .title { font-weight: 700; font-size: 16px; }

        .newsForm { display:flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
        .newsTextarea {
          width: 100%; padding: 10px; border-radius: 10px;
          border: 1px solid rgba(255,215,0,0.25);
          background: rgba(0,0,0,0.3); color: #f6f1ce;
          resize: vertical;
        }
        .newsForm .row { display:flex; align-items:center; gap: 10px; }
        .authHint { color: #ffc107; opacity: 0.9; }

        .newsList { display:flex; flex-direction: column; gap: 8px; }
        .newsRow {
          display:flex; align-items:flex-start; gap: 12px;
          padding: 10px; border: 1px solid rgba(255,215,0,0.18);
          border-radius: 10px;
          background: rgba(18,14,5,0.5);
        }
        .newsBody { flex: 1; color: #f2e9c9; }
        .newsRow .actions { display:flex; gap: 8px; }
      `}</style>
    </main>
  );
}
