// src/components/SellButton.tsx
"use client";

import React from "react";
import { Contract, Interface, parseUnits } from "ethers";
import { getEthersSigner, ensureChain } from "@/lib/wallet/signing";
import { assertChainId, assertAddressAllowed, limitApprovalAmount } from "@/lib/security/wallet-preflight";

/* ───────────────── ABIs ───────────────── */
const ERC20_MIN_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
] as const;

const POOL_ABI_RW = [
  "function sell(uint256 tokenIn, uint256 minOut) returns (uint256)",
] as const;

/* ─────────────── Helpers ─────────────── */
const MAX_UINT256 = (1n << 256n) - 1n;

function toUnitsSafe(raw: string, decimals: number): bigint | null {
  const s = (raw || "").trim();
  if (!s || s === "." || s === "0." || s === ".0") return null;
  try { return parseUnits(s, decimals); } catch { return null; }
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
  return parseUnits("10", 9); // fallback 10 gwei
}

async function ensureWalletOnChainEIP(signer: any, wantedChainId: number) {
  const prov: any = signer?.provider || (signer as any)?.runner?.provider || null;
  if (!prov) return;
  let current = 0;
  try { const net = await prov.getNetwork?.(); current = Number(net?.chainId ?? 0); } catch {}
  if (current === wantedChainId) return;

  const hex = `0x${Number(wantedChainId).toString(16)}`;
  try { await prov.send?.("wallet_switchEthereumChain", [{ chainId: hex }]); return; } catch {}

  if (wantedChainId === 97) {
    try {
      await prov.send?.("wallet_addEthereumChain", [{
        chainId: "0x61",
        chainName: "BSC Testnet",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        rpcUrls: ["https://bsc-testnet.publicnode.com"],
        blockExplorerUrls: ["https://testnet.bscscan.com"],
      }]);
      await prov.send?.("wallet_switchEthereumChain", [{ chainId: hex }]);
      return;
    } catch {}
  }
  if (wantedChainId === 56) {
    try {
      await prov.send?.("wallet_addEthereumChain", [{
        chainId: "0x38",
        chainName: "BNB Smart Chain",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        rpcUrls: ["https://bsc-dataseed.binance.org"],
        blockExplorerUrls: ["https://bscscan.com"],
      }]);
      await prov.send?.("wallet_switchEthereumChain", [{ chainId: hex }]);
      return;
    } catch {}
  }
  throw new Error("Wrong network in wallet. Please switch to BSC and try again.");
}

async function getAllowanceOf(tokenAddr: string, owner: string, spender: string, signerOrProv: any): Promise<bigint> {
  try { const erc = new Contract(tokenAddr, ERC20_MIN_ABI, signerOrProv) as any; return (await erc.allowance(owner, spender)) as bigint; }
  catch { return 0n; }
}

async function waitForAllowanceAtLeast(
  tokenAddr: string,
  owner: string,
  spender: string,
  want: bigint,
  prov: any,
  timeoutMs = 15000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const a = await getAllowanceOf(tokenAddr, owner, spender, prov);
    if (a >= want) return true;
    await new Promise(r => setTimeout(r, 700));
  }
  return false;
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

async function ensureAllowanceIfNeeded(opts: {
  tokenAddr: string;
  owner: string;
  spender: string;
  signer: any;
  want: bigint;
  onStatus?: (s: string) => void;
  chainId: number;
}) {
  const { tokenAddr, owner, spender, signer, want, onStatus, chainId } = opts;

  // ✅ Preflights
  assertAddressAllowed(tokenAddr);
  assertAddressAllowed(spender);
  assertChainId(chainId);

  const prov = signer.provider;
  const erc  = new Contract(tokenAddr, ERC20_MIN_ABI, signer) as any;
  const iface = new Interface(ERC20_MIN_ABI);

  onStatus?.("Checking allowance…");

  const wantSafe = limitApprovalAmount(want);

  let current: bigint = 0n;
  try { current = await erc.allowance(owner, spender); } catch {}

  if (current >= wantSafe) {
    onStatus?.("Allowance ok.");
    return;
  }

  const gasPrice = await getLegacyGasPrice(prov);
  const mkGas = async (data: string) => {
    try {
      const est = await prov.estimateGas({ to: tokenAddr, data, from: owner, value: 0n });
      return (est * 12n) / 10n;
    } catch { return 60_000n; }
  };
  const send = async (data: string) => {
    const gasLimit = await mkGas(data);
    await ensureEnoughNativeForTx(signer, { to: tokenAddr, data, value: 0n, from: owner, chainId });
    const tx = await signer.sendTransaction({
      to: tokenAddr, data, value: 0n, type: 0, gasPrice, gasLimit, chainId,
    });
    await tx.wait();
  };

  // Try direct approve to target cap
  onStatus?.("Approving token spend… (check your wallet)");
  try {
    await send(iface.encodeFunctionData("approve", [spender, MAX_UINT256]));
  } catch {
    // Some tokens require revoke→approve
    onStatus?.("Resetting old allowance, then approving…");
    try { await send(iface.encodeFunctionData("approve", [spender, 0n])); } catch {}
    await send(iface.encodeFunctionData("approve", [spender, wantSafe]));
  }
  onStatus?.("Approval confirmed. Preparing sell…");
}

/* ─────────────── Component ─────────────── */
type Props = {
  poolAddr: string;
  tokenAddr: string;
  tokenDecimals: number;
  chainId?: number;
  amount: string;

  className?: string;
  style?: React.CSSProperties;
  label?: string;
  disabled?: boolean;

  onStatus?: (msg: string) => void;
  onSold?: (txHash: string) => void;
};

export default function SellButton({
  poolAddr,
  tokenAddr,
  tokenDecimals,
  chainId = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID || 97),
  amount,
  className,
  style,
  label = "Sell",
  disabled,
  onStatus,
  onSold,
}: Props) {
  const [busy, setBusy] = React.useState(false);
  const say = (s: string) => { try { onStatus?.(s); } catch {} };

  const onClick = async () => {
    if (busy) return;
    setBusy(true);

    try {
      // 🔒 Preflights
      assertAddressAllowed(poolAddr);
      assertAddressAllowed(tokenAddr);
      assertChainId(chainId);

      // Ensure wallet on correct network, then get signer
      const hexId = `0x${Number(chainId).toString(16)}`;
      try { await ensureChain(hexId); } catch {}
      const signer = await getEthersSigner();
      await ensureWalletOnChainEIP(signer, chainId);
      const me = (await signer.getAddress()).toLowerCase();
      const prov = signer.provider;

      // Parse amount
      const wantWei = toUnitsSafe(amount, tokenDecimals);
      if (wantWei == null || wantWei <= 0n) { say("Enter a valid token amount."); return; }

      // Balance check
      try {
        const ercRO = new Contract(tokenAddr, ERC20_MIN_ABI, prov) as any;
        const bal: bigint = await ercRO.balanceOf(me);
        if (bal < wantWei) { say(`You only have ${(Number(bal) / (10 ** tokenDecimals)).toLocaleString()} tokens.`); return; }
      } catch {}

      // Allowance flow
      const wantCap = limitApprovalAmount(wantWei);
      let allowance = await getAllowanceOf(tokenAddr, me, poolAddr, prov);
      if (allowance < wantCap) {
        await ensureAllowanceIfNeeded({
          tokenAddr,
          owner: me,
          spender: poolAddr,
          signer,
          want: wantWei,
          chainId,
          onStatus: say,
        });
        // short poll for allowance reflection
        const ok = await waitForAllowanceAtLeast(tokenAddr, me, poolAddr, wantCap, prov, 15000);
        if (!ok) say("Approval broadcast. If the next step reverts, wait a few seconds and try again.");
        allowance = await getAllowanceOf(tokenAddr, me, poolAddr, prov);
        if (allowance < wantCap) { say("Token still shows low allowance. Please retry shortly."); return; }
      } else {
        say("Allowance ok.");
      }

      // Preflight via estimateGas
      const pool = new Contract(poolAddr, POOL_ABI_RW, signer) as any;
      try {
        await pool.sell.estimateGas(wantWei, 0n, { from: me });
      } catch (e: any) {
        const m = (e?.shortMessage || e?.message || "").toLowerCase();
        if (m.includes("insufficient allowance")) { say("The token still reports low allowance. Wait a bit and try again."); return; }
        if (m.includes("insufficient balance"))   { say("Not enough token balance to sell that amount."); return; }
        say("That amount would revert right now (liquidity/slippage/fees). Try a smaller amount.");
        return;
      }

      // Encode & send (legacy type-0)
      const iface = new Interface(POOL_ABI_RW);
      const data = iface.encodeFunctionData("sell", [wantWei, 0n]);

      const { gasPrice, gasLimit } = await ensureEnoughNativeForTx(signer, {
        to: poolAddr, data, value: 0n, from: me, chainId,
      });

      say("Sending sell… (check your wallet)");
      const tx = await signer.sendTransaction({
        to: poolAddr,
        data,
        value: 0n,
        type: 0,
        gasPrice,
        gasLimit,
        chainId,
      });

      say("Waiting for confirmation…");
      const rc = await tx.wait();
      say("Sell sent ✅");
      onSold?.(rc?.hash ?? tx.hash);
    } catch (e: any) {
      const msg = normalizeNativeGasError(e, "BNB");
      if (/user rejected/i.test(String(e?.shortMessage || e?.message))) say("Transaction cancelled in wallet.");
      else say(msg || "Sell failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" onClick={onClick} disabled={busy || disabled} className={className} style={style}>
      {busy ? "Selling…" : (label || "Sell")}
    </button>
  );
}
