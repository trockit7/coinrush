// src/lib/format.ts
import { parseUnits } from "ethers";

export const ZERO = "0x0000000000000000000000000000000000000000";
export const DEAD = "0x000000000000000000000000000000000000dEaD";
export const WAD = 10n ** 18n;
export const DECIMAL_RE = /^\d*(\.\d{0,18})?$/;

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const trimZeros = (s: string) => s.replace(/(\.\d*?[1-9])0+$|\.0+$/,"$1");

export function cleanDecimalInput(raw: string) {
  const only = raw.replace(/[^\d.]/g, "");
  return only.replace(/(\..*)\./g, "$1");
}
export function isDecimalLike(raw: string) {
  return DECIMAL_RE.test(raw);
}
export function numberFromInput(raw: string): number | null {
  if (!isDecimalLike(raw) || raw === "" || raw === ".") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
export function toUnitsSafe(raw: string, decimals: number): bigint | null {
  if (!isDecimalLike(raw) || raw === "" || raw === ".") return null;
  try { return parseUnits(raw, decimals); } catch { return null; }
}

export function fmtBNB(n: number, maxWhole = 8) {
  if (!isFinite(n)) return "—";
  if (n === 0) return "0";
  if (Math.abs(n) < 1) return n.toLocaleString(undefined, { maximumFractionDigits: 12 });
  return n.toLocaleString(undefined, { maximumFractionDigits: maxWhole });
}
export function fmtUSD(n: number, bigDp = 2, smallDp = 7) {
  if (!isFinite(n)) return "—";
  if (n >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: bigDp })}`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: smallDp })}`;
}

export function minusBps(amountWei: bigint, bps: number) {
  const b = BigInt(Math.max(0, Math.min(10000, bps)));
  return (amountWei * (10000n - b)) / 10000n;
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
