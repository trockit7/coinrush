export type PublicProfile = {
    address: string;
    username: string;
    avatar_url?: string;
    telegram?: string;
    twitter?: string;
  };
  
  export async function fetchProfile(address: string): Promise<PublicProfile | null> {
    const r = await fetch(`/api/profile?address=${address.toLowerCase()}`, { cache: "no-store" });
    const j = await r.json();
    return j.profile || null;
  }
  
  export async function saveProfile(p: {
    address: string;
    username: string;
    avatar_url?: string;
    telegram?: string;
    twitter?: string;
  }) {
    const r = await fetch("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(p),
    });
    if (!r.ok) throw new Error(await r.text());
  }
  
  export async function uploadAvatar(address: string, file: File): Promise<string> {
    const fd = new FormData();
    fd.append("address", address);
    fd.append("file", file);
    const r = await fetch("/api/upload/avatar", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || "upload failed");
    return j.url as string;
  }
  
  export async function bulkProfiles(addresses: string[]): Promise<Record<string, PublicProfile>> {
    if (!addresses.length) return {};
    const r = await fetch("/api/profile/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ addresses }),
    });
    const j = await r.json();
    const out: Record<string, PublicProfile> = {};
    for (const row of j.profiles || []) out[row.address.toLowerCase()] = row;
    return out;
  }
  