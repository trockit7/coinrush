// src/lib/poolBuy.ts
import { BrowserProvider, Contract, Interface } from "ethers";

/** Candidate buy signatures seen in the wild */
const CANDIDATES = [
  // a) what your ABI declares
  { sig: "buy(uint256)", args: (minOut: bigint, _to?: string) => [minOut] },

  // b) no-arg buy()
  { sig: "buy()", args: (_minOut: bigint, _to?: string) => [] },

  // c) buy(address to, uint256 minOut)
  { sig: "buy(address,uint256)", args: (minOut: bigint, to?: string) => [to ?? "", minOut] },

  // d) buy(uint256 minOut, address to)
  { sig: "buy(uint256,address)", args: (minOut: bigint, to?: string) => [minOut, to ?? ""] },
];

async function getSigner() {
  const provider = new BrowserProvider((window as any).ethereum);
  return provider.getSigner();
}

/** Try each signature with a static call. Return a caller bound to the working one. */
export async function detectBuySignature(poolAddr: string, toOverride?: string) {
  const signer = await getSigner();
  const provider = signer.provider!;

  for (const cand of CANDIDATES) {
    const iface = new Interface([`function ${cand.sig} payable`]);
    const fn = cand.sig.split("(")[0];
    try {
      const data = iface.encodeFunctionData(fn, cand.args(0n, toOverride));
      // simulate with a dust value; if selector doesn’t exist, this will revert
      await provider.call({ to: poolAddr, data, value: 10_000n });
      // success → this function exists
      return {
        signature: cand.sig,
        async buy(minOut: bigint, bnbInWei: bigint) {
          const c = new Contract(poolAddr, [`function ${cand.sig} payable`], signer);
          const args = cand.args(minOut, toOverride);
          const tx = await (c as any)[fn](...args, { value: bnbInWei });
          return await tx.wait();
        },
      };
    } catch {
      // try next
    }
  }
  throw new Error("Could not find a compatible buy() signature on this pool");
}
