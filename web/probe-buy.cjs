// probe-buy.cjs
const { JsonRpcProvider, Interface } = require("ethers");

// ====== EDIT THESE TWO LINES ======
const RPC = process.env.NEXT_PUBLIC_BSC_HTTP_1 || "https://bsc-testnet-rpc.publicnode.com"; // your BSC testnet RPC
const POOL = "0x238d7fe6308c0f5689e66fef00f58df57ae1cc9d"; // <-- paste the failing pool address
// ==================================

const FROM = "0x0000000000000000000000000000000000000001"; // explicit 'from' so ethers doesn't try anything fancy

// Try the common variants. We’ll eth_call each selector with dummy args.
// If the selector exists and doesn’t immediately revert, we’ll see ACCEPTED.
const candidateSigs = [
"function buy(uint256) payable",
"function buy() payable",
"function buy(address,uint256) payable",
"function buy(uint256,address) payable",
];

(async () => {
const p = new JsonRpcProvider(RPC, 97);
for (const sig of candidateSigs) {
const fn = sig.slice("function ".length).split("(")[0];
const iface = new Interface([sig]);

// Build dummy args that match the shape
let args = [];
if (sig === "function buy(uint256) payable") args = [0n];
if (sig === "function buy() payable") args = [];
if (sig === "function buy(address,uint256) payable") args = [FROM, 0n];
if (sig === "function buy(uint256,address) payable") args = [0n, FROM];

const data = iface.encodeFunctionData(fn, args);

try {
// IMPORTANT: set value: 0n and from: explicit address to avoid ENS issues
await p.call({ to: POOL, from: FROM, data, value: 0n });
console.log("ACCEPTED:", sig);
} catch (e) {
const msg = (e && (e.shortMessage || e.message || String(e))) || "error";
console.log("revert:", sig, "-", msg.split("\n")[0]);
}
}
})();