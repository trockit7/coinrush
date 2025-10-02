// web/src/lib/base-url.ts
export function serverBaseUrl() {
    // Use your public URL in prod; strip trailing slash if any
    const env = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
    if (env) return env;
    // sensible dev fallback
    return "http://localhost:3000";
  }
  