// src/lib/abi.ts
import type { Abi } from "abitype";
import poolAbi from "./abi/pool.generated.json";

export const POOL_ABI = poolAbi as unknown as Abi;

/* =========================
   Factory (deploy + first buy)
   ========================= */
export const FACTORY_ABI = [
  // --- reads ---
  "function creationFeeWei() view returns (uint256)",
  "function platformFeeBps() view returns (uint16)",

  // --- writes ---
  // Creates token + pool and performs the initial buy in the same tx.
  // Returns addresses so you can read them from the receipt.
  "function createTokenAndPoolWithFirstBuy(string name,string symbol,uint16 creatorFeeBps,uint256 targetCapWei,uint256 initialBuyWei,uint256 minTokensOut) payable returns (address token,address pool)",

  // --- events ---
  // Emitted after creation; args order: (creator, token, pool)
  "event PoolCreated(address indexed creator, address token, address pool)",
] as const;

/* =========================
   Minimal ERC-20
   ========================= */
export const ERC20_ABI = [
  // --- reads ---
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",

  // --- writes ---
  "function approve(address spender, uint256 amount) returns (bool)",

  // Nonstandard (present on your tokens; safe to include as optional reads)
  "function creationBlock() view returns (uint256)",
  "function creatorFeeBps() view returns (uint16)",

  // --- events ---
  "event Transfer(address indexed from, address indexed to, uint256 value)",
] as const;

/* =========================
   OPTIONAL: Human-readable pool fragments
   Keep this if some parts of the app expect string fragments.
   ========================= */
export const POOL_MIN_ABI = [
  // --- reads ---
  "function token() view returns (address)",
  "function owner() view returns (address)",
  "function creator() view returns (address)",
  "function platform() view returns (address)",
  "function x0() view returns (uint256)",
  "function y0() view returns (uint256)",
  "function reserveNative() view returns (uint256)",
  "function reserveToken() view returns (uint256)",
  "function priceWeiPerToken() view returns (uint256)",
  "function marketCapWei() view returns (uint256)",
  "function targetMarketCapWei() view returns (uint256)",
  "function creationBlock() view returns (uint256)",
  // Some pools expose `migrated()`, others `isMigrated()`. Your code can guard this dynamically.
  "function migrated() view returns (bool)",
  "function creatorFeeBps() view returns (uint16)",

  // Optional starter tranche (callers should handle absence)
  "function p0WeiPerToken() view returns (uint256)",
  "function starterTrancheTokens() view returns (uint256)",
  "function starterSold() view returns (uint256)",

  // --- writes ---
  "function buy(uint256 minTokensOut) payable",
  "function sell(uint256 tokensIn, uint256 minBnbOut)",
  "function migrate(address router,address lpRecipient)",

  // --- events ---
  "event Buy(address indexed buyer, uint256 bnbIn, uint256 tokensOut, uint256 priceWeiPerToken)",
  "event Sell(address indexed seller, uint256 tokenIn, uint256 bnbOut, uint256 priceWeiPerToken)",
] as const;
