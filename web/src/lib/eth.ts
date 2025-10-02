// src/lib/eth.ts

import type { Signer } from "ethers";
import {
  BrowserProvider,
  Contract,
  Interface,
  JsonRpcProvider,
  parseEther,
} from "ethers";

import { FACTORY_ABI } from "./abi";
import { CHAINS } from "./chains";
import { getEthersSigner, ensureChain } from "@/lib/wallet/signing";

/*────────────────────────────────────────────────────────
  Helpers
────────────────────────────────────────────────────────*/
function networkName(chainId: number) {
  if (chainId === 97) return "bsc-testnet";
  if (chainId === 56) return "bsc";
  // fallbacks if you ever pass other chains
  return `chain-${chainId}`;
}

/*────────────────────────────────────────────────────────
  Public / Browser providers
────────────────────────────────────────────────────────*/

/** Public provider (read-only) — with network hint to avoid detect/retry */
function getPublicProvider(chainId: number) {
  const rpc = CHAINS[chainId as 56 | 97]?.rpc || CHAINS[97].rpc;
  return new JsonRpcProvider(rpc, {
    chainId,
    name: networkName(chainId),
  });
}

/** Browser provider (write via injected wallet) — with network hint */
function getBrowserProvider(chainId: number = 97): BrowserProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  if (!w?.ethereum) return null;
  return new BrowserProvider(w.ethereum, {
    chainId,
    name: networkName(chainId),
  });
}

/** ✅ Factory contract getter — keep this exact name/signature */
function factoryContract(readonly = true, chainId = 97) {
  // ⬇️ UPDATED: env + fallback, no ".env.local" mention
  const addr = (
    process.env.NEXT_PUBLIC_BSC_FACTORY_ADDRESS ??
    process.env.BSC_FACTORY_ADDRESS ??
    ""
  ).trim();

  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error("Missing or invalid NEXT_PUBLIC_BSC_FACTORY_ADDRESS");
  }

  const provider = readonly ? getPublicProvider(chainId) : getBrowserProvider(chainId);
  if (!provider) throw new Error("No browser provider available");
  return new Contract(addr, FACTORY_ABI, provider as any);
}

/*────────────────────────────────────────────────────────
  Lightweight reads (inline to avoid extra modules)
────────────────────────────────────────────────────────*/

async function readCreationFeeWei(chainId: number): Promise<bigint> {
  const f = factoryContract(true, chainId); // read-only provider
  const fee: bigint = await f.creationFeeWei();
  return fee;
}

/*────────────────────────────────────────────────────────
  Create token + pool (preferred with signer)
────────────────────────────────────────────────────────*/

/** Preferred path: pass a connected Ethers `Signer`. */
async function createTokenAndPoolWithSigner(
  signer: Signer,
  opts: {
    name: string;
    symbol: string;
    creatorFeePercent: string; // "2.0"
    targetCapBNB: string;      // "40"
    initialBuyBNB: string;     // "0.001"
    chainId: number;
  }
) {
  const chainId = opts.chainId ?? 97;

  // ⬇️ UPDATED: env + fallback, no ".env.local" mention
  const factoryAddr = (
    process.env.NEXT_PUBLIC_BSC_FACTORY_ADDRESS ??
    process.env.BSC_FACTORY_ADDRESS ??
    ""
  ).trim();

  if (!/^0x[0-9a-fA-F]{40}$/.test(factoryAddr)) {
    throw new Error("Missing or invalid NEXT_PUBLIC_BSC_FACTORY_ADDRESS");
  }

  // Read fee USING public RPC (don’t hit wallet RPC for this)
  const feeWei: bigint = await readCreationFeeWei(chainId);

  // ✅ Security: cap creator fee at 5% (500 bps)
  const bps = Math.round(Number(opts.creatorFeePercent) * 100);
  if (bps > 500) throw new Error("Creator fee cannot exceed 5%");

  const targetCapWei = parseEther(opts.targetCapBNB || "0.05");
  const initialBuyWei = parseEther(opts.initialBuyBNB || "0");
  const value = feeWei + initialBuyWei;

  const f = new Contract(factoryAddr, FACTORY_ABI, signer) as any;
  const tx = await f.createTokenAndPoolWithFirstBuy(
    opts.name,
    opts.symbol,
    bps,
    targetCapWei,
    initialBuyWei,
    0n, // minTokensOut
    { value }
  );

  const rcpt = await tx.wait();

  // Parse PoolCreated(token, pool) from factory logs
  const iface = new Interface(FACTORY_ABI);
  const facLower = (await f.getAddress()).toLowerCase();

  let token = "";
  let pool = "";

  for (const log of rcpt.logs ?? []) {
    const addr = (log as any).address?.toLowerCase?.();
    if (addr !== facLower) continue;
    try {
      const parsed = iface.parseLog({ topics: (log as any).topics, data: (log as any).data });
      if (parsed?.name === "PoolCreated") {
        token = parsed.args[1];
        pool = parsed.args[2];
        break;
      }
    } catch {}
  }

  return { token, pool, txHash: rcpt.hash };
}

/*────────────────────────────────────────────────────────
  Backward-compat: pick signer (Web3Onboard → injected)
────────────────────────────────────────────────────────*/

/**
 * Preferred: Web3Onboard signer (getEthersSigner) on the requested chain.
 * Fallback: injected `window.ethereum` with BrowserProvider.
 */
async function createTokenAndPool(opts: any) {
  const chainId = opts?.chainId ?? 97;

  // Try Web3Onboard first
  try {
    const hex = `0x${Number(chainId).toString(16)}`;
    // Best-effort chain ensure (no throw if wallet rejects; we try fallback)
    try { await ensureChain(hex); } catch {}
    const signer = await getEthersSigner().catch(() => null as unknown as Signer);
    if (signer) {
      return createTokenAndPoolWithSigner(signer, { ...opts, chainId });
    }
  } catch {
    // ignore and fall through
  }

  // Final fallback (injected) — with network hint
  const eth: any = (globalThis as any).window?.ethereum;
  if (!eth) throw new Error("No wallet found. Open your wallet first.");
  const prov = new BrowserProvider(eth, { chainId, name: networkName(chainId) });
  const signer = await prov.getSigner();
  return createTokenAndPoolWithSigner(signer, { ...opts, chainId });
}

/*────────────────────────────────────────────────────────
  Named exports
────────────────────────────────────────────────────────*/

export {
  // providers + contract getter
  factoryContract,
  getPublicProvider,
  getBrowserProvider,

  // creation helpers
  createTokenAndPool,
  createTokenAndPoolWithSigner,
};
