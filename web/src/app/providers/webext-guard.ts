// src/app/providers/webext-guard.ts
"use client";

/**
 * Quiet Chrome extension API probes from web pages without breaking code that reads
 * chrome.runtime.onMessage, etc. If we're NOT in an extension context (no runtime.id),
 * we install a no-op stub instead of removing runtime entirely.
 */
(function guardChromeRuntime() {
  if (typeof window === "undefined") return;
  const w = window as any;
  const cr = w.chrome;

  // Only intervene if chrome.runtime exists but we're NOT inside an extension (no id)
  if (cr && typeof cr === "object" && cr.runtime && !cr.runtime.id) {
    try {
      const noop = () => {};
      const noopEvent = {
        addListener: noop,
        removeListener: noop,
        hasListener: () => false
      };

      // A very small, read-only stub for runtime
      const stub = new Proxy(
        { id: undefined }, // no extension id in web page
        {
          get(_t, prop) {
            // Provide common event objects as no-ops; everything else is undefined
            if (prop === "onMessage" || prop === "onConnect" || prop === "onInstalled") return noopEvent;
            // Intentionally no sendMessage in page context
            return undefined;
          },
          set: () => true,
          has: () => false
        }
      );

      Object.defineProperty(cr, "runtime", {
        configurable: true,
        enumerable: false,
        writable: false,
        value: stub
      });
    } catch {
      // Fallback: at least prevent crashing reads
      try { cr.runtime = { id: undefined } as any; } catch {}
    }
  }
})();
