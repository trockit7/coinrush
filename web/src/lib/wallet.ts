"use client";
import { BrowserProvider } from "ethers";

export type WalletKey = string; // rdns or synthetic key

export function toHexChainId(id: number) {
  return "0x" + id.toString(16);
}

type Discovered = {
  key: WalletKey;
  name: string;
  rdns?: string;
  isMetaMask?: boolean;
  isTrust?: boolean;
  provider: any;
};

/** Discover injected wallets (MetaMask, Trust, etc.) using window.ethereum + EIP-6963 */
export async function discoverInjected(): Promise<Discovered[]> {
  const eth: any = (globalThis as any).ethereum;
  const out: Discovered[] = [];

  // 1) Multi-provider list if present
  const list: any[] = Array.isArray(eth?.providers) ? eth.providers.slice() : [];
  // 2) EIP-6963 announce
  const seen = new Map<string, any>();
  const onAnnounce = (e: any) => {
    const prov = e?.detail?.provider;
    const info = e?.detail?.info || {};
    if (!prov) return;
    const key = info.rdns || prov.id || Math.random().toString(36);
    if (!seen.has(key)) seen.set(key, { provider: prov, info });
  };
  globalThis.addEventListener?.("eip6963:announceProvider", onAnnounce as any);
  globalThis.dispatchEvent?.(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, 250));
  globalThis.removeEventListener?.("eip6963:announceProvider", onAnnounce as any);
  for (const v of seen.values()) list.push(Object.assign(v.provider, { info: v.info }));

  // 3) Fallback to single ethereum
  if (!list.length && eth) list.push(eth);
  if (!list.length) return out;

  for (const p of list) {
    const rdns = p?.info?.rdns;
    const name =
      p?.info?.name ||
      (p?.isMetaMask ? "MetaMask" : (p?.isTrust || p?.isTrustWallet) ? "Trust Wallet" : rdns || "Injected");
    const key =
      rdns ||
      (p?.isMetaMask
        ? "metamask"
        : (p?.isTrust || p?.isTrustWallet)
        ? "trustwallet"
        : name.toLowerCase().replace(/\s+/g, "-"));
    out.push({
      key,
      name,
      rdns,
      isMetaMask: !!p?.isMetaMask || /metamask/i.test(rdns || ""),
      isTrust: !!(p?.isTrust || p?.isTrustWallet) || /trust/i.test(rdns || ""),
      provider: p,
    });
  }
  // de-dupe by key
  return Array.from(new Map(out.map((x) => [x.key, x])).values());
}

export function getSavedWalletKey(): WalletKey | null {
  try {
    return (globalThis as any).localStorage?.getItem("cr:walletKey") || null;
  } catch {
    return null;
  }
}
export function saveWalletKey(key: WalletKey) {
  try {
    (globalThis as any).localStorage?.setItem("cr:walletKey", key);
  } catch {}
}

export async function ensureChainOnProvider(provider: any, chainId: number) {
  const wanted = toHexChainId(chainId);
  const cur = await provider.request({ method: "eth_chainId" }).catch(() => null);
  if (cur === wanted) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: wanted }],
    });
  } catch (e: any) {
    const needAdd = e?.code === 4902 || /unrecognized|not added|do not recognize/i.test(e?.message || "");
    if (!needAdd) throw e;
    const params =
      chainId === 56
        ? {
            chainId: wanted,
            chainName: "BNB Smart Chain",
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            rpcUrls: [
              process.env.NEXT_PUBLIC_BSC_MAINNET_HTTP_1,
              process.env.NEXT_PUBLIC_BSC_MAINNET_HTTP_2,
              process.env.NEXT_PUBLIC_BSC_MAINNET_HTTP_3,
              process.env.NEXT_PUBLIC_BSC_MAINNET_HTTP_4,
              process.env.NEXT_PUBLIC_BSC_MAINNET_HTTP_5,
              "https://bsc-dataseed.binance.org",
            ].filter(Boolean),
            blockExplorerUrls: ["https://bscscan.com"],
          }
        : {
            chainId: wanted,
            chainName: "BNB Smart Chain Testnet",
            nativeCurrency: { name: "BNB", symbol: "tBNB", decimals: 18 },
            rpcUrls: [
              process.env.NEXT_PUBLIC_BSC_HTTP_1,
              process.env.NEXT_PUBLIC_BSC_HTTP_2,
              process.env.NEXT_PUBLIC_BSC_HTTP_3,
              process.env.NEXT_PUBLIC_BSC_HTTP_4,
              process.env.NEXT_PUBLIC_BSC_HTTP_5,
              "https://bsc-testnet.publicnode.com",
            ].filter(Boolean),
            blockExplorerUrls: ["https://testnet.bscscan.com"],
          };
    await provider.request({ method: "wallet_addEthereumChain", params: [params] });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: wanted }],
    });
  }
}

/** Build a signer from a specific discovered key (saves choice). */
export async function getSignerByKey(chainId: number, key: WalletKey) {
  const all = await discoverInjected();
  const hit = all.find((p) => p.key === key) || all[0];
  if (!hit) throw new Error("No injected wallet found");
  saveWalletKey(hit.key);

  // 🔸 ensure network first
  await ensureChainOnProvider(hit.provider, chainId);

  // 🔸 request accounts explicitly (avoids some MM “Internal JSON-RPC error” cases)
  await hit.provider.request({ method: "eth_requestAccounts" });

  const provider = new BrowserProvider(hit.provider);
  return provider.getSigner();
}

/** Preferred signer: uses saved key; if not present or invalid, throws (UI should open picker) */
export async function getSavedSignerOrThrow(chainId: number) {
  const key = getSavedWalletKey();
  if (!key) throw new Error("WALLET_PICK_REQUIRED");
  return getSignerByKey(chainId, key);
}
