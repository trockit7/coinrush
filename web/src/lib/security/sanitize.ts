// src/lib/security/sanitize.ts

// HTML-escape for any user-visible text
export function escapeHtml(str = ""): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Clamp to max length, trim, then escape HTML */
export function cleanDescription(s: string, max = 500): string {
  const t = (s ?? "").trim().slice(0, Math.max(0, max));
  return escapeHtml(t);
}

/**
 * Token name: letters/numbers/space/._- only (unicode letters allowed),
 * trimmed & clamped. No invisible/control characters.
 */
export function cleanName(s: string, max = 64): string {
  const raw = String(s ?? "");
  // drop control/invisible chars
  const noCtrl = raw.replace(/[\p{C}]/gu, "");
  // keep letters/numbers/space/._-
  const safe = noCtrl.replace(/[^\p{L}\p{N}\s._-]/gu, "");
  return safe.trim().slice(0, Math.max(0, max));
}

/**
 * Token symbol: uppercase A–Z, 1–10 chars (adjust as needed).
 * Removes whitespace & punctuation, clamps length.
 */
export function cleanSymbol(s: string, max = 10): string {
  const raw = String(s ?? "");
  const up = raw.toUpperCase();
  // remove everything except A–Z and digits
  const safe = up.replace(/[^A-Z0-9]/g, "");
  const out = safe.slice(0, Math.max(1, Math.min(max, 32)));
  // allow empty? usually no → return at least ""
  return out;
}

/** Strict 0x-address guard (lowercased) or null */
export function toAddrOrNull(s?: string | null): string | null {
  const v = String(s ?? "").toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(v) ? v : null;
}

/**
 * Normalize/validate URL:
 * - requires HTTPS by default (forceHttps = true)
 * - optional host allowlist (exact match or endsWith)
 * - returns "" on failure
 */
export function normalizeUrl(
  input: string,
  opts?: {
    allowHttp?: boolean;           // default false
    allowHosts?: string[];         // optional host allowlist (e.g. ["t.me","twitter.com","x.com","yourdomain.com"])
    maxLen?: number;               // default 200
  }
): string {
  try {
    const allowHttp = !!opts?.allowHttp;
    const maxLen = Math.max(1, opts?.maxLen ?? 200);

    let s = String(input ?? "").trim();
    if (!s) return "";

    // If missing protocol, assume https
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    const url = new URL(s);

    if (!allowHttp && url.protocol !== "https:") return "";

    // Block mailto:, javascript:, data:, etc.
    if (!/^(https?):$/.test(url.protocol)) return "";

    // Optional host allowlist
    if (opts?.allowHosts?.length) {
      const host = url.hostname.toLowerCase();
      const ok = opts.allowHosts.some((h) => {
        const needle = h.toLowerCase();
        return host === needle || host.endsWith("." + needle);
      });
      if (!ok) return "";
    }

    // Strip credentials, normalize
    url.username = "";
    url.password = "";

    const normalized = url.toString();
    return normalized.length > maxLen ? "" : normalized;
  } catch {
    return "";
  }
}

/** Tiny guard: restrict to common raster formats; reject SVG/HTML masquerades */
export function safeImageMime(mime?: string): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase();
  // Optional: allow GIFs if you cap upload size tightly (gif bombs)
  const ok = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
  // SVGs can carry scripts → reject
  if (m === "image/svg+xml") return false;
  return ok.includes(m);
}