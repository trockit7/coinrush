// src/lib/security/turnstile.ts
export async function verifyTurnstile(token: string | null): Promise<boolean> {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) return true; // if not configured, don't block locally
    if (!token) return false;
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: token }),
    });
    const data = await res.json().catch(() => ({}));
    return !!data.success;
  }
  