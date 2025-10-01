// instrumentation.ts (server-side only)
export async function register() {
    // Avoid double-install
    // @ts-ignore
    if ((globalThis as any).__CR_SERVER_BLOCKED__) return;
    // @ts-ignore
    (globalThis as any).__CR_SERVER_BLOCKED__ = true;
  
    // ---- A) Patch global fetch (covers HTTP JSON-RPC on server) ----
    if (typeof fetch === "function") {
      const origFetch = fetch;
      // @ts-ignore
      globalThis.fetch = (async (input: any, init?: any) => {
        try {
          const body = typeof init?.body === "string" ? init.body : "";
          if (body && body.includes('"method":"eth_getLogs"')) {
            // Log and return empty result so nothing crashes
            try {
              const parsed = JSON.parse(body);
              console.error("[SERVER BLOCK HTTP eth_getLogs]", {
                url: typeof input === "string" ? input : input?.url,
                payload: parsed,
                stack: new Error().stack,
              });
              return new Response(
                JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: [] }),
                { status: 200, headers: { "content-type": "application/json" } }
              );
            } catch {
              // fall through
            }
          }
        } catch {}
        return origFetch(input, init);
      }) as typeof fetch;
    }
  
    // ---- B) Patch ethers provider.getLogs (covers direct getLogs) ----
    try {
      const { JsonRpcProvider } = await import("ethers");
      const proto: any = (JsonRpcProvider as any).prototype;
      const origGetLogs = proto.getLogs;
      proto.getLogs = async function (filter: any) {
        // Hard-stop wide scans so the app can render
        console.error("[SERVER BLOCK provider.getLogs]", {
          filter,
          stack: new Error().stack,
        });
        return []; // return empty logs instead of throwing
      };
    } catch (e) {
      console.error("[instrumentation] failed to patch ethers.getLogs:", e);
    }
  }
  