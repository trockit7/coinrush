"use client";

import React from "react";
import { useConnectWallet } from "@web3-onboard/react";
import { BrowserProvider, Contract, formatEther, formatUnits } from "ethers";

const ERC20_MIN_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
] as const;

function short(addr?: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}
function chainNativeSymbol(chainId?: number) {
  if (chainId === 56 || chainId === 97) return "BNB";
  if (chainId === 8453 || chainId === 84532) return "ETH"; // Base mainnet/testnet
  return "ETH";
}

export function WalletButton({
  style,
  className,
}: {
  style?: React.CSSProperties;
  className?: string;
}) {
  const [{ wallet, connecting }, connect, disconnect] = useConnectWallet();
  const isConnected = !!wallet;
  const address = wallet?.accounts?.[0]?.address || "";
  const label = (wallet as any)?.label as string | undefined;
  const chainId =
    (wallet?.chains && wallet.chains[0] && Number(wallet.chains[0].id)) || undefined;

  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  const [nativeBal, setNativeBal] = React.useState<string>("—");
  const [nativeLoading, setNativeLoading] = React.useState(false);

  // “Check token balance” mini-tool
  const [tokenAddr, setTokenAddr] = React.useState("");
  const [tokenSymbol, setTokenSymbol] = React.useState<string>("—");
  const [tokenBal, setTokenBal] = React.useState<string>("—");
  const [tokenLoading, setTokenLoading] = React.useState(false);
  const [tokenErr, setTokenErr] = React.useState<string>("");

  // Outside click handler (keeps the panel interactive)
  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!open) return;
      const t = e.target as Node | null;
      if (panelRef.current?.contains(t as Node)) return;
      if (btnRef.current?.contains(t as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc, { capture: true });
    return () => document.removeEventListener("mousedown", onDoc, { capture: true });
  }, [open]);

  // Persist last address for the rest of your app
  React.useEffect(() => {
    const a = (address || "").toLowerCase();
    try {
      if (a) localStorage.setItem("cr:lastAddress", a);
    } catch {}
  }, [address]);

  async function loadNativeBalance() {
    if (!isConnected || !address) { setNativeBal("—"); return; }
    setNativeLoading(true);
    try {
      const prov: any =
        (wallet as any)?.provider ||
        (wallet as any)?.accounts?.[0]?.provider ||
        (typeof window !== "undefined" ? (window as any).ethereum : null);
      const provider = new BrowserProvider(prov);
      const wei = await provider.getBalance(address);
      setNativeBal(formatEther(wei));
    } catch {
      setNativeBal("—");
    } finally {
      setNativeLoading(false);
    }
  }

  // Refresh native balance when panel opens or chain/account changes
  React.useEffect(() => {
    if (open) loadNativeBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, address, chainId]);

  async function checkTokenBalance(addr: string) {
    setTokenLoading(true);
    setTokenErr("");
    setTokenSymbol("—");
    setTokenBal("—");
    try {
      if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        setTokenErr("Enter a valid token address");
        return;
      }
      const prov: any =
        (wallet as any)?.provider ||
        (wallet as any)?.accounts?.[0]?.provider ||
        (typeof window !== "undefined" ? (window as any).ethereum : null);
      const provider = new BrowserProvider(prov);
      const erc20 = new Contract(addr, ERC20_MIN_ABI, provider) as any;
      const [sym, dec, bal] = await Promise.all([
        erc20.symbol().catch(() => "TOKEN"),
        erc20.decimals().catch(() => 18),
        erc20.balanceOf(address).catch(() => 0n),
      ]);
      setTokenSymbol(sym);
      setTokenBal(formatUnitsSafe(bal, Number(dec)));
    } catch (e: any) {
      setTokenErr(e?.message || "Failed to read balance");
    } finally {
      setTokenLoading(false);
    }
  }

  function formatUnitsSafe(v: bigint, d: number) {
    try { return formatUnits(v, isFinite(d as any) ? d : 18); } catch { return "0"; }
  }

  // Clear a bunch of known Web3-Onboard persistence keys as a final fallback
  function nukeOnboardStorage() {
    const keys = [
      "connectedWallets",
      "onboard.wallets",
      "onboard.selectedWallet",
      "onboard.js:wallets",
      "onboard.js:last_connected_wallet",
      "onboard:lastConnectedWallet",
      "onboard:connectedWallets",
      "onboard:walletcenter",
    ];
    try { keys.forEach(k => localStorage.removeItem(k)); } catch {}
    try { keys.forEach(k => sessionStorage.removeItem(k)); } catch {}
  }

  async function handleConnect() {
    const res = await connect();
    const addr = res?.[0]?.accounts?.[0]?.address;
    if (addr) {
      try { localStorage.setItem("cr:lastAddress", addr.toLowerCase()); } catch {}
    }
  }

  async function handleDisconnect() {
    // 1) Primary: disconnect via hook (expects label)
    try {
      if (label) await disconnect({ label } as any);
      else if ((wallet as any)?.label) await disconnect({ label: (wallet as any).label } as any);
    } catch {
      // ignore; continue fallbacks
    }
    // 2) Provider-level attempts (some wallets expose disconnect / remove listeners)
    try {
      const prov: any =
        (wallet as any)?.provider ||
        (wallet as any)?.instance ||
        (wallet as any)?.accounts?.[0]?.provider ||
        null;
      await prov?.disconnect?.();
      try {
        prov?.removeAllListeners?.("accountsChanged");
        prov?.removeAllListeners?.("chainChanged");
        prov?.removeAllListeners?.("disconnect");
        prov?.removeAllListeners?.();
      } catch {}
    } catch {}

    // 3) Onboard core API fallback if present
    try {
      const ob = (window as any).__onboard;
      if (label && ob?.disconnectWallet) {
        await ob.disconnectWallet({ label });
      }
    } catch {}

    // 4) Clear storage + local cache
    nukeOnboardStorage();
    try { localStorage.removeItem("cr:lastAddress"); } catch {}

    // 5) Close panel
    setOpen(false);

    // Optional: hard reload to guarantee UI reset
    // window.location.reload();
  }

  const baseBtn: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(0,255,255,0.28)",
    background: "linear-gradient(180deg, rgba(12,19,27,0.85), rgba(9,14,21,0.85))",
    color: "#e7faff",
    fontWeight: 700,
    cursor: connecting ? "wait" : "pointer",
    boxShadow: "0 0 22px -8px rgba(0,240,255,0.55)",
    textShadow: "0 0 8px rgba(255,255,255,0.35)",
    transition: "transform .15s ease, box-shadow .15s ease",
    outline: "none",
    ...(style || {}),
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        type="button"
        className={className}
        style={baseBtn}
        disabled={connecting}
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isConnected) {
            await handleConnect();
          } else {
            setOpen((v) => !v);
          }
        }}
        title={address ? `Connected: ${address}` : "Connect Wallet"}
      >
        {isConnected ? short(address) : connecting ? "Connecting…" : "Connect Wallet"}
      </button>

      {/* Wallet popover */}
      {isConnected && open && (
        <div
          ref={panelRef}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            right: 0,
            marginTop: 8,
            minWidth: 280,
            padding: 12,
            borderRadius: 12,
            background: "linear-gradient(180deg, #0b1018, #0e1622)",
            boxShadow:
              "0 0 0 1px rgba(0,220,255,0.18) inset, 0 14px 36px rgba(0,0,0,0.5)",
            zIndex: 9999, // make SURE it’s on top
            pointerEvents: "auto",
          }}
        >
          {/* Address + Chain */}
          <div style={{ fontSize: 12, color: "#8aa6c2", marginBottom: 8, wordBreak: "break-all" }}>
            {address}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
              fontSize: 12,
              color: "#8aa6c2",
            }}
          >
            <span>Network:</span>
            <b style={{ color: "#d8ecff" }}>
              {chainId ? `${chainId} (${chainNativeSymbol(chainId)})` : "—"}
            </b>
          </div>

          {/* Native balance */}
          <div
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid rgba(0,255,255,0.18)",
              background: "rgba(255,255,255,0.02)",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 12, color: "#8aa6c2" }}>Native Balance</div>
            <div style={{ marginTop: 4, fontWeight: 700 }}>
              {nativeLoading ? "Loading…" : `${nativeBal} ${chainNativeSymbol(chainId)}`}
            </div>
          </div>

          {/* Token balance checker */}
          <div
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid rgba(0,255,255,0.18)",
              background: "rgba(255,255,255,0.02)",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 12, color: "#8aa6c2", marginBottom: 6 }}>
              Check token balance
            </div>
            <input
              value={tokenAddr}
              onChange={(e) => setTokenAddr(e.target.value.trim())}
              placeholder="0x… token address"
              style={{
                width: "100%",
                border: "1px solid rgba(0,220,255,0.25)",
                background: "rgba(255,255,255,0.03)",
                borderRadius: 10,
                padding: 8,
                fontSize: 13,
                color: "#d8ecff",
                outline: "none",
                marginBottom: 8,
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => checkTokenBalance(tokenAddr)}
                disabled={tokenLoading || !tokenAddr}
                style={{
                  flex: "0 0 auto",
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,255,255,0.28)",
                  background:
                    "linear-gradient(180deg, rgba(12,19,27,0.85), rgba(9,14,21,0.85))",
                  color: "#e7faff",
                  fontWeight: 700,
                  cursor: tokenLoading ? "wait" : "pointer",
                }}
              >
                {tokenLoading ? "Checking…" : "Check"}
              </button>
              <div style={{ flex: 1, fontSize: 12, color: "#8aa6c2", alignSelf: "center" }}>
                {tokenErr
                  ? <span style={{ color: "#ff9b9b" }}>{tokenErr}</span>
                  : tokenSymbol !== "—" || tokenBal !== "—"
                    ? <span><b>{tokenBal}</b> {tokenSymbol}</span>
                    : <span>—</span>}
              </div>
            </div>
          </div>

          {/* Disconnect */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleDisconnect(); }}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,90,90,0.25)",
              background:
                "linear-gradient(180deg, rgba(40,18,18,0.85), rgba(26,12,12,0.85))",
              color: "#ffd5d5",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export default WalletButton;
