// Next.js App Router API: /api/price/bnb
// Tries Binance → CoinGecko → Coinpaprika with short timeouts, then returns usdPerBnb.
export const runtime = "edge"; // or "nodejs" if you prefer

type Source = { url: string; parse: (j: any) => number | null };

const SOURCES: Source[] = [
  {
    url: "https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT",
    parse: (j) => (j?.price ? Number(j.price) : null),
  },
  {
    url: "https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd",
    parse: (j) => (j?.binancecoin?.usd ? Number(j.binancecoin.usd) : null),
  },
  {
    url: "https://api.coinpaprika.com/v1/tickers/bnb-binance-coin",
    parse: (j) => (j?.quotes?.USD?.price ? Number(j.quotes.USD.price) : null),
  },
];

async function withTimeout<T>(p: Promise<T>, ms = 3500): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    // @ts-ignore
    return await p;
  } finally {
    clearTimeout(t);
  }
}

export async function GET() {
  let lastErr: any = null;
  for (const s of SOURCES) {
    try {
      const r = await withTimeout(fetch(s.url, { cache: "no-store" }));
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const v = s.parse(j);
      if (v && Number.isFinite(v) && v > 0) {
        return new Response(
          JSON.stringify({ usdPerBnb: v, source: s.url, at: Date.now() }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "public, max-age=20, s-maxage=20",
            },
          }
        );
      }
    } catch (e) {
      lastErr = e;
    }
  }
  // Fallback if every source failed (kept small so it's obvious it’s a fallback)
  const fallback = Number(process.env.NEXT_PUBLIC_USD_PER_BNB_FALLBACK || "500");
  return new Response(
    JSON.stringify({ usdPerBnb: fallback, source: "fallback", at: Date.now(), error: String(lastErr || "") }),
    { headers: { "content-type": "application/json; charset=utf-8" }, status: 200 }
  );
}
