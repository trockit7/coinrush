// src/components/wallet/ConnectTrustInjected.tsx
"use client";
import * as React from "react";
import { BrowserProvider } from "ethers";

function pickTrustInjected(): any | null {
  const eth: any = (typeof window !== "undefined" && (window as any).ethereum) || null;
  if (!eth) return null;
  const providers: any[] = eth.providers || [eth];
  // Trust Wallet extension sets isTrust = true
  const trust = providers.find((p) => p.isTrust) || null;
  return trust || null;
}

async function ensureChain(provider: BrowserProvider, chainId: number) {
  const net = await provider.getNetwork();
  if (Number(net.chainId) === chainId) return;
  const hex = `0x${chainId.toString(16)}`;
  try {
    await provider.send("wallet_switchEthereumChain", [{ chainId: hex }]);
  } catch {
    if (chainId === 97) {
      await provider.send("wallet_addEthereumChain", [{
        chainId: "0x61",
        chainName: "BSC Testnet",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        rpcUrls: ["https://bsc-testnet.publicnode.com"],
        blockExplorerUrls: ["https://testnet.bscscan.com"],
      }]);
      await provider.send("wallet_switchEthereumChain", [{ chainId: "0x61" }]);
    }
  }
}

export default function ConnectTrustInjected() {
  const [addr, setAddr] = React.useState<string>("");

  const connect = async () => {
    try {
      const injected = pickTrustInjected();
      if (!injected) {
        alert("Trust Wallet extension not found. Please install it and refresh.");
        return;
      }
      const provider = new BrowserProvider(injected);
      await ensureChain(provider, 97);              // BSC Testnet
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      setAddr(address);
      // save if your app uses it later:
      try { localStorage.setItem("cr:lastAddress", address.toLowerCase()); } catch {}
      alert(`Connected with Trust: ${address}`);
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  };

  return (
    <button onClick={connect} className="px-3 py-2 rounded-md border">
      {addr ? `Connected: ${addr.slice(0,6)}…${addr.slice(-4)}` : "Connect Trust (extension)"}
    </button>
  );
}
