"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Invite = {
  code: string;
  url: string;
  note: string | null;
  season_id: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  status: "open" | "used" | "expired";
  character: { id: string; name: string } | null;
};
type View = { switched_on: boolean; invites: Invite[] };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Creator invites for casting (lib/casting-invites.ts; docs/casting-invites.md): a quiet fold with every code (open,
 * used by which character, expired) and a small form that makes more. Each code is one character's; send its link by
 * hand. Admin account or password, like the panels around it.
 */
export default function InvitesPanel() {
  const [view, setView] = useState<View | null>(null);
  const [count, setCount] = useState(1);
  const [note, setNote] = useState("");
  const [made, setMade] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headers = (): Record<string, string> => {
    try {
      const key = localStorage.getItem("bz_frontier");
      return key ? { "x-frontier-key": key } : {};
    } catch {
      return {};
    }
  };

  async function load() {
    const res = await fetch("/api/admin/casting-invites", { headers: headers() });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setView(data as View);
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/casting-invites", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers() },
        body: JSON.stringify({ count, note: note.trim() || null }),
      });
      const data = (await res.json().catch(() => ({}))) as { invites?: { url: string }[]; message?: string };
      if (!res.ok) setError(data.message ?? "That didn't work.");
      else {
        setMade((data.invites ?? []).map((i) => i.url));
        setNote("");
        await load();
      }
    } catch {
      setError("Network error.");
    }
    setBusy(false);
  }

  // Not authorized, or still loading: the season panel above already says so.
  if (!view) return null;
  const open = view.invites.filter((i) => i.status === "open").length;
  const used = view.invites.filter((i) => i.status === "used").length;
  return (
    <details className="ux-fold admin-invites" id="creator-invites">
      <summary>
        Creator invites ({open} open, {used} used)
      </summary>
      <p className="muted small">
        One code is one character: applying with it skips the three-date wait, goes in shortlisted, and books its audition date with the lead.
        {view.switched_on ? "" : " Switched off (CASTING_INVITES=0): the links say invites are closed."}
      </p>
      <form
        className="admin-invites-make"
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
      >
        <label className="small">
          Make{" "}
          <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.max(1, Math.min(20, Math.floor(Number(e.target.value) || 1))))} aria-label="How many" />{" "}
          {count === 1 ? "invite" : "invites"}
        </label>
        <input type="text" maxLength={200} placeholder="Who it's for (only you see this)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Who it's for" />
        <button type="submit" className="primary small" disabled={busy}>
          {busy ? "Making…" : "Make"}
        </button>
      </form>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {made.length > 0 && (
        <ul className="small admin-invites-made" aria-label="Just made">
          {made.map((u) => (
            <li key={u}>
              <code>{u}</code>
            </li>
          ))}
        </ul>
      )}
      {view.invites.length > 0 && (
        <ul className="small admin-invites-list">
          {view.invites.map((i) => (
            <li key={i.code}>
              <code>{i.url}</code> <span className="badge">{i.status}</span> {i.note && <span className="muted">{i.note}</span>}{" "}
              {i.status === "used" ? (
                i.character ? (
                  <Link href={`/characters/${i.character.id}`}>{i.character.name}</Link>
                ) : (
                  <span className="muted">its character was deleted</span>
                )
              ) : (
                <span className="muted">
                  {i.status === "open" ? "until" : "ended"} {day(i.expires_at)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
