// src/app/(lite)/layout.tsx
import React from "react";

// Server Component – no "use client", no styled-jsx, no external CSS import
export default function LiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-lite-root>
      {children}

      {/* Plain <style> (scoped via [data-lite-root]) so it won't leak to other routes */}
      <style
        // keep this CSS small & specific so it always wins without !important
        dangerouslySetInnerHTML={{
          __html: `
            [data-lite-root]{
              min-height:100dvh;
              background:#070b11;
              color:#d8ecff;
              font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
            }
            [data-lite-root] a{ color:#d8ecff; text-decoration:none; }
            [data-lite-root] a:hover{ text-decoration:underline; }

            /* Optional: card + subtle neon look that your token pages expect */
            [data-lite-root] .cr-card{
              background:linear-gradient(180deg,#0b1018,#0e1622);
              border-radius:14px;
              box-shadow:0 0 0 1px rgba(0,220,255,0.10) inset, 0 0 30px -12px rgba(0,240,255,0.5);
            }
          `,
        }}
      />
    </div>
  );
}
