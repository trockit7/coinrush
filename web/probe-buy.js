// probe-buy.js
import { JsonRpcProvider, Interface } from "ethers";

// EDIT these two:
const RPC  = process.env.NEXT_PUBLIC_BSC_HTTP_1 || "https://bsc-testnet.publicnode.com";
const POOL = "0xYOUR_POOL_ADDRESS_HERE"; // <-- paste the failing pool

const FROM = "0x0000000000000000000000000000000000000001"; // dummy "from" for eth_call

// We try common buy shapes; encoder will use the *signature* string:
const candidates = [
  "buy(uint256)",
  "buy()",
  "buy(address,uint256)",
  "buy(uint256,address)",
];

async function run () {
  const p = new JsonRpcProvider(RPC, 97);

  for (const sig of candidates) {
    // Build a minimal ABI for this candidate (fragments *can* have "function ... payable")
    const fragment = `function ${sig} payable`;
    const iface = new Interface([fragment]);

    // Args to match the signature (use 0n to avoid slippage logic)
    let args = [];
    if (sig === "buy(uint256)") args = [0n];
    if (sig === "buy(address,uint256)") args = [FROM, 0n];
    if (sig === "buy(uint256,address)") args = [0n, FROM];

    try {
      // IMPORTANT: encodeFunctionData expects the signature or name; we pass the signature.
      const data = iface.encodeFunctionData(sig, args);

      // eth_call "probes" the selector (we also set 'from' and a tiny 'value' since buy is payable)
      await p.call({ to: POOL, from: FROM, data, value: 1n });

      console.log("ACCEPTED:", sig);
    } catch (e) {
      const msg = (e?.shortMessage || e?.message || String(e)).slice(0, 160);
      console.log("revert:", sig, "-", msg);
    }
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
