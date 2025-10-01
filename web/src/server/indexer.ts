// src/server/indexer.ts
import { JsonRpcProvider, WebSocketProvider, Contract, Interface, id as keccakId } from "ethers";
import db from "./db";

// ======= ENV & CONSTANTS =======
const CHAIN_ID = Number(process.env.CHAIN_ID || 97);
const FACTORY  = (process.env.NEXT_PUBLIC_BSC_FACTORY_ADDRESS || "").trim();
if (!/^0x[a-fA-F0-9]{40}$/.test(FACTORY)) throw new Error("Set NEXT_PUBLIC_BSC_FACTORY_ADDRESS in .env.local");

const HTTP_ENDPOINTS = [
  process.env.BSC_HTTP_1,
  process.env.BSC_HTTP_2,
  process.env.BSC_HTTP_3,
  process.env.BSC_HTTP_4,
  process.env.BSC_HTTP_5
].filter(Boolean) as string[];

const WSS_ENDPOINT = (process.env.BSC_WSS_1 || "").trim();

// keep each request below strict RPC caps (you saw 50k). We'll use <= 5k.
const MAX_WINDOW = Number(process.env.LOGS_MAX_WINDOW || 5000);

// ======= ETHERS-FRIENDLY ABIs (string fragments) =======
// Minimal pool ABI needed here
const POOL_ABI_MIN = [
  "function token() view returns (address)",
  "function creationBlock() view returns (uint256)"
] as const;

// Minimal factory iface for parsing events
const FACTORY_IFACE = new Interface([
  // We only need the shape; arg order used below: [0],[1],[2]
  "event PoolCreated(address indexed a, address indexed b, address c)"
]);

// ======= PROVIDERS =======
async function getHttpProvider(): Promise<JsonRpcProvider> {
  if (!HTTP_ENDPOINTS.length) throw new Error("Add BSC_HTTP_1 in .env.local");
  let lastErr: any;
  for (const url of HTTP_ENDPOINTS) {
    try {
      const p = new JsonRpcProvider(url!, CHAIN_ID);
      await p.getBlockNumber(); // ping
      console.log(`[indexer] HTTP OK: ${url}`);
      return p;
    } catch (e) { lastErr = e; console.warn(`[indexer] HTTP failed: ${url} (${(e as any)?.message})`); }
  }
  throw new Error(`All HTTP RPCs failed: ${lastErr?.message || lastErr}`);
}

function getWssProvider(): WebSocketProvider | null {
  if (!WSS_ENDPOINT) return null;
  try {
    const w = new WebSocketProvider(WSS_ENDPOINT, CHAIN_ID);
    console.log(`[indexer] WSS OK: ${WSS_ENDPOINT}`);
    return w;
  } catch (e:any) {
    console.warn(`[indexer] WSS failed: ${e.message}`);
    return null;
  }
}

// ======= LOG HELPERS (CHUNKING) =======
async function getLogsChunkedForward(
  provider: JsonRpcProvider,
  filter: { address: string; topics: any },
  fromBlock: number,
  toBlock: number,
  maxWindow = MAX_WINDOW
) {
  const logs: any[] = [];
  let start = fromBlock;
  let step  = Math.min(maxWindow, 5000); // be conservative

  while (start <= toBlock) {
    const end = Math.min(start + step, toBlock);
    try {
      const part = await provider.getLogs({ ...filter, fromBlock: start, toBlock: end });
      logs.push(...part);
      start = end + 1;
      if (step < maxWindow) step = Math.min(maxWindow, Math.floor(step * 2)); // grow if healthy
    } catch (e: any) {
      const s = (e?.message || "").toLowerCase();
      const tooLarge = e?.code === -32701 || e?.code === -32062 || s.includes("block range is too large");
      const internal = e?.code === -32603 || s.includes("internal json-rpc");
      if ((tooLarge || internal) && step > 64) {
        step = Math.max(64, Math.floor(step / 2)); // shrink and retry same window
        continue;
      }
      throw e;
    }
  }
  return logs;
}

async function getLogsBackfillNewestFirst(
  provider: JsonRpcProvider,
  filter: { address: string; topics: any },
  fromBlock: number,
  toBlock: number,
  wantCount: number,
  maxWindow = MAX_WINDOW
) {
  const logs: any[] = [];
  let end = toBlock;
  let step = Math.min(maxWindow, 4000);

  while (end >= fromBlock && logs.length < wantCount) {
    const start = Math.max(fromBlock, end - step);
    try {
      const part = await provider.getLogs({ ...filter, fromBlock: start, toBlock: end });
      logs.push(...part);
      end = start - 1;
      if (step < maxWindow) step = Math.min(maxWindow, Math.floor(step * 2));
    } catch (e: any) {
      const s = (e?.message || "").toLowerCase();
      const tooLarge = e?.code === -32701 || e?.code === -32062 || s.includes("block range is too large");
      const internal = e?.code === -32603 || s.includes("internal json-rpc");
      if ((tooLarge || internal) && step > 64) {
        step = Math.max(64, Math.floor(step / 2));
        continue;
      }
      throw e;
    }
  }
  return logs;
}

// ======= DB HELPERS =======
type MetaRow = { pool: string; token: string; creationBlock: number; lastScanned: number };

// meta(pool TEXT PRIMARY KEY, token TEXT, creationBlock INTEGER, lastScanned INTEGER)
function upsertMeta(pool: string, token: string, creationBlock: number) {
  db.prepare(
    "INSERT INTO meta(pool, token, creationBlock, lastScanned) VALUES (?,?,?,?) " +
    "ON CONFLICT(pool) DO UPDATE SET token=excluded.token, creationBlock=excluded.creationBlock"
  ).run(pool, token, creationBlock, creationBlock);
}

function getMeta(pool: string): MetaRow | undefined {
  const row = db
    .prepare("SELECT pool, token, creationBlock, lastScanned FROM meta WHERE pool=?")
    .get(pool) as MetaRow | undefined;
  return row;
}

function setLastScanned(pool: string, block: number) {
  db.prepare("UPDATE meta SET lastScanned=? WHERE pool=?").run(block, pool);
}

// balances(token TEXT, address TEXT, balance TEXT, PRIMARY KEY(token,address))
function addBalance(token: string, addr: string, delta: bigint) {
  const row = db
    .prepare("SELECT balance FROM balances WHERE token=? AND address=?")
    .get(token, addr) as { balance: string } | undefined;
  const cur = row ? BigInt(row.balance) : 0n;
  const next = cur + delta;
  db.prepare(
    "INSERT INTO balances(token,address,balance) VALUES (?,?,?) " +
    "ON CONFLICT(token,address) DO UPDATE SET balance=excluded.balance"
  ).run(token, addr, next.toString());
}

// ======= CORE FUNCTIONS =======
async function ensurePoolTracked(http: JsonRpcProvider, pool: string) {
  const meta = getMeta(pool);
  if (meta) return;

  // ✅ Use ethers-friendly ABI fragments here
  const p = new Contract(pool, POOL_ABI_MIN, http) as any;
  const token: string = (await p.token()).toLowerCase();
  let creationBlock = 0;
  try { creationBlock = Number(await p.creationBlock()); } catch {}
  if (!creationBlock) {
    // fallback: last ~200k blocks
    const latest = await http.getBlockNumber();
    creationBlock = Math.max(0, latest - 200_000);
  }
  upsertMeta(pool, token, creationBlock);
  console.log(`[indexer] track pool ${pool} token ${token} from block ${creationBlock}`);
}

async function backfillTransfers(http: JsonRpcProvider, pool: string) {
  const meta = getMeta(pool);
  if (!meta) return;
  const { token, lastScanned } = meta;

  const latest = await http.getBlockNumber();
  if (latest <= lastScanned) return;

  const topicTransfer = keccakId("Transfer(address,address,uint256)");
  const ZERO = "0x0000000000000000000000000000000000000000";

  let from = lastScanned + 1;

  while (from <= latest) {
    const to = Math.min(from + MAX_WINDOW, latest);
    const logs = await getLogsChunkedForward(http, { address: token, topics: [topicTransfer] }, from, to, MAX_WINDOW);
    for (const l of logs) {
      const fromA = ("0x" + l.topics[1].slice(26)).toLowerCase();
      const toA   = ("0x" + l.topics[2].slice(26)).toLowerCase();
      const amt   = BigInt(l.data);
      if (fromA !== ZERO) addBalance(token, fromA, -amt);
      if (toA   !== ZERO) addBalance(token, toA,    amt);
    }
    setLastScanned(pool, to);
    from = to + 1;
    console.log(`[indexer] ${pool} scanned up to ${to} (latest ${latest})`);
  }
}

// ======= MAIN =======
async function main() {
  const http = await getHttpProvider();
  const wss  = getWssProvider();

  // We only need the topic and Interface with the right event
  const topicPoolCreated = keccakId("PoolCreated(address,address,address)");
  const latest = await http.getBlockNumber();
  const bootstrapWindow = Number(process.env.FACTORY_BOOTSTRAP_WINDOW || 200_000);
  const from = Math.max(0, latest - bootstrapWindow);

  // ---- CHUNKED bootstrap: read recent PoolCreated logs in windows <= MAX_WINDOW ----
  console.log(`[indexer] bootstrap PoolCreated from ${from} to ${latest} (windows <= ${MAX_WINDOW})`);
  const factoryLogs = await getLogsChunkedForward(
    http,
    { address: FACTORY, topics: [topicPoolCreated] },
    from,
    latest,
    MAX_WINDOW
  );

  for (const l of factoryLogs) {
    try {
      const parsed = FACTORY_IFACE.parseLog({ topics: l.topics, data: l.data });
      if (!parsed) continue;
      // three addresses; pool expected at index 2 in your original code
      const pool: string = String((parsed as any).args?.[2] ?? "").toLowerCase();
      if (!/^0x[a-fA-F0-9]{40}$/.test(pool)) continue;
      await ensurePoolTracked(http, pool);
      // kick off backfill (no await to keep bootstrap fast)
      backfillTransfers(http, pool).catch((e) =>
        console.warn(`[indexer] backfill error for ${pool}:`, e?.message || e)
      );
    } catch {}
  }

  // ---- WSS subscribe to new pools (optional) ----
  if (wss) {
    wss.on({ address: FACTORY, topics: [topicPoolCreated] }, async (log) => {
      try {
        const parsed = FACTORY_IFACE.parseLog({ topics: log.topics, data: log.data });
        if (!parsed) return;
        const pool: string = String((parsed as any).args?.[2] ?? "").toLowerCase();
        if (!/^0x[a-fA-F0-9]{40}$/.test(pool)) return;
        console.log(`[indexer] NEW pool via WSS: ${pool}`);
        await ensurePoolTracked(http, pool);
        backfillTransfers(http, pool).catch(() => {});
      } catch {}
    });
  }

  const countRow = db.prepare("SELECT COUNT(*) as n FROM meta").get() as { n: number };
  console.log(`[indexer] ready. Tracking ${countRow?.n ?? 0} pools.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
