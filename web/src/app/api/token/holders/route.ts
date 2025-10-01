import { NextResponse } from "next/server";
import { Contract, JsonRpcProvider, Interface, Log } from "ethers";
import { ERC20_ABI } from "@/lib/abi";
import { CHAINS } from "@/lib/chains";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token")!;
    const chain = Number(url.searchParams.get("chain") || "97") as 97 | 56;

    const provider = new JsonRpcProvider(CHAINS[chain].rpc, chain);
    const iface = new Interface(ERC20_ABI);
    const t = new Contract(token, ERC20_ABI, provider);

    // Start from the token's creationBlock if available; otherwise from genesis (0)
    let fromBlock = 0;
    try {
      const cb: bigint = await t.creationBlock();
      fromBlock = Number(cb);
    } catch {}

    const latest = await provider.getBlockNumber();

    const logs: Log[] = await provider.getLogs({
      address: token,
      fromBlock,
      toBlock: latest
    });

    // Reconstruct balances from Transfer events
    const ZERO = "0x0000000000000000000000000000000000000000";
    const balances = new Map<string, bigint>();

    function add(addr: string, delta: bigint) {
      if (!addr) return;
      const prev = balances.get(addr) || 0n;
      const next = prev + delta;
      if (next === 0n) balances.delete(addr);
      else balances.set(addr, next);
    }

    for (const l of logs) {
      try {
        const parsed = iface.parseLog({ topics: l.topics, data: l.data });
        if (parsed?.name !== "Transfer") continue;

        const from = (parsed.args[0] as string) || ZERO;
        const to   = (parsed.args[1] as string) || ZERO;
        const val  = parsed.args[2] as bigint;

        if (from !== ZERO) add(from, -val);
        if (to   !== ZERO) add(to,   val);
      } catch {
        // ignore non-Transfer logs
      }
    }

    const top = Array.from(balances.entries())
      .filter(([_, bal]) => bal > 0n)
      .sort((a, b) => (b[1] > a[1] ? 1 : -1))
      .slice(0, 10)
      .map(([addr, bal]) => ({ addr, balance: bal.toString() }));

    return NextResponse.json(top);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
