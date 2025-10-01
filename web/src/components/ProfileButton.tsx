// src/components/ProfileButton.tsx
"use client";

import React from "react";
import {
  fetchProfile,
  saveProfile,
  uploadAvatar,
  PublicProfile,
} from "@/lib/profile-client";
import { BrowserProvider } from "ethers";

type Props = {
  className?: string;
  label?: string;
  onChanged?: (p: PublicProfile | null) => void;
};

// —— tiny wallet helpers (no external connectWallet needed) ——
async function readAddressSilently(): Promise<string | null> {
  try {
    const eth: any = (globalThis as any).ethereum;
    if (!eth) return null;
    const accs: string[] = await eth.request({ method: "eth_accounts" });
    return accs?.[0] ? accs[0].toLowerCase() : null;
  } catch {
    return null;
  }
}

async function requestAddress(chainId = 97): Promise<string> {
  const eth: any = (globalThis as any).ethereum;
  if (!eth) throw new Error("Open your wallet (MetaMask, etc.) and try again.");
  const provider = new BrowserProvider(eth);

  // ask for accounts
  await provider.send("eth_requestAccounts", []);

  // (optional) ensure BSC Testnet if you want; safe to skip if not required:
  try {
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== chainId) {
      await provider.send("wallet_switchEthereumChain", [
        { chainId: chainId === 97 ? "0x61" : `0x${chainId.toString(16)}` },
      ]);
    }
  } catch {
    // ignore chain switch errors for now
  }

  const signer = await provider.getSigner();
  const addr = (await signer.getAddress()).toLowerCase();
  try {
    localStorage.setItem("cr:lastAddress", addr);
  } catch {}
  return addr;
}

export default function ProfileButton({
  className,
  label = "Edit profile",
  onChanged,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [addr, setAddr] = React.useState<string>("");

  // form state
  const [username, setUsername] = React.useState("");
  const [avatarUrl, setAvatarUrl] = React.useState<string>("");
  const [telegram, setTelegram] = React.useState("");
  const [twitter, setTwitter] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const [current, setCurrent] = React.useState<PublicProfile | null>(null);

  // On mount: try to read an already-connected address
  React.useEffect(() => {
    (async () => {
      try {
        const remembered =
          (typeof window !== "undefined" &&
            (localStorage.getItem("cr:lastAddress") || "").toLowerCase()) ||
          "";
        const silent = (await readAddressSilently()) || remembered;
        if (!silent) return;

        setAddr(silent);
        const p = await fetchProfile(silent);
        setCurrent(p);
        setUsername(p?.username || "");
        setAvatarUrl(p?.avatar_url || "");
        setTelegram(p?.telegram || "");
        setTwitter(p?.twitter || "");
      } catch {
        // not connected yet — user can still click and connect on save/upload
      }
    })();
  }, []);

  async function ensureAddress() {
    if (addr) return addr;
    const a = await requestAddress(97);
    setAddr(a);
    return a;
  }

  function openModal() {
    setOpen(true);
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Please choose an image file");
      return;
    }
    if (file.size > 2_000_000) {
      alert("Max 2 MB");
      return;
    }
    try {
      const who = await ensureAddress();
      const url = await uploadAvatar(who, file);
      setAvatarUrl(url);
    } catch (err: any) {
      alert(err?.message || "Upload failed");
    } finally {
      e.target.value = "";
    }
  }

  async function onSave(e?: React.FormEvent) {
    e?.preventDefault?.();
    try {
      setSaving(true);
      const who = await ensureAddress();
      if (!username.trim()) throw new Error("Please enter a username");
      await saveProfile({
        address: who,
        username: username.trim(),
        avatar_url: avatarUrl || undefined,
        telegram: telegram.replace(/^@/, "").trim() || undefined,
        twitter: twitter.replace(/^@/, "").trim() || undefined,
      });
      const p = await fetchProfile(who);
      setCurrent(p);
      onChanged?.(p);
      setOpen(false);
    } catch (err: any) {
      alert(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onReset() {
    try {
      const who = await ensureAddress();
      // simplest way to "clear" (you may prefer a DELETE route)
      await saveProfile({ address: who, username: "", avatar_url: "" });
      setCurrent(null);
      setUsername("");
      setAvatarUrl("");
      setTelegram("");
      setTwitter("");
      onChanged?.(null);
      setOpen(false);
    } catch (e) {
      alert("To reset: set username empty then Save.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={`px-3 py-2 rounded-md border hover:bg-gray-50 ${className || ""}`}
      >
        {current?.username ? `@${current.username}` : label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <form
            onSubmit={onSave}
            className="relative z-10 w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
          >
            <h3 className="text-lg font-semibold mb-3">Your profile</h3>

            <div className="flex items-center gap-3 mb-3">
              <div className="w-14 h-14 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt="avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-gray-400 text-xs">No avatar</span>
                )}
              </div>
              <label className="text-xs text-gray-600">
                Upload image (≤2MB)
                <input
                  type="file"
                  accept="image/*"
                  onChange={onPickAvatar}
                  className="block text-sm mt-1"
                />
              </label>
            </div>

            <label className="block text-sm text-gray-600 mb-1">Username *</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="rockit"
              className="w-full border rounded px-3 py-2 mb-3"
              maxLength={32}
              required
            />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Telegram
                </label>
                <div className="flex">
                  <span className="inline-flex items-center px-2 border border-r-0 rounded-l text-gray-500">
                    @
                  </span>
                  <input
                    value={telegram}
                    onChange={(e) => setTelegram(e.target.value)}
                    placeholder="yourhandle"
                    className="w-full border rounded-r px-3 py-2"
                    maxLength={32}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Twitter (X)
                </label>
                <div className="flex">
                  <span className="inline-flex items-center px-2 border border-r-0 rounded-l text-gray-500">
                    @
                  </span>
                  <input
                    value={twitter}
                    onChange={(e) => setTwitter(e.target.value)}
                    placeholder="yourhandle"
                    className="w-full border rounded-r px-3 py-2"
                    maxLength={32}
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                onClick={onReset}
                className="px-3 py-2 rounded border text-gray-600 hover:bg-gray-50"
              >
                Reset
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-3 py-2 rounded border hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-3 py-2 rounded bg-black text-white"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
