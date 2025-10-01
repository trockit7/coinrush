// src/app/providers/w3m-ready.ts
export function markW3MReady() {
    (globalThis as any).__W3M_READY__ = true;
  }
  export function isW3MReady() {
    return Boolean((globalThis as any).__W3M_READY__);
  }
  