export type ProfilesBook = Record<string, { username?: string; avatar_url?: string }>;

export async function fetchProfiles(addrs: string[]): Promise<ProfilesBook> {
  const uniq = Array.from(new Set((addrs || []).map((a) => (a || "").toLowerCase()).filter(Boolean)));
  if (uniq.length === 0) return {};
  try {
    const r = await fetch("/api/profile/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ addresses: uniq }),
      cache: "no-store",
    });
    if (!r.ok) return {};
    const json = (await r.json()) as ProfilesBook | null;
    if (json && typeof json === "object") {
      const out: ProfilesBook = {};
      for (const [k, v] of Object.entries(json)) out[(k || "").toLowerCase()] = v || {};
      for (const a of uniq) if (!out[a]) out[a] = {};
      return out;
    }
  } catch {}
  const empty: ProfilesBook = {};
  for (const a of uniq) empty[a] = {};
  return empty;
}
