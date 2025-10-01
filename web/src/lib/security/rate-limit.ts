// src/lib/security/rate-limit.ts
/**
 * Lightweight sliding-window rate limiter (memory-based).
 * Works in both Node and Edge runtimes (no native Node APIs used).
 *
 * Usage (in an API route):
 *   import { rateLimit } from "@/lib/security/rate-limit";
 *   export const runtime = "nodejs"; // or "edge"
 *
 *   export async function POST(req: Request) {
 *     const { allowed, headers } = rateLimit(req, { windowMs: 60_000, max: 60 });
 *     if (!allowed) return new Response(JSON.stringify({ error: "Too many requests" }), { status: 429, headers });
 *     // ... handle request
 *     return new Response(JSON.stringify({ ok: true }), { headers });
 *   }
 */

 export type RateLimitResult = {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Seconds until the window resets (integer) */
  retryAfterSec: number;
  /** Requests remaining in this window (never below 0) */
  remaining: number;
  /** Unix millis when this key’s window resets (best-effort) */
  resetAt: number;
  /** Standard-ish headers to return with the response */
  headers: HeadersInit;
};

export type RateLimitOptions = {
  /** Sliding window size in ms (default 60_000) */
  windowMs?: number;
  /** Max requests allowed within window (default 60) */
  max?: number;
  /**
   * Derive a key; defaults to client IP from headers (x-forwarded-for, cf-connecting-ip, x-real-ip).
   * Return an empty string to disable limiting for a request (e.g., trusted IP).
   */
  keyGenerator?: (req: Request) => string;
  /** Provide custom clock (ms). Defaults to Date.now() */
  now?: () => number;
  /** Namespace prefix (useful when you run multiple limiters side-by-side) */
  prefix?: string;
};

// ————————————————————————————————————————————————————————
// In-memory sliding window store
// Keeps at most `max` timestamps per key and evicts stale keys periodically.
// ————————————————————————————————————————————————————————

type WindowEntry = {
  /** Sorted ascending timestamps (ms) within window; truncated to <= max */
  hits: number[];
  /** Last time we touched this key (ms) for GC */
  touchedAt: number;
};

const store: Map<string, WindowEntry> = new Map();
// GC every ~90s
let lastGc = 0;

function gc(now: number, windowMs: number) {
  // Run at most every 90s
  if (now - lastGc < 90_000) return;
  lastGc = now;

  const cutoff = now - 3 * windowMs; // keep keys touched in ~3 windows
  for (const [k, v] of store) {
    if (v.touchedAt < cutoff) store.delete(k);
  }
}

function defaultNow() {
  return Date.now();
}

function defaultKey(req: Request): string {
  const h = req.headers;
  // Prefer CF / proxies if present
  const cf = (h.get("cf-connecting-ip") || "").trim();
  if (cf) return cf;
  const xff = (h.get("x-forwarded-for") || "").split(",")[0].trim();
  if (xff) return xff;
  const xr = (h.get("x-real-ip") || "").trim();
  if (xr) return xr;
  // Fallback: user agent + accept-language (coarse), still better than nothing on localhost
  const ua = (h.get("user-agent") || "ua").slice(0, 64);
  const al = (h.get("accept-language") || "lang").slice(0, 32);
  return `${ua}|${al}`;
}

function buildHeaders(opts: Required<Pick<RateLimitOptions, "windowMs" | "max">>, remaining: number, retryAfterSec: number, resetAt: number): HeadersInit {
  const h: Record<string, string> = {
    "X-RateLimit-Limit": String(opts.max),
    "X-RateLimit-Remaining": String(Math.max(0, remaining)),
    "X-RateLimit-Reset": String(Math.floor(resetAt / 1000)),
  };
  if (retryAfterSec > 0) {
    h["Retry-After"] = String(retryAfterSec);
  }
  // Prevent caches from serving a 429 too long
  h["Cache-Control"] = "no-store";
  return h;
}

/**
 * Rate-limit a request using a sliding window.
 * Stores up to `max` timestamps per key; O(max) per request worst case.
 */
export function rateLimit(
  req: Request,
  options: RateLimitOptions = {}
): RateLimitResult {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 60;
  const now = (options.now ?? defaultNow)();
  const keyGen = options.keyGenerator ?? defaultKey;
  const prefix = options.prefix ? `${options.prefix}:` : "rl:";

  const idRaw = keyGen(req);
  // Empty key means "skip limiting"
  if (!idRaw) {
    const headers = buildHeaders({ windowMs, max }, max, 0, now + windowMs);
    return { allowed: true, retryAfterSec: 0, remaining: max, resetAt: now + windowMs, headers };
  }

  const key = prefix + idRaw;

  // GC occasionally to avoid unbounded memory growth
  gc(now, windowMs);

  let entry = store.get(key);
  if (!entry) {
    entry = { hits: [], touchedAt: now };
    store.set(key, entry);
  }

  // Drop hits outside window
  const fromTs = now - windowMs;
  // Fast-path: if array is already short and last <= fromTs we can clear
  if (entry.hits.length && entry.hits[entry.hits.length - 1] <= fromTs) {
    entry.hits.length = 0;
  } else if (entry.hits.length) {
    // Remove old timestamps (keep order)
    let i = 0;
    while (i < entry.hits.length && entry.hits[i] <= fromTs) i++;
    if (i > 0) entry.hits.splice(0, i);
  }

  // Now attempt to add current hit
  const used = entry.hits.length;
  const remainingBefore = Math.max(0, max - used);
  let allowed = true;

  if (used >= max) {
    allowed = false;
  } else {
    entry.hits.push(now);
    // Keep array capped to `max` (should already be <= max)
    if (entry.hits.length > max) entry.hits.splice(0, entry.hits.length - max);
    entry.touchedAt = now;
  }

  // Compute next reset = when first hit in window will expire
  const first = entry.hits[0] ?? now;
  const resetAt = Math.max(first + windowMs, now);
  const retryAfterMs = allowed ? 0 : Math.max(0, resetAt - now);
  const retryAfterSec = Math.ceil(retryAfterMs / 1000);

  const remaining = allowed ? Math.max(0, max - entry.hits.length) : 0;

  const headers = buildHeaders({ windowMs, max }, remaining, retryAfterSec, resetAt);

  return { allowed, retryAfterSec, remaining, resetAt, headers };
}

/**
 * Helper to create a fixed-IP limiter with custom limits.
 * Reuse the returned function across requests to share the in-memory store.
 *
 * Example:
 *   const limitApi = createRateLimiter({ windowMs: 60_000, max: 120 });
 *   export async function GET(req: Request) {
 *     const r = limitApi(req);
 *     if (!r.allowed) return new Response("Too many", { status: 429, headers: r.headers });
 *     return new Response("ok", { headers: r.headers });
 *   }
 */
export function createRateLimiter(opts: RateLimitOptions) {
  return (req: Request) => rateLimit(req, opts);
}
