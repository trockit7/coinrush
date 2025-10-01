// src/app/providers/eip6963-filter-trust.ts
"use client";

/**
 * Hide Trust Wallet from EIP-6963 provider announcements so it never appears
 * in the modal's discovered list. MetaMask/Coinbase/Rainbow still work.
 */
(function filterTrustEip6963() {
  if (typeof window === "undefined") return;

  const isTrust = (info: any) => {
    const n = String(info?.name || info?.rdns || info?.uuid || "").toLowerCase();
    return (
      /trust/.test(n) ||
      info?.walletName?.toLowerCase?.().includes?.("trust") ||
      info?.isTrust ||
      info?.isTrustWallet
    );
  };

  window.addEventListener(
    "eip6963:announceProvider",
    (e: any) => {
      try {
        const p = e?.detail?.provider || e?.detail;
        const info = p?.info || p?.providerInfo || {};
        if (isTrust(info)) {
          // stop Trust from being registered
          e.stopImmediatePropagation?.();
          e.preventDefault?.();
        }
      } catch {}
    },
    // Must be capture-phase and early to beat other listeners
    { capture: true, passive: true }
  );
})();
