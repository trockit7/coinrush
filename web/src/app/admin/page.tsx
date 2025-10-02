// src/app/admin/page.tsx
"use client";

import React from "react";
import { getBrowserProvider } from "@/lib/eth";            // ✅ keep this
import { useEnsureBsctest } from "@/lib/useEnsureChain";   // ✅ use hook instead of ensureChain
import {
  Contract,
  JsonRpcProvider,
  formatEther,
  parseEther,
  getAddress,
  id as keccakId,
} from "ethers";

const CHAIN_ID = 97; // BSC Testnet

// ⬇️ UPDATED: accept NEXT_PUBLIC_ or non-prefixed, no ".env.local" mention
const FACTORY_ADDR = (process.env.NEXT_PUBLIC_BSC_FACTORY_ADDRESS ?? process.env.BSC_FACTORY_ADDRESS ?? "").trim();

function cleanDec(s: string) {
  return s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}
function numOrNull(s: string) {
  if (!s || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---- helpers ---------------------------------------------------------------
function selectorFromSig(sig: string): string {
  // first 4 bytes of keccak256(signature) without 0x
  const h = keccakId(sig); // ethers v6
  return h.slice(2, 10).toLowerCase();
}

async function callWithSig(runner: any, addr: string, sig: string, args: any[] = []) {
  const fn = sig.split("(")[0].trim();
  const abi = [`function ${sig}`];
  const c = new Contract(addr, abi, runner);
  // @ts-ignore
  return await c[fn](...args);
}

async function readFirst<T>(prov: JsonRpcProvider, addr: string, candidates: string[]): Promise<T> {
  for (const sig of candidates) {
    try {
      const val = await callWithSig(prov, addr, sig);
      return val as T;
    } catch {}
  }
  throw new Error(`ABI mismatch: none of [${candidates.map((s) => s.split("(")[0]).join(", ")}] worked`);
}

async function writeFirst(signer: any, addr: string, candidates: string[], args: any[], preflight = true) {
  let lastErr: any = null;
  for (const sig of candidates) {
    try {
      const fn = sig.split("(")[0].trim();
      const abi = [`function ${sig}`];
      const c = new Contract(addr, abi, signer);
      // @ts-ignore
      if (preflight && typeof c[fn]?.staticCall === "function") {
        // @ts-ignore
        await c[fn].staticCall(...args);
      }
      // @ts-ignore
      const tx = await c[fn](...args);
      return await tx.wait();
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw new Error(
    `No compatible setter among: ${candidates.map((s) => s.split("(")[0]).join(", ")}${
      lastErr ? " (" + (lastErr?.message || String(lastErr)) + ")" : ""
    }`
  );
}

// Detect proxy implementation per EIP-1967
async function getImplementationAddress(prov: JsonRpcProvider, addr: string): Promise<string | null> {
  // bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)
  const slot = "0x360894A13BA1A3210667C828492DB98DCA3E2076CC3735A920A3CA505D382BBC";
  try {
    const raw = await prov.getStorage(addr, slot);
    if (!raw || raw.toLowerCase() === "0x" + "00".repeat(64)) return null;
    const hex = raw.replace(/^0x/, "");
    const last40 = hex.slice(-40);
    if (!/^[0-9a-fA-F]{40}$/.test(last40)) return null;
    const impl = "0x" + last40;
    return getAddress(impl);
  } catch {
    return null;
  }
}

// Does the runtime bytecode contain the 4-byte selector? (heuristic)
async function codeHasSelector(prov: JsonRpcProvider, addr: string, sig: string): Promise<boolean> {
  try {
    const code = await prov.getCode(addr);
    if (!code || code === "0x") return false;
    const sel = selectorFromSig(sig);
    return code.toLowerCase().includes(sel);
  } catch {
    return false;
  }
}

async function readOptional<T>(prov: JsonRpcProvider, addr: string, sig: string): Promise<T | null> {
  try {
    return (await callWithSig(prov, addr, sig)) as T;
  } catch {
    return null;
  }
}

// ---- component -------------------------------------------------------------
export default function AdminPlatformSettingsDebug() {
  const ensureBsctest = useEnsureBsctest(); // ✅ hook to ensure chain 97

  const [owner, setOwner] = React.useState<string>("");
  const [pendingOwner, setPendingOwner] = React.useState<string | null>(null);
  const [account, setAccount] = React.useState<string>("");
  const [bps, setBps] = React.useState<string>("");
  const [creationFee, setCreationFee] = React.useState<string>(""); // in BNB
  const [treasury, setTreasury] = React.useState<string>("");

  const [loading, setLoading] = React.useState(true);
  const [status, setStatus] = React.useState<string>("");

  const [impl, setImpl] = React.useState<string | null>(null);
  const [hasDefaultAdminRole, setHasDefaultAdminRole] = React.useState<boolean | null>(null);

  const [selectorReport, setSelectorReport] = React.useState<Record<string, boolean>>({});
  const [preflightReport, setPreflightReport] = React.useState<Record<string, string>>({});

  const provRef = React.useRef<JsonRpcProvider | null>(null);

  const feeReadCandidates = [
    "platformFeeBps() view returns (uint256)",
    "platformTradeFeeBps() view returns (uint256)",
    "tradeFeeBps() view returns (uint256)",
    "getPlatformFeeBps() view returns (uint256)",
  ];
  const feeWriteCandidates = [
    "setPlatformFeeBps(uint256)",
    "setPlatformTradeFeeBps(uint256)",
    "setTradeFeeBps(uint256)",
    "updatePlatformFeeBps(uint256)",
    "setPlatformFeeBps(uint16)",
    "setPlatformTradeFeeBps(uint16)",
    "setTradeFeeBps(uint16)",
    "updatePlatformFeeBps(uint16)",
  ];
  const creationReadCandidates = [
    "creationFeeWei() view returns (uint256)",
    "creationFee() view returns (uint256)",
    "getCreationFeeWei() view returns (uint256)",
    "getCreationFee() view returns (uint256)",
  ];
  const creationWriteCandidates = [
    "setCreationFeeWei(uint256)",
    "setCreationFee(uint256)",
    "updateCreationFeeWei(uint256)",
    "updateCreationFee(uint256)",
    "setFee(uint256)",
  ];
  const treasuryReadCandidates = [
    "treasury() view returns (address)",
    "platform() view returns (address)",
    "feeRecipient() view returns (address)",
    "protocolFeeRecipient() view returns (address)",
    "feeTo() view returns (address)",
    "platformWallet() view returns (address)",
    "platformTreasury() view returns (address)",
    "treasuryAddr() view returns (address)",
    "feeTreasury() view returns (address)",
  ];
  const treasuryWriteCandidates = [
    "setTreasury(address)",
    "setPlatform(address)",
    "setFeeRecipient(address)",
    "setProtocolFeeRecipient(address)",
    "setFeeTo(address)",
    "setPlatformWallet(address)",
    "setPlatformTreasury(address)",
    "setTreasuryAddress(address)",
    "updateTreasury(address)",
  ];

  async function reload(prov: JsonRpcProvider) {
    // ⬇️ UPDATED validation + message
    if (!/^0x[0-9a-fA-F]{40}$/.test(FACTORY_ADDR)) {
      throw new Error("Missing or invalid NEXT_PUBLIC_BSC_FACTORY_ADDRESS");
    }

    const code = await prov.getCode(FACTORY_ADDR);
    if (!code || code === "0x") throw new Error("No contract at FACTORY_ADDR on this chain");

    const feeBpsVal = await readFirst<any>(prov, FACTORY_ADDR, feeReadCandidates);
    const feeWeiVal = await readFirst<bigint>(prov, FACTORY_ADDR, creationReadCandidates);
    const tre = await readFirst<string>(prov, FACTORY_ADDR, treasuryReadCandidates);
    const own = await readFirst<string>(prov, FACTORY_ADDR, ["owner() view returns (address)", "getOwner() view returns (address)"]);
    const pOwn = await readOptional<string>(prov, FACTORY_ADDR, "pendingOwner() view returns (address)");

    setBps(String(Number(feeBpsVal)));
    setCreationFee(formatEther(feeWeiVal));
    setTreasury(tre);
    setOwner(own);
    setPendingOwner(pOwn);

    // Proxy impl (if any)
    const implAddr = await getImplementationAddress(prov, FACTORY_ADDR);
    setImpl(implAddr);

    // AccessControl: DEFAULT_ADMIN_ROLE / hasRole
    let hasDAR: boolean | null = null;
    if (account) {
      try {
        const role: string = await callWithSig(prov, FACTORY_ADDR, "DEFAULT_ADMIN_ROLE() view returns (bytes32)");
        try {
          const v: boolean = await callWithSig(
            prov,
            FACTORY_ADDR,
            "hasRole(bytes32,address) view returns (bool)",
            [role, account]
          );
          hasDAR = Boolean(v);
        } catch {
          hasDAR = null;
        }
      } catch {
        hasDAR = null;
      }
    }
    setHasDefaultAdminRole(hasDAR);

    // Selector presence scan (bytecode heuristic; if proxy, also scan impl)
    const scanTargets = implAddr ? [FACTORY_ADDR, implAddr] : [FACTORY_ADDR];
    const report: Record<string, boolean> = {};
    for (const fn of [...feeWriteCandidates, ...creationWriteCandidates, ...treasuryWriteCandidates]) {
      let present = false;
      for (const addr of scanTargets) {
        // eslint-disable-next-line no-await-in-loop
        const has = await codeHasSelector(prov, addr, fn);
        if (has) {
          present = true;
          break;
        }
      }
      report[fn] = present;
    }
    setSelectorReport(report);
  }

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { CHAIN_RPC } = await import("@/lib/chains");
        const prov = new JsonRpcProvider(CHAIN_RPC[CHAIN_ID][0], { chainId: CHAIN_ID, name: "bsctest" });
        provRef.current = prov;
        await reload(prov);
      } catch (e: any) {
        if (!cancelled) setStatus("Load failed: " + (e.message || String(e)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account]);

  async function connect() {
    const prov = getBrowserProvider();
    if (!prov) {
      setStatus("No wallet");
      return;
    }

    const [acc] = await prov.send("eth_requestAccounts", []);
    setAccount(acc);
  }

  const isOwner =
    owner && account && owner.toLowerCase() === account.toLowerCase();

  async function preflightSetters(kind: "fee" | "creation" | "treasury") {
    setStatus("Preflighting setters…");
    const prov = getBrowserProvider();
    if (!prov) {
      setStatus("No wallet");
      return;
    }

    const signer = await prov.getSigner();
    const report: Record<string, string> = {};
    const candidates =
      kind === "fee" ? feeWriteCandidates : kind === "creation" ? creationWriteCandidates : treasuryWriteCandidates;
    const arg =
      kind === "fee"
        ? [Number(bps || "0")]
        : kind === "creation"
        ? [parseEther(String(numOrNull(creationFee) ?? 0))]
        : [treasury];
    for (const sig of candidates) {
      try {
        const fn = sig.split("(")[0].trim();
        const abi = [`function ${sig}`];
        const c = new Contract(FACTORY_ADDR, abi, signer);
        // @ts-ignore
        if (typeof c[fn]?.staticCall === "function") {
          // @ts-ignore
          await c[fn].staticCall(...arg);
          report[sig] = "OK";
        } else {
          report[sig] = "no staticCall";
        }
      } catch (e: any) {
        report[sig] = e?.shortMessage || e?.message || "revert";
      }
    }
    setPreflightReport(report);
    setStatus("Preflight done.");
  }

  async function updateBps() {
    try {
      const n = Number(bps);
      if (!Number.isFinite(n) || n < 0 || n > 5000) {
        setStatus("Enter BPS 0–5000");
        return;
      }
      setStatus("Updating platform fee…");
      const prov = getBrowserProvider();
      if (!prov) throw new Error("No wallet");

      const signer = await prov.getSigner();

      await writeFirst(signer, FACTORY_ADDR, feeWriteCandidates, [n], true);
      setStatus("Platform fee updated ✅");
      if (provRef.current) await reload(provRef.current);
    } catch (e: any) {
      setStatus(
        "Update failed: " +
          (e.message || String(e)) +
          (owner && account && owner.toLowerCase() !== account.toLowerCase()
            ? " — Connected wallet is not the factory owner."
            : "")
      );
    }
  }

  async function updateCreationFee() {
    try {
      const v = numOrNull(creationFee);
      if (v == null || v < 0) {
        setStatus("Enter valid fee in BNB");
        return;
      }
      setStatus("Updating creation fee…");
      const prov = getBrowserProvider();
      if (!prov) throw new Error("No wallet");

      const signer = await prov.getSigner();

      await writeFirst(signer, FACTORY_ADDR, creationWriteCandidates, [parseEther(String(v))], true);
      setStatus("Creation fee updated ✅");
      if (provRef.current) await reload(provRef.current);
    } catch (e: any) {
      setStatus(
        "Update failed: " +
          (e.message || String(e)) +
          (owner && account && owner.toLowerCase() !== account.toLowerCase()
            ? " — Connected wallet is not the factory owner."
            : "")
      );
    }
  }

  async function updateTreasury() {
    try {
      if (!/^0x[a-fA-F0-9]{40}$/.test(treasury)) {
        setStatus("Enter valid EVM address");
        return;
      }
      setStatus("Updating treasury…");
      const prov = getBrowserProvider();
      if (!prov) throw new Error("No wallet");

      const signer = await prov.getSigner();

      await writeFirst(signer, FACTORY_ADDR, treasuryWriteCandidates, [treasury], true);
      setStatus("Treasury updated ✅");
      if (provRef.current) await reload(provRef.current);
    } catch (e: any) {
      setStatus(
        "Update failed: " +
          (e.message || String(e)) +
          (owner && account && owner.toLowerCase() !== account.toLowerCase()
            ? " — Connected wallet is not the factory owner."
            : "")
      );
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      <h1 className="text-2xl font-bold">Platform Settings (Debug)</h1>

      <div className="rounded-2xl border p-4">
        <div className="text-sm opacity-70 mb-2">Factory</div>
        <div className="font-mono text-xs break-all">{FACTORY_ADDR || "—"}</div>
        {impl && (
          <div className="text-xs opacity-70 mt-1">
            Impl (EIP-1967): <span className="font-mono">{impl}</span>
          </div>
        )}
      </div>

      <div className="rounded-2xl border p-4 space-y-2">
        <button onClick={connect} className="px-3 py-2 rounded-xl border">
          {account ? `Connected: ${account.slice(0, 6)}…${account.slice(-4)}` : "Connect Wallet"}
        </button>
        {!loading && owner && (
          <div className="text-xs opacity-70">
            Owner: {owner.slice(0, 6)}…{owner.slice(-4)}
            {pendingOwner ? ` (pendingOwner: ${pendingOwner.slice(0, 6)}…${pendingOwner.slice(-4)})` : ""}
          </div>
        )}
        {!loading && hasDefaultAdminRole != null && (
          <div className="text-xs opacity-70">
            DEFAULT_ADMIN_ROLE on connected? {hasDefaultAdminRole ? "YES" : "NO / N/A"}
          </div>
        )}
        {!owner || (owner && account && owner.toLowerCase() !== account.toLowerCase()) ? (
          <div className="text-xs text-red-600">You must connect the owner wallet to make changes.</div>
        ) : null}
      </div>

      <div className="rounded-2xl border p-4 space-y-3">
        <div className="text-sm font-semibold">Platform Trade Fee (BPS)</div>
        <input
          className="w-full rounded-xl border px-3 py-2 bg-transparent"
          inputMode="numeric"
          value={bps}
          onChange={(e) => setBps(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="95"
        />
        <div className="flex gap-2">
          <button disabled={!isOwner} onClick={updateBps} className="px-3 py-2 rounded-xl border">
            Save
          </button>
          <button disabled={!account} onClick={() => preflightSetters("fee")} className="px-3 py-2 rounded-xl border">
            Preflight
          </button>
        </div>
        <div className="text-xs opacity-60">Example: 95 = 0.95%</div>
      </div>

      <div className="rounded-2xl border p-4 space-y-3">
        <div className="text-sm font-semibold">Creation Fee (BNB)</div>
        <input
          className="w-full rounded-xl border px-3 py-2 bg-transparent"
          inputMode="decimal"
          value={creationFee}
          onChange={(e) => setCreationFee(cleanDec(e.target.value))}
          placeholder="0.01"
        />
        <div className="flex gap-2">
          <button disabled={!isOwner} onClick={updateCreationFee} className="px-3 py-2 rounded-xl border">
            Save
          </button>
          <button disabled={!account} onClick={() => preflightSetters("creation")} className="px-3 py-2 rounded-xl border">
            Preflight
          </button>
        </div>
      </div>

      <div className="rounded-2xl border p-4 space-y-3">
        <div className="text-sm font-semibold">Treasury Address</div>
        <input
          className="w-full rounded-xl border px-3 py-2 bg-transparent font-mono"
          value={treasury}
          onChange={(e) => setTreasury(e.target.value.trim())}
          placeholder="0x…"
        />
        <div className="flex gap-2">
          <button disabled={!isOwner} onClick={updateTreasury} className="px-3 py-2 rounded-xl border">
            Save
          </button>
          <button disabled={!account} onClick={() => preflightSetters("treasury")} className="px-3 py-2 rounded-xl border">
            Preflight
          </button>
        </div>
      </div>

      {/* Diagnostics */}
      <div className="rounded-2xl border p-4 space-y-3">
        <div className="text-sm font-semibold">Diagnostics</div>
        <div className="text-xs">
          <div className="mb-2">Selector presence (bytecode scan{impl ? " incl. impl" : ""}):</div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(selectorReport).map(([k, v]) => (
              <li key={k}>
                <span className="font-mono">{k.split("(")[0]}</span>: {v ? "present" : "—"}
              </li>
            ))}
          </ul>
        </div>
        {Object.keys(preflightReport).length > 0 && (
          <div className="text-xs">
            <div className="mb-1">Preflight staticCall results:</div>
            <ul className="space-y-1">
              {Object.entries(preflightReport).map(([k, v]) => (
                <li key={k}>
                  <span className="font-mono">{k}</span> → {v}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {status && <div className="rounded-2xl border p-4 text-sm whitespace-pre-wrap">{status}</div>}
    </div>
  );
}
