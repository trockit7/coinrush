// next.config.js
/** @type {import('next').NextConfig} */

const nextConfig = {
  reactStrictMode: true,
  productionBrowserSourceMaps: true, // ✅ show proper file/line in prod

  // Prevent accidental bundling of Node/RN-only modules in the browser
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      // ⬇️ Make these optional deps no-ops in the browser bundle
      "pino-pretty": false,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },

  async headers() {
    // Helper to build CSP per env
    const isProd = process.env.NODE_ENV === "production";
    const listFromEnv = (name, fallback = []) =>
      (process.env[name] || "")
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .concat(fallback);

    const connectSrc = isProd
      ? ["'self'", "https:", "wss:", ...listFromEnv("NEXT_PUBLIC_ALLOWED_CONNECT")]
      : ["'self'", "http:", "https:", "ws:", "wss:"];

    const imgSrc = ["'self'", "data:", "blob:", "https:", ...listFromEnv("NEXT_PUBLIC_ALLOWED_IMG")];

    // Dev needs both inline + eval for HMR and some libraries
    const scriptSrc = isProd ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"];

    const styleSrc = ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"];
    const styleSrcElem = styleSrc; // cover style-src-elem explicitly
    const fontSrc = ["'self'", "data:", "https://fonts.gstatic.com"];
    const frameSrc = [
      "'self'",
      "https://secure.walletconnect.org", // WalletConnect Modal
      "https://verify.walletconnect.com", // (some WC flows)
    ];

    const csp = [
      `default-src 'self'`,
      `script-src ${scriptSrc.join(" ")}`,
      `style-src ${styleSrc.join(" ")}`,
      `style-src-elem ${styleSrcElem.join(" ")}`,
      `img-src ${imgSrc.join(" ")}`,
      `font-src ${fontSrc.join(" ")}`,
      `connect-src ${connectSrc.join(" ")}`,
      `frame-src ${frameSrc.join(" ")}`,
      `frame-ancestors 'none'`,
      `base-uri 'self'`,
      `form-action 'self'`,
      `object-src 'none'`,
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=(), payment=()" },

          // ✅ Allow Coinbase Smart Wallet popups to communicate back
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },

          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Origin-Agent-Cluster", value: "?1" },
          { key: "X-DNS-Prefetch-Control", value: "off" },

          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
