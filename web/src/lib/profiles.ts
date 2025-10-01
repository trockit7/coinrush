export type Profile = {
  address: string;
  username: string;
  avatar_url?: string;
  telegram?: string;
  twitter?: string;
};

export async function fetchProfile(address: string): Promise<Profile | null> {
  const res = await fetch(`/api/profile?address=${address.toLowerCase()}`, { cache: "no-store" });
  const j = await res.json();
  return j.profile || null;
}

export async function fetchProfiles(addresses: string[]): Promise<Record<string, Profile>> {
  const res = await fetch("/api/profile/bulk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addresses }),
  });
  const j = await res.json();
  const out: Record<string, Profile> = {};
  for (const p of j.profiles || []) out[p.address] = p;
  return out;
}
