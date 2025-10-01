// src/app/providers/injected-filter.ts
"use client";

/**
 * Hide Trust's injected provider from EIP-6963 / window.ethereum.providers
 * so generic "injected" connectors won't pick it up.
 * (MetaMask stays visible.)
 */
(function filterInjected() {
  if (typeof window === "undefined") return;
  const w = window as any;
  const eth = w.ethereum as any;

  const looksLikeTrust = (p: any) =>
    !!(p?.isTrust || p?.isTrustWallet || (typeof p?.walletName === "string" && p.walletName.toLowerCase().includes("trust")) ||
       (p?.providerInfo?.rdns && String(p.providerInfo.rdns).toLowerCase().includes("trust")));

  // EIP-6963 multi-provider
  if (Array.isArray(eth?.providers) && eth.providers.length > 0) {
    eth.providers = eth.providers.filter((p: any) => !looksLikeTrust(p));
  }

  // Single injected case
  if (eth && looksLikeTrust(eth)) {
    try {
      // If MetaMask also exists in providers[], swap to that; otherwise, unset
      const mm = Array.isArray(eth.providers) ? eth.providers.find((p: any) => p?.isMetaMask) : null;
      if (mm) w.ethereum = mm;
      else w.ethereum = undefined;
    } catch {
      // ignore
    }
  }
})();
