"use client";
/** Blocks huge eth_getLogs scans on this page so the UI cannot crash. */
export function blockEthLogsOnThisPage() {
  if ((globalThis as any).__CR_BLOCK_LOGS__) return;
  (globalThis as any).__CR_BLOCK_LOGS__ = true;

  // 1) Patch fetch (HTTP JSON-RPC)
  try {
    const orig = window.fetch;
    window.fetch = async (...args) => {
      const [url, opts] = args;
      try {
        const s = typeof opts?.body === "string" ? opts.body : "";
        if (s.includes('"method":"eth_getLogs"')) {
          // Return empty result instead of throwing from RPC
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(s).id, result: [] }), {
            status: 200, headers: { "content-type": "application/json" }
          });
        }
      } catch {}
      return orig(...args);
    };
  } catch {}

  // 2) Patch ethers HTTP provider (extra safety)
  import("ethers").then(({ JsonRpcProvider }) => {
    const proto: any = (JsonRpcProvider as any).prototype;
    const origGetLogs = proto.getLogs;
    proto.getLogs = async function (filter: any) {
      try {
        // If a caller still reaches here, return [] instead of hitting RPC
        console.warn("[blocked eth_getLogs]", filter);
        return [];
      } catch {
        return [];
      }
    };
  }).catch(()=>{});
}
