"use client";
import * as React from "react";

type Props = {
  address: string;
  symbol: string;
  decimals: number;
  imageUrl?: string;
  chainId?: number;       // optional (we won't auto-switch chains)
  className?: string;     // ← will match your page styles
};

export default function AddTokenButton({
  address,
  symbol,
  decimals,
  imageUrl,
  className,
}: Props) {
  const [busy, setBusy] = React.useState(false);

  const onClick = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const eth: any = (typeof window !== "undefined" ? (window as any).ethereum : undefined);
      if (!eth?.request) {
        // no wallet that supports watchAsset
        alert("Open a wallet that supports adding tokens (e.g., MetaMask, Coinbase).");
        return;
      }
      await eth.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address,
            symbol,
            decimals,
            image: imageUrl,
          },
        },
      });
      // no setInterval / no toggling state that causes flicker
    } catch {
      // swallow errors: wallet UI usually shows details
    } finally {
      setBusy(false);
    }
  }, [busy, address, symbol, decimals, imageUrl]);

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={busy}
      // prevent CSS “focus ring” flashes on re-render
      onMouseDown={(e) => e.preventDefault()}
    >
      {busy ? "Adding…" : "Add to Wallet"}
    </button>
  );
}
