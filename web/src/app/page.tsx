// src/app/page.tsx  (SERVER component)
import HomeClient from "./HomeClient";
import { factoryContract } from "@/lib/eth";

// stream/cdn-cache these queries for 15s; tweak as you like
export const revalidate = 15;

async function getJson<T>(path: string): Promise<T | []> {
  try {
    // Relative fetch works on the server; Next will resolve to your own app
    const r = await fetch(path, { next: { revalidate: 15 } });
    if (!r.ok) return [] as any;
    return (await r.json()) as T;
  } catch {
    return [] as any;
  }
}

export default async function Page() {
  const [latest, trending] = await Promise.all([
    getJson<any[]>("/api/token/latest-db?limit=6"),
    getJson<any[]>("/api/token/trending-db?limit=6"),
  ]);

  return <HomeClient initialLatest={latest || []} initialTrending={trending || []} />;
}
