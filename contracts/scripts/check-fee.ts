// scripts/check-fee.ts
import { Contract, JsonRpcProvider } from "ethers";

const POOL = "0x90a2167cb641C7f33e21671d12a381702e37Bc79".toLowerCase();
const TARGET = "0x53dEa4ED05C6AEaE13f6bDC827761eFc42695225".toLowerCase();

// Minimal ABI for reads; functions may be optional on some builds.
const ABI = [
  "function platform() view returns (address)",
  "function platformFeeBps() view returns (uint256)",
  "function creator() view returns (address)",
  "function creatorFeeBps() view returns (uint256)",
];

type Net = { name: "bsc" | "bscTestnet"; rpc: string };

const NETWORKS: Net[] = [
  { name: "bsc",        rpc: "https://bsc-dataseed.binance.org/" },
  { name: "bsc",        rpc: "https://rpc.ankr.com/bsc" },
  { name: "bscTestnet", rpc: "https://bsc-testnet.publicnode.com" },
  { name: "bscTestnet", rpc: "https://data-seed-prebsc-1-s1.binance.org:8545" },
];

async function readOn(net: Net) {
  const prov = new JsonRpcProvider(net.rpc);
  const code = await prov.getCode(POOL);
  if (!code || code === "0x") return null; // no contract here

  const pool = new Contract(POOL, ABI, prov);

  // Try reads defensively; some builds may omit creator fields
  let platform: string | null = null;
  let platformFeeBps: number | null = null;
  let creator: string | null = null;
  let creatorFeeBps: number | null = null;

  try { platform = (await pool.platform())?.toLowerCase?.() || null; } catch {}
  try { platformFeeBps = Number(await pool.platformFeeBps()); } catch {}
  try { creator = (await pool.creator())?.toLowerCase?.() || null; } catch {}
  try { creatorFeeBps = Number(await pool.creatorFeeBps()); } catch {}

  return { net, platform, platformFeeBps, creator, creatorFeeBps };
}

async function main() {
  for (const net of NETWORKS) {
    try {
      const res = await readOn(net);
      if (!res) continue;

      const { platform, platformFeeBps, creator, creatorFeeBps } = res;

      console.log(`Network: ${net.name} @ ${net.rpc}`);
      console.log(`platform: ${platform ?? "—"}`);
      console.log(`platformFeeBps: ${platformFeeBps ?? NaN} bps (${platformFeeBps != null ? platformFeeBps/100 : NaN}%)`);
      if (creator) {
        console.log(`creator: ${creator}`);
        if (creatorFeeBps != null) {
          console.log(`creatorFeeBps: ${creatorFeeBps} bps (${creatorFeeBps/100}%)`);
        }
      }

      const walletMatches = (platform || "") === TARGET;
      const isExactlyPoint3 = platformFeeBps === 30;

      console.log(`→ Platform wallet matches target? ${walletMatches ? "YES" : "NO"}`);
      console.log(`→ Is platform fee exactly 0.3%? ${isExactlyPoint3 ? "YES" : "NO"}`);

      // If we reached here, we found the right chain; no need to try others.
      return;
    } catch (e) {
      // try next net
    }
  }
  console.error("Could not find deployed code for the pool on tested endpoints.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
