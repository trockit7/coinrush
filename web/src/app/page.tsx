// src/app/page.tsx (SERVER component)
export const dynamic = "force-dynamic";
export const revalidate = 0;

import HomeClient from "./HomeClient";
import { serverBaseUrl } from "@/lib/base-url";

async function getJson<T>(path: string): Promise<T | []> {
  try {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) return [] as any;
    return (await r.json()) as T;
  } catch {
    return [] as any;
  }
}

export default async function Page() {
  const BASE = serverBaseUrl();

  // Absolute URLs so it works both locally and on Railway
  const latestPath = `${BASE}/api/token/latest-db?limit=6`;
  const trendingPath = `${BASE}/api/token/trending-db?limit=6`;

  const [latest, trending] = await Promise.all([
    getJson<any[]>(latestPath),
    getJson<any[]>(trendingPath),
  ]);

  return (
    <HomeClient
      initialLatest={Array.isArray(latest) ? latest : []}
      initialTrending={Array.isArray(trending) ? trending : []}
    />
  );
}
