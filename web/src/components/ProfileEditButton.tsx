"use client";
import React from "react";

type Props = { address: string };

export default function ProfileEditButton({ address }: Props) {
  const [open, setOpen] = React.useState(false);

  // local UI state (optional; inputs are uncontrolled and read from FormData)
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string>(""); // shows “Saving…”, “Saved ✅”, or errors

  async function uploadAvatar(file: File): Promise<string> {
    const fd = new FormData();
    fd.append("file", file);
    // keep passing address if your backend expects it
    fd.append("address", address);

    const res = await fetch("/api/upload/avatar", { method: "POST", body: fd });
    const ct = res.headers.get("content-type") || "";
    const text = await res.text();
    const data = ct.includes("application/json") ? (text ? JSON.parse(text) : null) : { raw: text };

    if (!res.ok) throw new Error(data?.error || data?.raw || `HTTP ${res.status}`);
    return data.url as string; // { url: "..." }
  }

  // NEW: submit handler using the robust pattern
  async function onSaveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // ✅ capture the form first
    const form = e.currentTarget;

    // ✅ read values before any await
    const fd = new FormData(form);
    const addr = (fd.get("address") || address || "").toString().toLowerCase();
    const username = String(fd.get("username") || "").trim();

    const telegram = String((fd.get("telegram") || "").toString().replace(/^@/, "")).trim();
    const twitter = String((fd.get("twitter") || "").toString().replace(/^@/, "")).trim();

    const avatarFile = (fd.get("avatar_file") as File) || null;
    let avatarUrl = String(fd.get("avatar_url") || ""); // optional text URL fallback

    setSaving(true);
    setStatus("Saving…");

    try {
      // If a file was selected, upload it first to get a hosted URL
      if (avatarFile && avatarFile.size > 0) {
        avatarUrl = await uploadAvatar(avatarFile);
      }

      // Post JSON to /api/profile
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: addr,
          username,
          telegram,
          twitter,
          avatar_url: avatarUrl,
        }),
      });

      // Robust response handling
      const ct = res.headers.get("content-type") || "";
      const text = await res.text();
      const data = ct.includes("application/json") ? (text ? JSON.parse(text) : null) : { raw: text };

      if (!res.ok) {
        throw new Error(data?.error || data?.raw || `HTTP ${res.status}`);
      }

      setStatus("Saved ✅");
      // Close after a short delay so the user sees the success message
      setTimeout(() => {
        setOpen(false);
        setStatus("");
        form.reset();
      }, 400);
    } catch (err: any) {
      setStatus(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button className="px-3 py-1 rounded bg-gray-100 border" onClick={() => setOpen(true)}>
        Edit profile
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 w-[360px]">
            <h3 className="font-semibold mb-3">Edit profile</h3>

            {/* Wrap fields in a form and use the new handler */}
            <form onSubmit={onSaveProfile}>
              {/* Hidden address so handler can read it from FormData (also uses prop as fallback) */}
              <input type="hidden" name="address" value={address} />

              <label className="block text-sm mb-1">Username</label>
              <input
                name="username"
                className="w-full border rounded px-2 py-1 mb-2"
                placeholder="Your name"
              />

              <label className="block text-sm mb-1">Avatar (image)</label>
              <input
                name="avatar_file"
                className="w-full border rounded px-2 py-1 mb-2"
                type="file"
                accept="image/*"
              />

              {/* Optional: support direct URL too (kept hidden / comment out if unused) */}
              <input type="hidden" name="avatar_url" value="" />

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm mb-1">Telegram</label>
                  <input
                    name="telegram"
                    className="w-full border rounded px-2 py-1"
                    placeholder="@handle"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">Twitter (X)</label>
                  <input
                    name="twitter"
                    className="w-full border rounded px-2 py-1"
                    placeholder="@handle"
                  />
                </div>
              </div>

              {/* Status / errors */}
              {status && <div className="text-sm mt-2">{status}</div>}

              <div className="mt-3 flex gap-2 justify-end">
                <button
                  type="button"
                  className="px-3 py-1 rounded border"
                  onClick={() => setOpen(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 rounded bg-black text-white"
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
